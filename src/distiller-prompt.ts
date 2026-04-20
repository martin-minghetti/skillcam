import { basename, isAbsolute } from "path";
import type { ParsedSession } from "./parsers/types.js";
import { scanAndRedactTruncate, type SecretMatch } from "./secret-scan.js";
import { capPromptMessages } from "./limits.js";
import { summarizeToolCall, anonymizePath } from "./tool-summary.js";
import { ALLOWED_TAGS, DISTILL_PROMPT_VERSION } from "./skill-render.js";

export { DISTILL_PROMPT_VERSION };

export interface BuildDistillPromptResult {
  prompt: string;
  matches: SecretMatch[];
  truncatedMessageCount: number;
}

/**
 * v0.2.6 — distiller prompt, rewritten.
 *
 * Changes vs v0.2.5:
 *   1. JSON output schema (not free-form markdown). Parsed by skill-render.
 *   2. Order inverted: intent → actions → outcome (not tool-calls first).
 *   3. Semantic tool-call summary via `summarizeToolCall` (no truncated JSON).
 *   4. Paths anonymized — no `/Users/...` leaks into the LLM.
 *   5. Hard anti-literal rule with BAD/GOOD examples.
 *   6. Caps expressed per section, not globally ("max 8 steps").
 *   7. Two canonical few-shot examples (one good, one abort).
 *   8. Closed tag taxonomy.
 *   9. New fields: `confidence`, `why_this_worked`.
 *  10. Abort protocol: `{"abort": "no_artifact" | "no_reusable_pattern"}`.
 *
 * The prompt is still scanned for secrets per-field AND as a whole, same as
 * v0.2.5 — this rewrite does not change the secret-handling surface.
 */
