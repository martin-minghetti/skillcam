/**
 * DoS guards (M4). Centralized so both the CLI and parsers agree.
 */
export const MAX_SESSION_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_LINE_BYTES = 1024 * 1024;          // 1MB
export const MAX_SKILL_BYTES = 100 * 1024;          // 100KB

/**
 * True when the given byte size is within the session size cap.
 * Used pre-read so we never load a giant or adversarial file into memory.
 */
export function isSessionSizeAllowed(sizeBytes: number): boolean {
  return sizeBytes <= MAX_SESSION_BYTES;
}

/**
 * Truncate a string to at most MAX_SKILL_BYTES, appending a marker.
 * Used on LLM output before writing to disk in case a compromised provider
 * (or MITM) responds with megabytes of text.
 */
export function truncateSkill(skill: string): string {
  if (skill.length <= MAX_SKILL_BYTES) return skill;
  return skill.slice(0, MAX_SKILL_BYTES) + "\n... [TRUNCATED]";
}
