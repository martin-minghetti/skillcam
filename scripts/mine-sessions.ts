#!/usr/bin/env tsx
/**
 * Mining tool — scans ~/.claude/projects/*\/*.jsonl, parses each with the
 * existing parseClaudeCodeSession, and emits a markdown report + JSON dump
 * for manual classification (distillable / not / maybe).
 *
 * Post-launch goal: replace the 5 synthetic eval fixtures with 25-30 real
 * sessions mined from the author's own workflow. Output of this script is
 * the classification surface — human decides which rows get promoted to
 * fixtures.
 *
 * Local-only. No network. Paths are anonymized before printing.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { parseClaudeCodeSession } from "../src/parsers/claude-code.js";
import type { ParsedSession } from "../src/parsers/types.js";

interface MinedSession {
  filePath: string;
  sizeKb: number;
  parsed: ParsedSession;
  firstUserMessage: string;
  lastAssistantMessage: string;
  durationSec: number;
  score: number;
  scoreReasons: string[];
  tier: "A" | "B" | "C";
}

const ROOT = join(homedir(), ".claude", "projects");
const MIN_SIZE = 10 * 1024;          // 10 KB — below this is empty/no-start
const MAX_SIZE = 8 * 1024 * 1024;    // 8 MB — above is multi-day marathon session
const OUT_DIR = resolve(join(import.meta.dirname ?? ".", "../eval/out/mining"));

const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".sql", ".sh", ".rb", ".java", ".kt", ".swift", ".c", ".cpp", ".h"];

function anonymizePath(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function stripBoilerplate(s: string): string {
  // Drop slash-command + hook + system-reminder tags to expose the real intent.
  let out = s;
  out = out.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  out = out.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
  out = out.replace(/<command-name>[\s\S]*?<\/command-name>/g, "");
  out = out.replace(/<command-message>[\s\S]*?<\/command-message>/g, "");
  out = out.replace(/<command-args>[\s\S]*?<\/command-args>/g, "");
  out = out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  out = out.replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, "");
  return out.trim();
}

function truncate(s: string, n: number): string {
  const clean = stripBoilerplate(s).replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "…" : clean;
}

function hasCodeFile(files: string[]): boolean {
  return files.some(f => CODE_EXTS.some(ext => f.toLowerCase().endsWith(ext)));
}

function isSlashCommandOnly(firstUser: string): boolean {
  // If after stripping boilerplate there's nothing left, the session was
  // triggered by a slash command with no user-supplied intent.
  return stripBoilerplate(firstUser).length < 20;
}

function scoreSession(
  p: ParsedSession,
  durationSec: number,
  firstUser: string
): { score: number; reasons: string[]; tier: "A" | "B" | "C" } {
  let score = 0;
  const reasons: string[] = [];
  const hasCode = hasCodeFile(p.filesModified);
  const slashOnly = isSlashCommandOnly(firstUser);
  const inProjectsDir = p.project.includes("/Projects/");

  if (p.filesModified.length >= 1) { score += 3; reasons.push(`+3 files:${p.filesModified.length}`); }
  if (hasCode) { score += 3; reasons.push(`+3 code-files`); }
  if (p.totalToolCalls >= 3 && p.totalToolCalls <= 30) { score += 2; reasons.push(`+2 tools-in-range:${p.totalToolCalls}`); }
  if (inProjectsDir) { score += 2; reasons.push(`+2 in-Projects`); }
  if (p.summary.userMessages >= 2) { score += 1; reasons.push(`+1 multi-turn:${p.summary.userMessages}`); }
  if (p.totalTokens.input > 1000) { score += 1; reasons.push(`+1 tokens:${p.totalTokens.input}`); }
  if (p.totalToolCalls === 0) { score -= 3; reasons.push(`-3 zero-tools`); }
  if (durationSec < 60) { score -= 1; reasons.push(`-1 short:${durationSec}s`); }
  if (p.totalToolCalls > 100) { score -= 2; reasons.push(`-2 marathon:${p.totalToolCalls}`); }
  if (slashOnly) { score -= 2; reasons.push(`-2 slash-only-intent`); }

  // Tier: A = promising for mining, B = maybe, C = skip
  let tier: "A" | "B" | "C";
  if (hasCode && inProjectsDir && !slashOnly && p.totalToolCalls >= 3) tier = "A";
  else if (p.filesModified.length >= 1 && p.totalToolCalls >= 3 && !slashOnly) tier = "B";
  else tier = "C";

  return { score, reasons, tier };
}

function* walkJsonl(root: string): Generator<string> {
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return;
  }
  for (const dir of projectDirs) {
    const full = join(root, dir);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let files: string[];
    try {
      files = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith(".jsonl")) yield join(full, f);
    }
  }
}

async function main() {
  console.error(`Scanning ${ROOT}…`);
  const mined: MinedSession[] = [];
  let scanned = 0;
  let skipped_size = 0;
  let skipped_parse = 0;

  for (const filePath of walkJsonl(ROOT)) {
    scanned++;
    let st;
    try {
      st = statSync(filePath);
    } catch {
      continue;
    }
    if (st.size < MIN_SIZE || st.size > MAX_SIZE) { skipped_size++; continue; }

    let jsonl: string;
    try {
      jsonl = readFileSync(filePath, "utf-8");
    } catch {
      skipped_parse++;
      continue;
    }

    let parsed: ParsedSession;
    try {
      parsed = parseClaudeCodeSession(jsonl);
    } catch {
      skipped_parse++;
      continue;
    }

    if (parsed.messages.length === 0) { skipped_parse++; continue; }

    const firstUser = parsed.messages.find(m => m.role === "user");
    const lastAssistant = [...parsed.messages].reverse().find(m => m.role === "assistant");
    const firstUserMessage = firstUser ? truncate(firstUser.content, 300) : "";
    const lastAssistantMessage = lastAssistant ? truncate(lastAssistant.content, 300) : "";

    const start = parsed.startedAt ? Date.parse(parsed.startedAt) : 0;
    const end = parsed.endedAt ? Date.parse(parsed.endedAt) : 0;
    const durationSec = start && end ? Math.round((end - start) / 1000) : 0;

    const { score, reasons, tier } = scoreSession(parsed, durationSec, firstUser?.content ?? "");

    mined.push({
      filePath,
      sizeKb: Math.round(st.size / 1024),
      parsed,
      firstUserMessage,
      lastAssistantMessage,
      durationSec,
      score,
      scoreReasons: reasons,
      tier,
    });
  }

  mined.sort((a, b) => b.score - a.score);

  const byTier = { A: mined.filter(m => m.tier === "A"), B: mined.filter(m => m.tier === "B"), C: mined.filter(m => m.tier === "C") };
  console.error(
    `Scanned ${scanned}. Parsed ${mined.length}. Skipped size: ${skipped_size}. Skipped parse: ${skipped_parse}.`
  );
  console.error(`Tiers — A: ${byTier.A.length}, B: ${byTier.B.length}, C: ${byTier.C.length}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const reportPath = join(OUT_DIR, "sessions-report.md");
  const priorityPath = join(OUT_DIR, "sessions-priority.md");
  const jsonPath = join(OUT_DIR, "sessions.json");

  function renderReport(title: string, subtitle: string, sessions: MinedSession[]): string {
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(subtitle);
    lines.push("");
    lines.push("## Legend");
    lines.push("");
    lines.push("- **score**: heuristic (+3 files, +3 code-files, +2 tools 3-30, +2 in-Projects, +1 multi-turn, +1 tokens>1k, −3 zero-tools, −1 short, −2 marathon, −2 slash-only-intent)");
    lines.push("- **tier**: A = promising (code files, Projects dir, real intent), B = maybe, C = skip");
    lines.push("- Classification column is empty — edit this file in place adding `distillable` / `not` / `maybe` / `skip`.");
    lines.push("");
    lines.push("## Summary table");
    lines.push("");
    lines.push("| # | Tier | Score | Tools | Files | Dur (s) | Tokens | Project | Intent | Class |");
    lines.push("|---|:----:|------:|------:|------:|--------:|-------:|---------|--------|-------|");
    sessions.forEach((m, i) => {
      const project = anonymizePath(m.parsed.project).split("/").slice(-2).join("/") || "?";
      const intent = truncate(m.firstUserMessage, 80).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      lines.push(
        `| ${i + 1} | ${m.tier} | ${m.score} | ${m.parsed.totalToolCalls} | ${m.parsed.filesModified.length} | ${m.durationSec} | ${m.parsed.totalTokens.input} | ${project} | ${intent} |  |`
      );
    });
    lines.push("");
    lines.push("## Per-session detail");
    lines.push("");
    sessions.forEach((m, i) => {
      lines.push(`### ${i + 1}. [${m.tier}] \`${anonymizePath(m.filePath).split("/").slice(-3).join("/")}\``);
      lines.push("");
      lines.push(`- **Score**: ${m.score} · **Reasons**: ${m.scoreReasons.join(", ")}`);
      lines.push(`- **Project**: \`${anonymizePath(m.parsed.project)}\` · **Branch**: \`${m.parsed.branch}\``);
      lines.push(`- **Size**: ${m.sizeKb} KB · **Duration**: ${m.durationSec}s · **Tool calls**: ${m.parsed.totalToolCalls} (${m.parsed.summary.uniqueTools.join(", ")})`);
      lines.push(`- **Files modified** (${m.parsed.filesModified.length}): ${m.parsed.filesModified.slice(0, 5).map(f => `\`${anonymizePath(f).split("/").slice(-3).join("/")}\``).join(", ") || "(none)"}`);
      lines.push(`- **Tokens**: in ${m.parsed.totalTokens.input} / out ${m.parsed.totalTokens.output}`);
      lines.push("");
      lines.push(`**Intent**:`);
      lines.push("");
      lines.push("> " + (m.firstUserMessage.replace(/\n/g, " ") || "_(empty)_"));
      lines.push("");
      lines.push(`**Outcome hint** (last assistant message):`);
      lines.push("");
      lines.push("> " + (m.lastAssistantMessage.replace(/\n/g, " ") || "_(empty)_"));
      lines.push("");
      lines.push(`**Classification**: _______`);
      lines.push("");
      lines.push("---");
      lines.push("");
    });
    return lines.join("\n");
  }

  const fullReport = renderReport(
    "Claude Code sessions — all",
    `Total parsed: **${mined.length}** · scanned: ${scanned} · skipped size/parse: ${skipped_size}/${skipped_parse}. Tiers — A: ${byTier.A.length}, B: ${byTier.B.length}, C: ${byTier.C.length}.`,
    mined
  );
  writeFileSync(reportPath, fullReport);

  const priorityList = [...byTier.A, ...byTier.B];
  const priorityReport = renderReport(
    "Claude Code sessions — priority (Tier A + B)",
    `Filtered to the ${priorityList.length} sessions most likely to yield fixture value (code files + real intent + >=3 tool calls). Skipping ${byTier.C.length} Tier-C sessions from full report. Full list in \`sessions-report.md\`.`,
    priorityList
  );
  writeFileSync(priorityPath, priorityReport);

  const jsonDump = mined.map(m => ({
    filePath: m.filePath,
    sizeKb: m.sizeKb,
    score: m.score,
    scoreReasons: m.scoreReasons,
    firstUserMessage: m.firstUserMessage,
    lastAssistantMessage: m.lastAssistantMessage,
    durationSec: m.durationSec,
    session: m.parsed,
  }));
  writeFileSync(jsonPath, JSON.stringify(jsonDump, null, 2));

  console.error(`\nWrote ${reportPath}`);
  console.error(`Wrote ${priorityPath}`);
  console.error(`Wrote ${jsonPath}`);
  console.error(`\nNext: open sessions-priority.md and tag each session as distillable/not/maybe/skip.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
