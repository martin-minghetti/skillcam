/**
 * v0.2.6 — JSON → SKILL.md renderer.
 *
 * The distiller prompt now asks the LLM for a strict JSON payload instead of
 * free-form markdown. This module validates it and renders the canonical
 * SKILL.md format. Benefits:
 *   - frontmatter is assembled in TS, not trusted to the LLM
 *   - schema validation catches malformed outputs before they hit disk
 *   - we can version the prompt and re-render old sessions later
 */

export const DISTILL_PROMPT_VERSION = "v2.2026-04-19";

export const ALLOWED_TAGS = [
  "testing",
  "debugging",
  "api",
  "database",
  "security",
  "auth",
  "performance",
  "deployment",
  "refactor",
  "typescript",
  "react",
  "next-js",
  "supabase",
  "build",
  "tooling",
  "ci",
  "migrations",
  "observability",
] as const;

type AllowedTag = typeof ALLOWED_TAGS[number];
const TAG_SET = new Set<string>(ALLOWED_TAGS);

export interface SkillPayload {
  name: string;
  description: string;
  when_to_use: string;
  steps: string[];
  example: string;
  key_decisions: string[];
  tags: string[];
  confidence: "high" | "medium" | "low";
  why_this_worked: string;
}

export interface AbortPayload {
  abort: "no_artifact" | "no_reusable_pattern";
  reason: string;
}

export type DistillResult =
  | { kind: "skill"; payload: SkillPayload }
  | { kind: "abort"; payload: AbortPayload };

const MAX_NAME_LEN = 64;
const MAX_RAW_INPUT_LEN = 256;

// Char-by-char kebab validator. Avoids regex entirely (CodeQL
// js/polynomial-redos flagged the earlier replace+test chain as
// polynomial under adversarial inputs). Pure O(n) with a constant
// upper bound on n thanks to MAX_NAME_LEN.
function isKebab(s: string): boolean {
  if (s.length === 0 || s.length > MAX_NAME_LEN) return false;
  const first = s.charCodeAt(0);
  const isLower = (c: number) => c >= 97 && c <= 122;
  const isDigit = (c: number) => c >= 48 && c <= 57;
  if (!isLower(first)) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isLower(c) || isDigit(c)) continue;
    if (c === 45) {
      if (i === s.length - 1) return false;
      const next = s.charCodeAt(i + 1);
      if (!(isLower(next) || isDigit(next))) return false;
      continue;
    }
    return false;
  }
  return true;
}

// Normalize a free-form string to kebab-case without regex: lowercase,
// collapse runs of non-alphanumeric to a single '-', then trim leading
// and trailing '-'. Matches the previous behavior with linear time.
function toKebabChars(raw: string): string {
  const bounded = raw.length > MAX_RAW_INPUT_LEN ? raw.slice(0, MAX_RAW_INPUT_LEN) : raw;
  const lower = bounded.toLowerCase();
  const chars: string[] = [];
  let lastDash = false;
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    const alphaNum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    if (alphaNum) {
      chars.push(lower[i] ?? "");
      lastDash = false;
    } else if (!lastDash) {
      chars.push("-");
      lastDash = true;
    }
  }
  let start = 0;
  let end = chars.length;
  while (start < end && chars[start] === "-") start++;
  while (end > start && chars[end - 1] === "-") end--;
  return chars.slice(start, end).join("");
}

function normalizeTag(t: string): string {
  return t.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function coerceTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const norm = normalizeTag(t);
    if (!TAG_SET.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 4) break;
  }
  return out;
}

function capList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeKebab(raw: unknown, fallback: string): string {
  const base = typeof raw === "string" ? raw : fallback;
  const norm = toKebabChars(base);
  return isKebab(norm) ? norm.slice(0, MAX_NAME_LEN) : fallback;
}

