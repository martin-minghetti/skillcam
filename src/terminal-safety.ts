/**
 * A1 — sanitize user-controlled strings before printing them to the terminal.
 *
 * Session JSONL fields (`cwd`, `branch`, file paths) are attacker-controllable
 * if a hostile session lands in `~/.claude/projects` or `~/.codex/sessions`.
 * Without scrubbing, a `cwd` like `"/tmp\x1b[2J\x1b[H\x1b[31mFAKE"` would clear
 * the user's terminal and recolor subsequent output, or set a fake terminal
 * title via OSC sequences (`\x1b]0;...\x07`).
 *
 * Strategy: drop every C0 + C1 control character (including \n, \r, \t) so
 * single-line display fields stay single-line and no escape sequence can
 * begin (\x1b is the entry to all CSI/OSC/SS3 codes). Printable Unicode is
 * preserved.
 */
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/g;

export function sanitizeForTerminal(s: string): string {
  return s.replace(CONTROL_CHARS_RE, "");
}

/**
 * Convenience wrapper for arrays — sanitizes each element.
 */
export function sanitizeListForTerminal(items: readonly string[]): string[] {
  return items.map(sanitizeForTerminal);
}
