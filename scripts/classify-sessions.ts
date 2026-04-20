#!/usr/bin/env tsx
/**
 * Read sessions.json (produced by mine-sessions.ts) and apply heuristics
 * to pre-classify each Tier A/B session as `distillable` / `not` /
 * `review`. Emits a compact markdown for final human validation.
 *
 * Heuristics (intentionally conservative — false "review" is cheap, a
 * mis-labeled fixture breaks the eval):
 *
 *   DISTILLABLE if all hold:
 *     - tool calls in [4, 60]
 *     - files modified in [1, 15]
 *     - duration in [60, 3600] sec  (1 min – 1 hr)
 *     - intent not a pure question ("qué opinás", "cómo va", "hablemos")
 *     - has code-file in filesModified
 *
 *   NOT-DISTILLABLE if any holds:
 *     - tool calls < 3
 *     - files modified = 0
 *     - duration < 30 sec
 *     - intent matches conversational pattern (opinion/status questions)
 *     - marathon (tool calls > 200 AND duration > 6h) — execution-heavy, no clean skill
 *
 *   REVIEW otherwise.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const OUT_DIR = resolve(join(import.meta.dirname ?? ".", "../eval/out/mining"));
const JSON_PATH = join(OUT_DIR, "sessions.json");
const REPORT_PATH = join(OUT_DIR, "classification-proposal.md");

interface MinedJsonEntry {
  filePath: string;
  sizeKb: number;
  score: number;
  scoreReasons: string[];
  firstUserMessage: string;
  lastAssistantMessage: string;
  durationSec: number;
  session: {
    sessionId: string;
    project: string;
    totalToolCalls: number;
    totalTokens: { input: number; output: number };
    filesModified: string[];
    summary: { userMessages: number; assistantMessages: number; toolCalls: number; uniqueTools: string[] };
    messages: Array<{ role: string; content: string; toolCalls: unknown[] }>;
  };
}

// Code files: strong signal of "real coding session". Markdown alone usually
// means vault/doc work, which is not the SkillCam target use case.
const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".sql", ".sh", ".rb", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".yaml", ".yml", ".json", ".toml"];

const CONVERSATIONAL_RE = /\b(qué opinás|que opinas|cómo va|como va|hablemos|contame|tenés acceso|entrevista|cómo invoco|luciana|juan compro|topo|cbd|florcita|hay otra terminal|otra terminal|volví del gimnasio|volvi del gimnasio|cuanto debía|cuanto debia|ahí volví|ahi volvi|recordás|recordas|te acordás|te acordas|cómo quedamos|como quedamos|qué tengo para hacer|que tengo para hacer|retomemos|como venimos|cómo venimos|charla|guardá|guarda en obsidian|cuales son las mejores|luciana constestó|constestó|cómo funcionás|como funcionas|porqué obsidian|new contributors)/i;
const EXECUTION_RE = /\b(ejecut(á|a|ar) el plan|execute the plan|ejecutá|ejecuta el plan|corré el plan)\b/i;

interface Classified extends MinedJsonEntry {
  label: "distillable" | "not" | "review";
  reason: string;
}

function anonymize(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function intentClean(raw: string): string {
  return raw.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function classify(m: MinedJsonEntry): { label: Classified["label"]; reason: string } {
  const s = m.session;
  const tools = s.totalToolCalls;
  const files = s.filesModified.length;
  const dur = m.durationSec;
  const intent = intentClean(m.firstUserMessage);
  const hasCode = s.filesModified.some(f => CODE_EXTS.some(e => f.toLowerCase().endsWith(e)));

  if (tools < 3) return { label: "not", reason: "<3 tool calls" };
  if (files === 0) return { label: "not", reason: "no files modified" };
  if (dur < 30) return { label: "not", reason: "<30s duration" };
  if (intent.length > 30 && CONVERSATIONAL_RE.test(intent)) return { label: "not", reason: "conversational intent" };
  if (tools > 200 && dur > 6 * 3600) return { label: "not", reason: "marathon execution (>200 tools, >6h)" };

  const inToolsRange = tools >= 4 && tools <= 60;
  const inFilesRange = files >= 1 && files <= 15;
  const inDurRange = dur >= 60 && dur <= 3600;

  if (inToolsRange && inFilesRange && inDurRange && hasCode && !EXECUTION_RE.test(intent)) {
    return { label: "distillable", reason: "focused build/fix session" };
  }
  if (inToolsRange && inFilesRange && inDurRange && hasCode && EXECUTION_RE.test(intent)) {
    return { label: "distillable", reason: "focused plan-execution session" };
  }

  // Edge cases → review
  const reasons: string[] = [];
  if (!inToolsRange) reasons.push(`tools=${tools} out-of-range`);
  if (!inFilesRange) reasons.push(`files=${files} out-of-range`);
  if (!inDurRange) reasons.push(`dur=${dur}s out-of-range`);
  if (!hasCode) reasons.push("no-code-file");
  return { label: "review", reason: reasons.join(", ") || "borderline" };
}

function main() {
  const raw = readFileSync(JSON_PATH, "utf-8");
  const all: MinedJsonEntry[] = JSON.parse(raw);

  // Only score-based tier is not in JSON; re-derive by recomputing score reasons
  const tierA = all.filter(m => m.scoreReasons.some(r => r.includes("+3 code-files")) && m.scoreReasons.some(r => r.includes("+2 in-Projects")) && m.session.totalToolCalls >= 3);
  const tierB = all.filter(m => !tierA.includes(m) && m.session.filesModified.length >= 1 && m.session.totalToolCalls >= 3 && !m.scoreReasons.some(r => r.includes("slash-only")));

  const candidates = [...tierA, ...tierB];
  const classified: Classified[] = candidates.map(m => ({ ...m, ...classify(m) }));

  const buckets = {
    distillable: classified.filter(c => c.label === "distillable"),
    not: classified.filter(c => c.label === "not"),
    review: classified.filter(c => c.label === "review"),
  };

  console.error(`Classified ${classified.length}: distillable=${buckets.distillable.length}, not=${buckets.not.length}, review=${buckets.review.length}`);

  const lines: string[] = [];
  lines.push("# Classification proposal — Tier A + B sessions");
  lines.push("");
  lines.push(`Auto-classified ${classified.length} sessions.`);
  lines.push("");
  lines.push(`- **distillable**: ${buckets.distillable.length} (expected to produce a skill)`);
  lines.push(`- **not**: ${buckets.not.length} (expected to abort)`);
  lines.push(`- **review**: ${buckets.review.length} (borderline — needs human call)`);
  lines.push("");
  lines.push("Heuristics in `scripts/classify-sessions.ts`. Flip a row's label by editing it in place.");
  lines.push("");

  function renderBucket(title: string, rows: Classified[]) {
    lines.push(`## ${title} (${rows.length})`);
    lines.push("");
    lines.push("| # | Label | Reason | Tools | Files | Dur | Tokens-in | Project | Intent |");
    lines.push("|---|-------|--------|------:|------:|----:|----------:|---------|--------|");
    rows.forEach((c, i) => {
      const project = anonymize(c.session.project).split("/").slice(-2).join("/") || "?";
      const intent = intentClean(c.firstUserMessage).slice(0, 70).replace(/\|/g, "\\|");
      lines.push(
        `| ${i + 1} | ${c.label} | ${c.reason} | ${c.session.totalToolCalls} | ${c.session.filesModified.length} | ${c.durationSec}s | ${c.session.totalTokens.input} | ${project} | ${intent} |`
      );
    });
    lines.push("");
  }

  renderBucket("Distillable (should produce skill)", buckets.distillable);
  renderBucket("Not-distillable (should abort)", buckets.not);
  renderBucket("Review (borderline)", buckets.review);

  writeFileSync(REPORT_PATH, lines.join("\n"));
  console.error(`\nWrote ${REPORT_PATH}`);
}

main();