export function buildDistillPrompt(session: ParsedSession): BuildDistillPromptResult {
  const matches: SecretMatch[] = [];

  const { messages, truncatedCount } = capPromptMessages(session.messages);

  const intent = scanAndRedactTruncate(
    messages.find((m) => m.role === "user")?.content ?? "(no user message)",
    600,
    "intent"
  );
  matches.push(...intent.matches);

  const conversation = messages
    .map((m, mi) => {
      const scanned = scanAndRedactTruncate(m.content, 500, `message[${mi}]`);
      matches.push(...scanned.matches);
      return `${m.role}: ${scanned.redacted}`;
    })
    .join("\n\n");

  const toolSummary = messages
    .flatMap((m, mi) =>
      m.toolCalls.map((tc, ti) => {
        // v0.2.6 B1-regression fix: summarize with an unbounded budget so that
        // truncation happens AFTER `scanAndRedactTruncate` below has had a
        // chance to see full field values. Otherwise a secret past the
        // summarizer's internal cap would be truncated out before the scan
        // (re-opening the audit C2 B1 issue hardened in v0.2.4).
        const line = summarizeToolCall(tc, session.project, Number.MAX_SAFE_INTEGER);
        const scanned = scanAndRedactTruncate(
          line,
          400,
          `tool-call[${mi}][${ti}]`
        );
        matches.push(...scanned.matches);
        return "- " + scanned.redacted;
      })
    )
    .join("\n");

  const lastAssistant = [...messages].reverse().find(
    (m) => m.role === "assistant" && m.content
  );
  const outcomeScanned = scanAndRedactTruncate(
    lastAssistant?.content ?? "(no final assistant message)",
    400,
    "outcome"
  );
  matches.push(...outcomeScanned.matches);

  const projectName = isAbsolute(session.project)
    ? basename(session.project)
    : session.project;
  const anonymizedFiles = session.filesModified
    .map((f) => anonymizePath(f, session.project))
    .join(", ");

  const prompt = `You are a skill extraction engine. Extract the REUSABLE PATTERN from this AI agent session into a single JSON object.

## Session

### Project
${projectName}

### Intent (first user message)
${intent.redacted}

### Conversation
${conversation}

### Actions taken
${toolSummary || "(no tool calls)"}

### Outcome
- Files modified: ${anonymizedFiles || "(none)"}
- Tool calls: ${session.totalToolCalls}
- Tools used: ${session.summary.uniqueTools.join(", ")}
- Final assistant message: ${outcomeScanned.redacted}

---

## Your task

Output EXACTLY ONE valid JSON object. No prose before or after. No code fences.

### If the session is distillable, use this schema:

{
  "name": "kebab-case-descriptive-name",
  "description": "one sentence describing what this skill does, from the agent's perspective",
  "when_to_use": "1-3 sentences naming the TRIGGER situation. What signal in a future conversation should make the agent reach for this skill?",
  "steps": ["step 1", "step 2", "..."],
  "example": "one short narrative: User asked X → agent did Y → result Z",
  "key_decisions": ["non-obvious rule 1", "gotcha 2", "..."],
  "tags": ["tag1", "tag2"],
  "confidence": "high" | "medium" | "low",
  "why_this_worked": "one sentence naming the single key insight"
}

### If the session is NOT distillable, use this schema instead:

{"abort": "no_artifact" | "no_reusable_pattern", "reason": "<one short sentence>"}

---

## Hard rules

1. **No tool names in steps.** Describe WHAT was accomplished, not WHICH tool was invoked.
   - BAD: "Use Bash to run npm test"
   - GOOD: "Run the full test suite first to get the exact failure output"

2. **No absolute paths.** Use relative paths (src/foo.ts). Never \`/Users/<name>/\` or \`/home/<name>/\`.

3. **Only the causal chain.** If the session had abandoned attempts before the working fix, include ONLY the steps that led to the successful outcome. Discard dead ends.

4. **Abort protocol.** Emit \`{"abort": "no_artifact", ...}\` if the session produced no concrete artifact (no files modified, no successful commands, no resolved answer). Emit \`{"abort": "no_reusable_pattern", ...}\` if every step is generic ("read a file", "search the codebase") without a specific goal a future agent could recognize.

5. **Section caps.**
   - \`steps\`: max 8, each one single-line.
   - \`key_decisions\`: max 5 bullets.
   - \`description\`: ≤ 140 chars.
   - \`when_to_use\`: ≤ 3 sentences.

6. **Tags from this closed taxonomy ONLY (pick 2-4):**
   ${ALLOWED_TAGS.join(", ")}

---

## Example 1 — distillable session

Intent: "Tests broke after the auth refactor."
Actions: ran test suite → read failing test → read source → fixed import → re-ran.
Outcome: tests/auth.test.ts modified, full suite green.

Output:
{
  "name": "debug-failing-tests",
  "description": "Systematically debug and fix failing tests by reading errors and tracing to root cause",
  "when_to_use": "When tests fail after refactoring, dependency upgrades, or merges. Apply before guessing at fixes.",
  "steps": [
    "Run the full test suite first — don't guess failures from file names",
    "Read the failing test to see what it asserts",
    "Read the source under test to find where it diverges from the test's expectation",
    "Check git diff to narrow the time window of the break",
    "Fix the root cause, not the test — unless the test was wrong",
    "Re-run only the failing test to verify",
    "Run the full suite to catch regressions"
  ],
  "example": "Agent ran npm test, saw 3 failures in auth.test.ts expecting validateToken. Read source and found it was renamed to verifyToken during refactor. Fixed the import alias. Full suite green.",
  "key_decisions": [
    "Fix source over test when the test was correct before",
    "Always run full suite after, not just the broken test",
    "Narrow scope with git diff before reading widely"
  ],
  "tags": ["testing", "debugging", "refactor"],
  "confidence": "high",
  "why_this_worked": "Reading the source before touching the test surfaced the rename as the true root cause"
}

## Example 2 — non-distillable session

Intent: "What's in this repo? Never saw it."
Actions: ls, read README, read package.json, grep TODO.
Outcome: no files modified, agent summarized findings.

Output:
{"abort": "no_artifact", "reason": "Pure exploration with no concrete outcome — agent summarized but produced nothing reusable"}
`;

  return { prompt, matches, truncatedMessageCount: truncatedCount };
}
