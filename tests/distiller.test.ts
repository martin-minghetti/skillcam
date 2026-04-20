import { describe, it, expect } from "vitest";
import { distillSkill, DistillationAbortedError } from "../src/distiller.js";
import type { ParsedSession } from "../src/parsers/types.js";

// Audit #3 R1 — see NotDistillableError counterpart in distiller-judge.test.ts.
// \n (\x0a) is allowed because the message template adds one structural newline.
const ANSI_ENTRY_BYTES_RE = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;

describe("DistillationAbortedError — terminal-injection guard (audit #3 R1)", () => {
  it("strips ANSI escape bytes from the constructed message", () => {
    const err = new DistillationAbortedError(
      "no_artifact",
      "\x1b[2J\x1b[H\x1b[32m✓ FAKE: skill written\x1b[0m"
    );
    expect(err.message).not.toMatch(ANSI_ENTRY_BYTES_RE);
    expect(err.message).toContain("FAKE: skill written");
  });

  it("strips embedded newlines so the reason cannot fake a new log line", () => {
    const err = new DistillationAbortedError(
      "no_reusable_pattern",
      "innocent\n✓ Wrote skill to /tmp/owned.md"
    );
    // Template introduces exactly one newline. Smuggled newlines from the
    // reason would push the count above one.
    const newlineCount = (err.message.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(1);
  });
});

const mockSession: ParsedSession = {
  sessionId: "test-session-123",
  agent: "claude-code",
  project: "/Users/test/my-project",
  branch: "main",
  startedAt: "2026-04-12T10:00:00Z",
  endedAt: "2026-04-12T10:30:00Z",
  messages: [
    {
      role: "user",
      content: "Fix the broken tests in auth module",
      timestamp: "2026-04-12T10:00:00Z",
      toolCalls: [],
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
      role: "assistant",
      content: "I'll fix the auth tests.",
      timestamp: "2026-04-12T10:01:00Z",
      toolCalls: [
        {
          name: "Read",
          input: { file_path: "src/auth.ts" },
          output: "file contents...",
          timestamp: "2026-04-12T10:01:00Z",
        },
        {
          name: "Edit",
          input: { file_path: "src/auth.ts", old_string: "bug", new_string: "fix" },
          output: "edited",
          timestamp: "2026-04-12T10:02:00Z",
        },
      ],
      tokenUsage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
      model: "claude-sonnet-4-6",
    },
  ],
  totalTokens: { input: 1000, output: 500 },
  totalToolCalls: 2,
  filesModified: ["src/auth.ts"],
  summary: {
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 2,
    uniqueTools: ["Read", "Edit"],
  },
};

describe("distillSkill", () => {
  it("returns a valid SKILL.md string with required sections", async () => {
    // This test uses the --no-llm template mode
    const skill = await distillSkill(mockSession, { useLlm: false });

    expect(skill).toContain("---");
    expect(skill).toContain("name:");
    expect(skill).toContain("description:");
    expect(skill).toContain("## When to use");
    expect(skill).toContain("## Steps");
    expect(skill).toContain("source_session: test-session-123");
  });
});
