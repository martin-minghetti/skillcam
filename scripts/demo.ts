#!/usr/bin/env node
/**
 * scripts/demo.ts — v0.2.5 vs v0.2.6 side-by-side comparison.
 *
 * Dry-run: no API calls. Generates the prompts (legacy + current) for each
 * fixture, measures them, and writes `demo/RESULTS.md`. Useful for:
 *   - launch thread screenshots
 *   - verifying the prompt quality changes shipped in v0.2.6
 *   - regression monitoring when we iterate on the prompt later
 *
 * Run: npx tsx scripts/demo.ts
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ParsedSession } from "../src/parsers/types.js";
import { buildDistillPrompt } from "../src/distiller-prompt.js";
import { buildJudgePrompt } from "../src/distiller-judge.js";
import { capPromptMessages } from "../src/limits.js";

import { fixture as goodFixBug } from "../eval/fixtures/session-good-fix-bug.js";
import { fixture as goodBuildFeature } from "../eval/fixtures/session-good-build-feature.js";
import { fixture as exploratory } from "../eval/fixtures/session-exploratory.js";
import { fixture as deadEnds } from "../eval/fixtures/session-dead-ends.js";
import { fixture as mixed } from "../eval/fixtures/session-mixed.js";
import type { Fixture } from "../eval/types.js";

const FIXTURES: Fixture[] = [
  goodFixBug,
  goodBuildFeature,
  exploratory,
  deadEnds,
  mixed,
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(__dirname, "..", "demo");

/**
 * Replica del prompt v0.2.5 — intencionalmente inline para tener una baseline
 * de comparación sin depender de git checkout. Se copió de src/distiller-prompt.ts
 * en el commit de v0.2.5 para que el demo sea self-contained y reproducible.
 */
function buildLegacyPromptV025(session: ParsedSession): string {
  const { messages } = capPromptMessages(session.messages);

  const toolSummary = messages
    .flatMap((m, mi) =>
      m.toolCalls.map((tc, ti) => {
        const raw = `- ${tc.name}: ${JSON.stringify(tc.input)}`;
        return raw.slice(0, 200 + tc.name.length + 4);
      })
    )
    .join("\n");

  const conversation = messages
    .map((m) => {
      const toolInfo =
        m.toolCalls.length > 0
          ? `\n  [Tools: ${m.toolCalls.map((t) => t.name).join(", ")}]`
          : "";
      return `${m.role}: ${m.content.slice(0, 500)}${toolInfo}`;
    })
    .join("\n\n");

  return `You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: ${session.agent}
- Project: ${session.project}
- Tool calls: ${session.totalToolCalls}
- Tools used: ${session.summary.uniqueTools.join(", ")}
- Files modified: ${session.filesModified.join(", ")}

## Tool Calls
${toolSummary}

## Conversation
${conversation}

## Your Task

Extract the reusable pattern from this session. Output a SKILL.md with this exact format:

\`\`\`markdown
---
name: <kebab-case-name>
description: <one line description of what this skill does>
source_session: ${session.sessionId}
source_agent: ${session.agent}
created: ${new Date().toISOString().split("T")[0]}
tags:
  - <tag1>
  - <tag2>
---

# <Skill Name>

## When to use
<1-3 sentences describing when an agent should use this skill>

## Steps
<Numbered list of concrete steps the agent should follow>

## Example
<Short example showing input and expected output>

## Key decisions
<Bullet list of important decisions or gotchas discovered during the session>
\`\`\`

Rules:
- Be specific and actionable, not generic
- Include actual file paths, commands, or patterns from the session
- The skill should be usable by someone who never saw the original session
- Keep it under 100 lines`;
}

interface PromptMetrics {
  charCount: number;
  lineCount: number;
  absolutePathLeaks: number;
  literalToolCallRefs: number;
  hasFewShotExamples: boolean;
  hasAbortProtocol: boolean;
  hasTagTaxonomy: boolean;
  hasJsonSchema: boolean;
  hasCausalChainRule: boolean;
}

