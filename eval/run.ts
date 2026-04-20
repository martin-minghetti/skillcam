import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Fixture } from "./types.js";
import { distillSkill, NotDistillableError, DistillationAbortedError } from "../src/distiller.js";
import { buildDistillPrompt } from "../src/distiller-prompt.js";
import { judgeSession } from "../src/distiller-judge.js";

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

/**
 * v0.4.0 — judge-only mode. Runs only the cheap-gate Haiku call against
 * each fixture, compares the verdict with the fixture's `expected.kind`
 * (skill → distillable=true, abort → distillable=false), and reports
 * confusion-matrix metrics plus a markdown table suitable for pasting
 * into the README. Total cost: ~$0.001 across all 5 fixtures.
 */
interface JudgeRunResult {
  name: string;
  expectedDistillable: boolean;
  actualDistillable: boolean;
  judgeReason: string;
  judgeConfidence: "high" | "medium" | "low";
  passes: boolean;
}

async function runJudgeOnFixture(fix: Fixture): Promise<JudgeRunResult> {
  const expectedDistillable = fix.expected.kind === "skill";
  try {
    const judgment = await judgeSession(fix.session, { secretPolicy: "redact" });
    return {
      name: fix.name,
      expectedDistillable,
      actualDistillable: judgment.distillable,
      judgeReason: judgment.reason,
      judgeConfidence: judgment.confidence,
      passes: judgment.distillable === expectedDistillable,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: fix.name,
      expectedDistillable,
      actualDistillable: false,
      judgeReason: `error: ${msg}`,
      judgeConfidence: "low",
      passes: !expectedDistillable, // an error counts as "not distillable"
    };
  }
}

function formatJudgeReport(results: JudgeRunResult[]): { markdown: string; metrics: Record<string, number> } {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const r of results) {
    if (r.expectedDistillable && r.actualDistillable) tp++;
    else if (!r.expectedDistillable && r.actualDistillable) fp++;
    else if (!r.expectedDistillable && !r.actualDistillable) tn++;
    else fn++;
  }
  const total = results.length;
  const correct = tp + tn;
  const accuracy = total > 0 ? correct / total : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const lines: string[] = [];
  lines.push(`# SkillCam Judge Eval`);
  lines.push(``);
  lines.push(`Generated at ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`Fixtures: ${total} (${tp + fn} distillable, ${tn + fp} not)`);
  lines.push(``);
  lines.push(`## Confusion matrix`);
  lines.push(``);
  lines.push(`|              | judged distillable | judged not |`);
  lines.push(`|--------------|--------------------|------------|`);
  lines.push(`| **distillable** | TP = ${tp} | FN = ${fn} |`);
  lines.push(`| **not**         | FP = ${fp} | TN = ${tn} |`);
  lines.push(``);
  lines.push(`## Metrics`);
  lines.push(``);
  lines.push(`- **Accuracy**: ${(accuracy * 100).toFixed(1)}% (${correct}/${total})`);
  lines.push(`- **Precision**: ${(precision * 100).toFixed(1)}% — when the judge says distillable, how often is it right`);
  lines.push(`- **Recall**: ${(recall * 100).toFixed(1)}% — of the truly distillable sessions, how many does the judge catch`);
  lines.push(`- **F1**: ${(f1 * 100).toFixed(1)}%`);
  lines.push(``);
  lines.push(`## Per-fixture`);
  lines.push(``);
  lines.push(`| Fixture | Expected | Judged | Confidence | Reason |`);
  lines.push(`|---------|----------|--------|------------|--------|`);
  // Escape backslashes BEFORE pipes — otherwise an input containing `\|`
  // would survive the pipe-replace as `\|` and break the table column
  // (CodeQL js/incomplete-sanitization). Same idea as escaping HTML
  // entities: do `&` first or you double-escape what you just emitted.
  const mdCellEscape = (s: string): string =>
    s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  for (const r of results) {
    const exp = r.expectedDistillable ? "distillable" : "not";
    const got = r.actualDistillable ? "distillable" : "not";
    const mark = r.passes ? "✓" : "✗";
    lines.push(
      `| ${r.name} | ${exp} | ${got} ${mark} | ${r.judgeConfidence} | ${mdCellEscape(r.judgeReason.slice(0, 80))} |`
    );
  }

  return {
    markdown: lines.join("\n"),
    metrics: { tp, fp, tn, fn, total, accuracy, precision, recall, f1 },
  };
}

async function mainJudgeOnly() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Judge eval: running ${FIXTURES.length} fixtures...\n`);
  const results: JudgeRunResult[] = [];
  for (const fix of FIXTURES) {
    process.stdout.write(`  ${fix.name}... `);
    const r = await runJudgeOnFixture(fix);
    results.push(r);
    console.log(r.passes ? "✓" : `✗ (judged ${r.actualDistillable ? "distillable" : "not"}, expected ${r.expectedDistillable ? "distillable" : "not"})`);
  }
  const { markdown, metrics } = formatJudgeReport(results);
  writeFileSync(join(OUT_DIR, "judge-results.md"), markdown, "utf-8");
  writeFileSync(join(OUT_DIR, "judge-results.json"), JSON.stringify(metrics, null, 2), "utf-8");
  console.log(`\nReport: ${join(OUT_DIR, "judge-results.md")}`);
  console.log(`Metrics: ${join(OUT_DIR, "judge-results.json")}`);
  console.log(
    `\nAccuracy: ${(metrics.accuracy * 100).toFixed(1)}% (${metrics.tp + metrics.tn}/${metrics.total}) · Precision: ${(metrics.precision * 100).toFixed(1)}% · Recall: ${(metrics.recall * 100).toFixed(1)}% · F1: ${(metrics.f1 * 100).toFixed(1)}%`
  );
  if (metrics.accuracy < 1.0) {
    process.exit(1);
  }
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

const args = process.argv.slice(2);
const entryPoint = args.includes("--judge-only") ? mainJudgeOnly : main;
entryPoint().catch((err) => {
  console.error(err);
  process.exit(1);
});
