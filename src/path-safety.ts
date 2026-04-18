import { resolve, sep } from "path";

/**
 * C1 — sanitize an LLM-controlled string for use as a filename.
 * The LLM writes a `name:` field in the skill frontmatter, which we then
 * use as the output filename. Without this sanitization, `name: ../../.zshrc`
 * would make the CLI escape the output directory and overwrite arbitrary
 * files the user has write access to.
 *
 * Rules:
 * - keep only [a-zA-Z0-9-_]; replace anything else with "-"
 * - clamp to 100 chars (arbitrary but generous)
 * - strip leading "." or "-" so the result cannot be a dotfile or a flag-like path
 * - if the result is empty after all that, return the provided fallback
 */
export function sanitizeSkillName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 100);
  if (cleaned.length === 0) return fallback;
  const trimmed = cleaned.replace(/^[-.]+/, "");
  return trimmed.length === 0 ? fallback : trimmed;
}

/**
 * C1 — verify that a resolved file path stays inside a resolved directory.
 * Both sides are path.resolve'd before comparison. Returns true when `file`
 * is `dir` itself (unusual but harmless) or a descendant of `dir`.
 */
export function isInsideDirectory(file: string, dir: string): boolean {
  const rFile = resolve(file);
  const rDir = resolve(dir);
  return rFile === rDir || rFile.startsWith(rDir + sep);
}
