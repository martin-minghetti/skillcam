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

// Linear-time kebab validator. The naive /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
// is polynomial-time under backtracking when fed strings like "a-----..."
// (CodeQL js/polynomial-redos). This formulation consumes one char per
// step with an alternation (either a kebab char, or a dash immediately
// followed by a kebab char), which has no ambiguous paths.
const KEBAB = /^[a-z](?:[a-z0-9]|-[a-z0-9])*$/;

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
  const norm = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return KEBAB.test(norm) ? norm.slice(0, 64) : fallback;
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

  if (typeof obj.abort === "string") {
    const abort = obj.abort === "no_artifact" ? "no_artifact" : "no_reusable_pattern";
    const reason = typeof obj.reason === "string" ? obj.reason : "no reason";
    return { kind: "abort", payload: { abort, reason } };
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

  if (!payload.description || !payload.when_to_use || payload.steps.length === 0) {
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

function extractFirstJson(text: string): Record<string, unknown> | null {
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
description: ${payload.description}
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