function measurePrompt(prompt: string): PromptMetrics {
  const lines = prompt.split("\n");
  // Real leaks only — require a non-placeholder username segment, exclude
  // `<name>`, `<you>`, `*`, etc. so the anti-leak RULE in v0.2.6 does not
  // count as a leak.
  const realPathRegex = /\/(?:Users|home)\/(?!<|\*)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)/g;
  const absolutePathLeaks = (prompt.match(realPathRegex) ?? []).length;
  // "literal tool call refs" = instances like `Use Bash to` / `Use Grep on` in
  // the prompt's own instructions (not in the session data).
  // Proxy: count occurrences in the RULES / EXAMPLES half of the prompt.
  const literalHints =
    (prompt.match(/BAD:\s*"Use /g) ?? []).length +
    (prompt.match(/GOOD:\s*/g) ?? []).length;
  return {
    charCount: prompt.length,
    lineCount: lines.length,
    absolutePathLeaks,
    literalToolCallRefs: literalHints,
    hasFewShotExamples: /Example\s+1\b/i.test(prompt) && /Example\s+2\b/i.test(prompt),
    hasAbortProtocol: /"abort":\s*"no_artifact"/i.test(prompt) || /abort protocol/i.test(prompt),
    hasTagTaxonomy: /closed taxonomy/i.test(prompt),
    hasJsonSchema: /EXACTLY ONE valid JSON/i.test(prompt),
    hasCausalChainRule: /causal chain|discard dead ends/i.test(prompt),
  };
}

function formatMetricsTable(legacy: PromptMetrics, current: PromptMetrics): string {
  const rows: Array<[string, string, string, string]> = [
    ["Prompt chars", `${legacy.charCount}`, `${current.charCount}`, diffPct(legacy.charCount, current.charCount)],
    ["Prompt lines", `${legacy.lineCount}`, `${current.lineCount}`, diffPct(legacy.lineCount, current.lineCount)],
    ["`/Users/` or `/home/` leaks", `${legacy.absolutePathLeaks}`, `${current.absolutePathLeaks}`, ""],
    ["Few-shot examples", legacy.hasFewShotExamples ? "yes" : "no", current.hasFewShotExamples ? "yes" : "no", ""],
    ["Abort protocol", legacy.hasAbortProtocol ? "yes" : "no", current.hasAbortProtocol ? "yes" : "no", ""],
    ["Closed tag taxonomy", legacy.hasTagTaxonomy ? "yes" : "no", current.hasTagTaxonomy ? "yes" : "no", ""],
    ["JSON schema enforced", legacy.hasJsonSchema ? "yes" : "no", current.hasJsonSchema ? "yes" : "no", ""],
    ["Causal-chain rule", legacy.hasCausalChainRule ? "yes" : "no", current.hasCausalChainRule ? "yes" : "no", ""],
    ["BAD/GOOD hints in rules", `${legacy.literalToolCallRefs}`, `${current.literalToolCallRefs}`, ""],
  ];
  const header = `| Metric | v0.2.5 | v0.2.6 | Δ |\n| --- | --- | --- | --- |`;
  const body = rows
    .map(([a, b, c, d]) => `| ${a} | ${b} | ${c} | ${d} |`)
    .join("\n");
  return `${header}\n${body}`;
}

function diffPct(a: number, b: number): string {
  if (a === 0) return b === 0 ? "—" : "+∞";
  const pct = Math.round(((b - a) / a) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function section(fix: Fixture): string {
  const legacy = buildLegacyPromptV025(fix.session);
  const current = buildDistillPrompt(fix.session).prompt;
  const judge = buildJudgePrompt(fix.session);

  const legacyMetrics = measurePrompt(legacy);
  const currentMetrics = measurePrompt(current);

  const expected = fix.expected.kind === "abort"
    ? `**Expected outcome:** abort (\`${fix.expected.reason}\`). The quality judge should short-circuit before the main LLM call.`
    : `**Expected outcome:** a skill whose output contains ${fix.expected.mustContain.map((s) => `\`${s}\``).join(", ")} and does NOT contain ${(fix.expected.mustNotContain ?? []).map((s) => `\`${s}\``).join(", ") || "(n/a)"}.`;

  return `## Fixture: \`${fix.name}\`

${fix.description}

${expected}

### Metrics

${formatMetricsTable(legacyMetrics, currentMetrics)}

### v0.2.6 judge prompt (new, cheap pre-gate)

<details><summary>Click to expand</summary>

\`\`\`
${judge}
\`\`\`

</details>

### v0.2.5 distill prompt

<details><summary>Click to expand</summary>

\`\`\`
${legacy}
\`\`\`

</details>

### v0.2.6 distill prompt

<details><summary>Click to expand</summary>

\`\`\`
${current}
\`\`\`

</details>
`;
}

function aggregate(metrics: PromptMetrics[]): PromptMetrics {
  const blank: PromptMetrics = {
    charCount: 0,
    lineCount: 0,
    absolutePathLeaks: 0,
    literalToolCallRefs: 0,
    hasFewShotExamples: false,
    hasAbortProtocol: false,
    hasTagTaxonomy: false,
    hasJsonSchema: false,
    hasCausalChainRule: false,
  };
  return metrics.reduce(
    (acc, m) => ({
      charCount: acc.charCount + m.charCount,
      lineCount: acc.lineCount + m.lineCount,
      absolutePathLeaks: acc.absolutePathLeaks + m.absolutePathLeaks,
      literalToolCallRefs: acc.literalToolCallRefs + m.literalToolCallRefs,
      hasFewShotExamples: m.hasFewShotExamples,
      hasAbortProtocol: m.hasAbortProtocol,
      hasTagTaxonomy: m.hasTagTaxonomy,
      hasJsonSchema: m.hasJsonSchema,
      hasCausalChainRule: m.hasCausalChainRule,
    }),
    blank
  );
}

function main() {
  mkdirSync(DEMO_DIR, { recursive: true });

  const legacyAll = FIXTURES.map((f) => measurePrompt(buildLegacyPromptV025(f.session)));
  const currentAll = FIXTURES.map((f) => measurePrompt(buildDistillPrompt(f.session).prompt));
  const legacyAgg = aggregate(legacyAll);
  const currentAgg = aggregate(currentAll);

  const header = `# SkillCam v0.2.6 — Distiller rewrite comparison

> Dry-run demo. No API calls. Shows the prompts the distiller builds for five curated fixtures, side-by-side with what v0.2.5 would have emitted for the same input.

## Summary across ${FIXTURES.length} fixtures

${formatMetricsTable(legacyAgg, currentAgg)}

### What changed in v0.2.6

1. **Two-step architecture.** A cheap Haiku "quality judge" runs before the main Sonnet call and aborts when the session is exploratory or has no reusable pattern. Kills the #1 cause of low-quality skills in v0.2.5.
2. **JSON schema output.** The distiller now emits strict JSON, which TypeScript renders to SKILL.md. Frontmatter is no longer controlled by the LLM.
3. **Semantic tool-call summaries.** Replaces \`JSON.stringify(tc.input).slice(0, 100)\` with per-tool-type extraction that keeps the full semantic value (file path, command, pattern) and anonymizes \`/Users/*\` paths.
4. **Prompt reordered:** intent → conversation → actions → outcome (was tool calls first).
5. **Anti-literal rule with BAD/GOOD examples**, causal-chain rule, abort protocol, closed tag taxonomy.
6. **New metadata:** \`confidence\`, \`why_this_worked\`, \`distill_prompt_version\` — enables re-distill and reuse scoring.
7. **Caps per section** (steps ≤ 8, key_decisions ≤ 5) instead of a single global "under 100 lines" that LLMs ignore.

### How to run this locally

\`\`\`bash
# regenerate this document
npx tsx scripts/demo.ts

# run the full eval suite (requires ANTHROPIC_API_KEY)
npx tsx eval/run.ts
\`\`\`
`;

  const body = FIXTURES.map(section).join("\n\n---\n\n");
  const outPath = join(DEMO_DIR, "RESULTS.md");
  writeFileSync(outPath, `${header}\n\n---\n\n${body}\n`, "utf-8");
  console.log(`Wrote ${outPath}`);
  console.log(`\nSummary:`);
  console.log(`  Fixtures: ${FIXTURES.length}`);
  console.log(`  Legacy total prompt chars: ${legacyAgg.charCount}`);
  console.log(`  v0.2.6 total prompt chars: ${currentAgg.charCount}`);
  console.log(`  Legacy path leaks: ${legacyAgg.absolutePathLeaks}`);
  console.log(`  v0.2.6 path leaks: ${currentAgg.absolutePathLeaks}`);
}

main();
