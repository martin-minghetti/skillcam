/**
 * DoS guards (M4). Centralized so both the CLI and parsers agree.
 */
export const MAX_SESSION_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_LINE_BYTES = 1024 * 1024;          // 1MB
export const MAX_SKILL_BYTES = 100 * 1024;          // 100KB

/**
 * B1 — billing guard. Cap how many session messages get into the LLM prompt.
 * A 50MB JSONL can hold ~175k messages; multiplied by per-message slice budget
 * the resulting prompt approaches 21M input tokens (~$65 USD on Sonnet 4.6).
 *
 * 1000 messages keeps the worst-case prompt around ~1MB / ~250k tokens
 * (~$0.75 USD), which is still generous for any real session and bounds the
 * cost of a hostile or accidentally-huge input. We keep the most recent
 * messages — a session's productive end is usually where the reusable skill
 * pattern emerges.
 */
export const MAX_PROMPT_MESSAGES = 1000;

/**
 * Slice the message list down to the most recent MAX_PROMPT_MESSAGES.
 * Returns the trimmed list and a `truncatedCount` so the caller can warn.
 */
export function capPromptMessages<T>(messages: readonly T[]): {
  messages: T[];
  truncatedCount: number;
} {
  if (messages.length <= MAX_PROMPT_MESSAGES) {
    return { messages: [...messages], truncatedCount: 0 };
  }
  const truncatedCount = messages.length - MAX_PROMPT_MESSAGES;
  return {
    messages: messages.slice(-MAX_PROMPT_MESSAGES),
    truncatedCount,
  };
}

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
