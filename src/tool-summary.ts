import { basename, relative, isAbsolute, resolve, sep } from "path";
import { homedir } from "os";
import type { ToolCall } from "./parsers/types.js";

/**
 * v0.2.6 — Semantic stripping per tool type.
 *
 * Replaces the v0.2.5 pattern of `JSON.stringify(tc.input).slice(0, 100)`,
 * which truncated mid-string and leaked `/Users/<name>/...` paths into the
 * prompt. For each known tool we extract only the semantically relevant
 * fields, anonymize paths, and keep full values when they fit under a budget.
 */

const HOME = homedir();

export function anonymizePath(p: string, projectRoot: string): string {
  if (!p || typeof p !== "string") return p;

  // Audit #3 A1 — relative paths previously passed through verbatim, which
  // leaked out-of-project structure when a tool call carried something like
  // "../../client-prod/.env". Now: resolve against projectRoot when we have
  // one; if the result stays inside the project, return the relative form;
  // otherwise collapse to basename so no traversal context survives.
  if (!isAbsolute(p)) {
    if (!isAbsolute(projectRoot)) return basename(p);
    const resolved = resolve(projectRoot, p);
    const rel = relative(projectRoot, resolved);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
    return basename(p);
  }

  if (isAbsolute(projectRoot)) {
    const rel = relative(projectRoot, p);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  if (p.startsWith(HOME + sep) || p === HOME) {
    return "~" + p.slice(HOME.length);
  }
  return basename(p);
}

function truncateSmart(s: string, max: number): string {
  if (!s || s.length <= max) return s;
  // Prefer breaking at whitespace or punctuation to avoid cutting mid-token.
  const window = s.slice(0, max);
  const cut = Math.max(
    window.lastIndexOf(" "),
    window.lastIndexOf("\n"),
    window.lastIndexOf(";"),
    window.lastIndexOf(","),
    window.lastIndexOf(")")
  );
  const boundary = cut > max * 0.6 ? cut : max;
  return s.slice(0, boundary).trimEnd() + "…";
}

export function summarizeToolCall(
  tc: ToolCall,
  projectRoot: string,
  maxFieldChars = 160
): string {
  const input = tc.input ?? {};
  const name = tc.name;

  const path = (k: string) => {
    const v = input[k];
    return typeof v === "string" ? anonymizePath(v, projectRoot) : undefined;
  };
  const str = (k: string) => {
    const v = input[k];
    return typeof v === "string" ? truncateSmart(v, maxFieldChars) : undefined;
  };

  switch (name) {
    case "Read":
    case "NotebookRead": {
      const fp = path("file_path");
      return fp ? `Read ${fp}` : `${name}`;
    }
    case "Write": {
      const fp = path("file_path");
      const content = typeof input.content === "string" ? input.content : "";
      const bytes = content.length;
      const preview = truncateSmart(content.split("\n").slice(0, 2).join(" · "), 100);
      return fp ? `Write ${fp} (${bytes}b): ${preview}` : "Write";
    }
    case "Edit":
    case "NotebookEdit": {
      const fp = path("file_path");
      const oldS = truncateSmart(String(input.old_string ?? ""), 60);
      const newS = truncateSmart(String(input.new_string ?? ""), 60);
      return fp
        ? `Edit ${fp}: "${oldS}" → "${newS}"`
        : `Edit "${oldS}" → "${newS}"`;
    }
    case "Bash": {
      const cmd = str("command");
      const desc = str("description");
      return cmd ? `Bash: ${cmd}${desc ? ` (${desc})` : ""}` : "Bash";
    }
    case "Grep": {
      const pattern = str("pattern");
      const p = path("path");
      const glob = str("glob");
      const parts: string[] = [];
      if (pattern) parts.push(`pattern=${pattern}`);
      if (p) parts.push(`in=${p}`);
      if (glob) parts.push(`glob=${glob}`);
      return `Grep ${parts.join(" ") || "(no-args)"}`;
    }
    case "Glob": {
      const pattern = str("pattern");
      const p = path("path");
      return `Glob ${pattern ?? ""}${p ? ` in ${p}` : ""}`.trim();
    }
    case "WebFetch":
    case "WebSearch": {
      const url = str("url") ?? str("query");
      return `${name} ${url ?? ""}`.trim();
    }
    case "Agent":
    case "Task": {
      const desc = str("description") ?? str("subject");
      return `${name}: ${desc ?? ""}`.trim();
    }
    case "Skill": {
      const skill = str("skill");
      const args = str("args");
      return `Skill: ${skill ?? ""}${args ? ` (${args})` : ""}`.trim();
    }
    default: {
      // Unknown tool: emit name + safe stringification of the most promising
      // field (content, query, or first string value) instead of dumping JSON.
      const firstStr = Object.entries(input).find(
        ([, v]) => typeof v === "string"
      );
      if (!firstStr) return name;
      const [k, v] = firstStr;
      return `${name} ${k}=${truncateSmart(String(v), maxFieldChars)}`;
    }
  }
}

/**
 * Build a compact summary block of all tool calls in a session, each one as
 * a single line with semantic fields only. Caller-friendly for prompts.
 */
export function summarizeToolCalls(
  messages: Array<{ toolCalls: ToolCall[] }>,
  projectRoot: string
): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const tc of m.toolCalls) {
      lines.push("- " + summarizeToolCall(tc, projectRoot));
    }
  }
  return lines.join("\n");
}
