import { describe, it, expect } from "vitest";
import { distillSkill } from "../src/distiller.js";
import type { ParsedSession } from "../src/parsers/types.js";

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
