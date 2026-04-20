import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Fixture } from "./types.js";
import { distillSkill, NotDistillableError, DistillationAbortedError } from "../src/distiller.js";
import { buildDistillPrompt } from "../src/distiller-prompt.js";

import { fixture as goodFixBug } from "./fixtures/session-good-fix-bug.js";
import { fixture as goodBuildFeature } from "./fixtures/session-good-build-feature.js";
import { fixture as exploratory } from "./fixtures/session-exploratory.js";
import { fixture as deadEnds } from "./fixtures/session-dead-ends.js";
import { fixture as mixed } from "./fixtures/session-mixed.js";

const FIXTURES: Fixture[] = [
  goodFixBug,
  goodBuildFeature,
  exploratory,
  deadEnds,
  mixed,
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");

interface RunResult {
  name: string;
  expectedKind: "skill" | "abort";
  actualKind: "skill" | "abort" | "error";
  passes: boolean;
  details: string;
  output?: string;
  missingFromMustContain?: string[];
  unexpectedFromMustNotContain?: string[];
  errorType?: string;
  promptCharCount: number;
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

async function runFixture(fix: Fixture): Promise<RunResult> {
  const prompt = buildDistillPrompt(fix.session);
  const promptCharCount = prompt.prompt.length;

  try {
    const skill = await distillSkill(fix.session, {
      useLlm: true,
      provider: "anthropic",
      secretPolicy: "redact",
    });

    if (fix.expected.kind === "abort") {
      return {
        name: fix.name,
        expectedKind: "abort",
        actualKind: "skill",
        passes: false,
        details: `Expected abort (${fix.expected.reason}) but got a skill.`,
        output: skill,
        promptCharCount,
      };
    }

    const missing = fix.expected.mustContain.filter(
      (s) => !containsCaseInsensitive(skill, s)
    );
    const unexpected =
      fix.expected.mustNotContain?.filter((s) =>
        containsCaseInsensitive(skill, s)
      ) ?? [];

    const passes = missing.length === 0 && unexpected.length === 0;
    return {
      name: fix.name,
      expectedKind: "skill",
      actualKind: "skill",
      passes,
      details: passes
        ? "All checks passed."
        : `missing=${missing.length}, unexpected=${unexpected.length}`,
      output: skill,
      missingFromMustContain: missing,
      unexpectedFromMustNotContain: unexpected,
      promptCharCount,
    };
  } catch (err) {
    if (err instanceof NotDistillableError || err instanceof DistillationAbortedError) {
      const passes = fix.expected.kind === "abort";
      return {
        name: fix.name,
        expectedKind: fix.expected.kind,
        actualKind: "abort",
        passes,
        details: `Aborted: ${err.message.split("\n")[0]}`,
        errorType: err.name,
        promptCharCount,
      };
    }
    return {
      name: fix.name,
      expectedKind: fix.expected.kind,
      actualKind: "error",
      passes: false,
      details: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      errorType: err instanceof Error ? err.name : "UnknownError",
      promptCharCount,
    };
  }
}

function formatMetrics(results: RunResult[]): string {
  const total = results.length;
  const passing = results.filter((r) => r.passes).length;
  const aborts = results.filter((r) => r.actualKind === "abort").length;
  const expectedAborts = results.filter((r) => r.expectedKind === "abort").length;
  const correctAborts = results.filter(
    (r) => r.expectedKind === "abort" && r.actualKind === "abort"
  ).length;
  const avgPromptChars = Math.round(
    results.reduce((sum, r) => sum + r.promptCharCount, 0) / total
  );

  const lines: string[] = [];
  lines.push(`## Metrics`);
  lines.push(``);
  lines.push(`- **Pass rate:** ${passing}/${total} (${Math.round((passing / total) * 100)}%)`);
  lines.push(`- **Abort accuracy:** ${correctAborts}/${expectedAborts} exploratory fixtures correctly aborted`);
  lines.push(`- **Total aborts emitted:** ${aborts}`);
  lines.push(`- **Avg prompt size:** ${avgPromptChars} chars`);
  return lines.join("\n");
}

function formatResult(r: RunResult): string {
  const icon = r.passes ? "✓" : "✗";
  const lines: string[] = [];
  lines.push(`### ${icon} ${r.name}`);
  lines.push(``);
  lines.push(`- Expected: ${r.expectedKind}`);
  lines.push(`- Actual:   ${r.actualKind}`);
  lines.push(`- Result:   ${r.details}`);
  lines.push(`- Prompt:   ${r.promptCharCount} chars`);
  if (r.missingFromMustContain && r.missingFromMustContain.length > 0) {
    lines.push(`- Missing (mustContain): ${r.missingFromMustContain.join(", ")}`);
  }
  if (r.unexpectedFromMustNotContain && r.unexpectedFromMustNotContain.length > 0) {
    lines.push(
      `- Found (mustNotContain): ${r.unexpectedFromMustNotContain.join(", ")}`
    );
  }
  if (r.output) {
    lines.push(``);
    lines.push(`<details><summary>Output</summary>\n\n\`\`\`markdown\n${r.output}\n\`\`\`\n\n</details>`);
  }
  return lines.join("\n");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Running ${FIXTURES.length} fixtures...\n`);
  const results: RunResult[] = [];
  for (const fix of FIXTURES) {
    process.stdout.write(`  ${fix.name}... `);
    const r = await runFixture(fix);
    results.push(r);
    console.log(r.passes ? "✓" : `✗ (${r.details})`);
  }

  const report = [
    `# SkillCam Eval Run`,
    ``,
    `Generated at ${new Date().toISOString()}`,
    ``,
    formatMetrics(results),
    ``,
    `## Results`,
    ``,
    ...results.map(formatResult),
  ].join("\n\n");

  const outPath = join(OUT_DIR, "results.md");
  writeFileSync(outPath, report, "utf-8");
  console.log(`\nReport: ${outPath}`);

  const failing = results.filter((r) => !r.passes);
  if (failing.length > 0) {
    console.error(`\n${failing.length} fixture(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
