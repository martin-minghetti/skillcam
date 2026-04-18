/**
 * PI1 — sanitize SKILL.md output before writing to disk.
 *
 * C7 in the first audit flagged this as "mitigation parcial" — the concern is
 * that a hostile session can steer the LLM into producing a skill file that
 * carries prompt-injection payloads to the NEXT agent that reads the skill:
 *
 *   - HTML comments with hidden instructions for the downstream reader
 *   - U+202E / U+2066–2069 directional overrides that invert rendered order
 *     and hide "ignore prior instructions" behind innocent-looking text
 *   - Nested code fences (4+ backticks) that wrap authoritative-looking
 *     snippets the downstream LLM may interpret as trusted
 *   - Custom frontmatter keys (`hidden_instructions:`, `trust_level: admin`)
 *     that a consumer could accidentally treat as load-bearing
 *
 * We sanitize — strip the dangerous bits silently, count how many were
 * stripped, and let the caller surface that as a warning. Throwing would kill
 * the whole distill after an expensive LLM call; stripping is cheaper for the
 * user and still defensive.
 */

const ALLOWED_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "source_session",
  "source_agent",
  "created",
  "tags",
]);

// U+202A–U+202E (LTR/RTL embed + override + PDF) and U+2066–U+2069 (isolate
// variants). None has a legitimate use in a skill markdown file.
const DIRECTIONAL_RE = /[\u202A-\u202E\u2066-\u2069]/g;

// HTML comments. Greedy/multiline to catch payloads that span lines.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// Lines starting with 4 or more backticks — these wrap code blocks beyond
// what a legitimate markdown skill would ever need, and are the common vector
// for nested-fence prompt injection.
const NESTED_FENCE_LINE_RE = /^`{4,}.*$/gm;

export interface SanitizeSkillResult {
  skill: string;
  violations: string[];
}

export function sanitizeSkillOutput(skill: string): SanitizeSkillResult {
  const violations: string[] = [];
  let out = skill;

  // 1. Strip directional-override characters everywhere.
  const dirMatches = out.match(DIRECTIONAL_RE);
  if (dirMatches) {
    out = out.replace(DIRECTIONAL_RE, "");
    violations.push(
      `stripped ${dirMatches.length} Unicode directional-override char(s)`
    );
  }

  // 2. Strip HTML comments. A single regex pass is insufficient because
  // nested / overlapping payloads like `<!-<!--DELETEME-->- evil -->` leave
  // a surviving `<!-- evil -->` after the inner match is removed. Loop to a
  // fixed point, then strip any lone `<!--` / `-->` delimiters so malformed
  // or unclosed comments can't smuggle instructions either.
  let commentsStripped = 0;
  while (true) {
    const matches = out.match(HTML_COMMENT_RE);
    if (!matches) break;
    commentsStripped += matches.length;
    const next = out.replace(HTML_COMMENT_RE, "");
    if (next === out) break;
    out = next;
  }
  const LONE_COMMENT_DELIM_RE = /<!--|-->/g;
  const loneDelims = out.match(LONE_COMMENT_DELIM_RE);
  if (loneDelims) {
    out = out.replace(LONE_COMMENT_DELIM_RE, "");
    commentsStripped += loneDelims.length;
  }
  if (commentsStripped > 0) {
    violations.push(
      `stripped ${commentsStripped} HTML comment block(s)/delimiter(s)`
    );
  }

  // 3. Collapse nested 4+-backtick fences down to safe triple-backticks.
  const fences = out.match(NESTED_FENCE_LINE_RE);
  if (fences && fences.length > 0) {
    out = out.replace(NESTED_FENCE_LINE_RE, (line) => {
      const rest = line.replace(/^`{4,}/, "");
      return "```" + rest;
    });
    violations.push(
      `normalized ${fences.length} nested code-fence line(s) (4+ backticks)`
    );
  }

  // 4. Filter frontmatter keys against an allowlist.
  const fmResult = filterFrontmatter(out);
  if (fmResult.strippedKeys.length > 0) {
    out = fmResult.body;
    violations.push(
      `stripped unknown frontmatter key(s): ${fmResult.strippedKeys.join(", ")}`
    );
  }

  return { skill: out, violations };
}

interface FilterFrontmatterResult {
  body: string;
  strippedKeys: string[];
}

function filterFrontmatter(skill: string): FilterFrontmatterResult {
  // Only consider the first `---\n…\n---` block at the top of the file; that's
  // the only YAML frontmatter markdown supports.
  const match = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { body: skill, strippedKeys: [] };

  const fullBlock = match[0];
  const inner = match[1] ?? "";
  const lines = inner.split(/\r?\n/);
  const kept: string[] = [];
  const stripped = new Set<string>();
  let currentKeyIsAllowed = false;

  for (const line of lines) {
    const topKey = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/.exec(line);
    if (topKey && topKey[1]) {
      const key = topKey[1];
      currentKeyIsAllowed = ALLOWED_FRONTMATTER_KEYS.has(key);
      if (currentKeyIsAllowed) {
        kept.push(line);
      } else {
        stripped.add(key);
      }
      continue;
    }
    if (currentKeyIsAllowed) kept.push(line);
  }

  if (stripped.size === 0) return { body: skill, strippedKeys: [] };

  const cleanedBlock = `---\n${kept.join("\n")}\n---`;
  const body = skill.replace(fullBlock, cleanedBlock);
  return { body, strippedKeys: Array.from(stripped) };
}