export function parseDistillPayload(
  raw: string,
  fallbackName: string
): DistillResult {
  const text = raw.trim();
  const obj = extractFirstJson(text);
  if (!obj) {
    throw new Error("Distiller output did not contain a parseable JSON object");
  }

  // Audit #3 D1 — strict abort allow-list. Previously any string value for
  // `abort` was coerced into "no_reusable_pattern", which let the LLM route
  // arbitrary payloads through the abort branch (a load-bearing rung for the
  // R1 terminal-injection chain). Now only the two documented kinds are
  // accepted; anything else falls through to the schema validator below and
  // gets rejected with the standard "missing required fields" error, which
  // the caller (`distiller.ts`) catches and falls back to template mode.
  if (obj.abort === "no_artifact" || obj.abort === "no_reusable_pattern") {
    const reason = typeof obj.reason === "string" ? obj.reason : "no reason";
    return { kind: "abort", payload: { abort: obj.abort, reason } };
  }

  const payload: SkillPayload = {
    name: sanitizeKebab(obj.name, fallbackName),
    description: typeof obj.description === "string" ? obj.description.trim() : "",
    when_to_use: typeof obj.when_to_use === "string" ? obj.when_to_use.trim() : "",
    steps: capList(obj.steps, 8),
    example: typeof obj.example === "string" ? obj.example.trim() : "",
    key_decisions: capList(obj.key_decisions, 5),
    tags: coerceTags(obj.tags),
    confidence: coerceConfidence(obj.confidence),
    why_this_worked:
      typeof obj.why_this_worked === "string" ? obj.why_this_worked.trim() : "",
  };

  // Audit #5 N1 — validate description AFTER normalize, not before. A
  // string of pure C0/C1 controls passes .trim() (it's not whitespace),
  // satisfies the "required field" check, and then collapses to "" when
  // renderSkillMarkdown calls normalizeFrontmatterValue. Result was a
  // skill written with `description: ` blank, dedup downstream skipping
  // it, contract silently broken. Run normalize here too and reject if
  // the post-normalize value is empty.
  const normalizedDescription = normalizeFrontmatterValue(payload.description);
  if (
    !normalizedDescription ||
    !payload.when_to_use ||
    payload.steps.length === 0
  ) {
    throw new Error(
      "Distiller output missing required fields: description / when_to_use / steps"
    );
  }

  return { kind: "skill", payload };
}

function coerceConfidence(raw: unknown): SkillPayload["confidence"] {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "low";
}

export function extractFirstJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface RenderContext {
  sessionId: string;
  agent: string;
  createdISO: string;
  distillPromptVersion?: string;
}

/**
 * v0.4.3 I2 — normalize a frontmatter value to a single, terminal-safe line.
 *
 * The dedup extractor (and any tool that reads the frontmatter line by
 * line) can only see the first physical line of a value. The renderer is
 * the right place to enforce single-line: strip C0/C1 control bytes (no
 * ANSI, no NUL), collapse newlines + whitespace runs to a single space.
 * Closes the multiline-bypass family of dedup misses.
 */
function normalizeFrontmatterValue(s: string): string {
  return s
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")  // C0/C1 controls (incl. \n, \r, \t, ESC)
    .replace(/\s+/g, " ")                    // collapse whitespace runs
    .trim();
}

export function renderSkillMarkdown(
  payload: SkillPayload,
  ctx: RenderContext
): string {
  const promptVersion = ctx.distillPromptVersion ?? DISTILL_PROMPT_VERSION;
  const tags = payload.tags.length > 0 ? payload.tags : ["auto-extracted"];
  const stepsBlock = payload.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const decisionsBlock =
    payload.key_decisions.length > 0
      ? payload.key_decisions.map((d) => `- ${d}`).join("\n")
      : "- (none captured)";

  return `---
name: ${payload.name}
description: ${normalizeFrontmatterValue(payload.description)}
source_session: ${ctx.sessionId}
source_agent: ${ctx.agent}
created: ${ctx.createdISO}
distill_prompt_version: ${promptVersion}
confidence: ${payload.confidence}
tags:
${tags.map((t) => `  - ${t}`).join("\n")}
---

# ${titleize(payload.name)}

## When to use
${payload.when_to_use}

## Steps
${stepsBlock}

## Example
${payload.example || "(no example captured)"}

## Key decisions
${decisionsBlock}

## Why this worked
${payload.why_this_worked || "(not captured)"}
`;
}

function titleize(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
