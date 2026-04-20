import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../src/distiller-judge.js";
import type { ParsedSession } from "../src/parsers/types.js";

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: "judge-test-001",
    agent: "claude-code",
    project: "/Users/dev/Projects/app",
    branch: "main",
    startedAt: "2026-04-19T10:00:00Z",
    endedAt: "2026-04-19T10:10:00Z",
    messages: [
      {
        role: "user",
        content: "Fix the broken tests",
        timestamp: "2026-04-19T10:00:00Z",
        toolCalls: [],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Done, all tests pass.",
        timestamp: "2026-04-19T10:10:00Z",
        toolCalls: [],
        tokenUsage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalTokens: { input: 10, output: 10 },
    totalToolCalls: 2,
    filesModified: ["src/auth.ts", "tests/auth.test.ts"],
    summary: {
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 2,
      uniqueTools: ["Read", "Edit"],
    },
    ...overrides,
  };
}

describe("buildJudgePrompt", () => {
  it("includes the first user message as intent", () => {
    const p = buildJudgePrompt(makeSession());
    expect(p).toContain("Fix the broken tests");
  });

  it("includes the final assistant message as outcome signal", () => {
    const p = buildJudgePrompt(makeSession());
    expect(p).toContain("Done, all tests pass.");
  });

  it("anonymizes paths in filesModified list", () => {
    const p = buildJudgePrompt(makeSession());
    expect(p).not.toContain("/Users/dev/");
    expect(p).toContain("src/auth.ts");
    expect(p).toContain("tests/auth.test.ts");
  });

  it("always asks for strict JSON output, no prose, no code fences", () => {
    const p = buildJudgePrompt(makeSession());
    expect(p).toContain("EXACTLY this JSON object");
    expect(p).toContain("nothing else");
  });

  it("mentions all three decision criteria (artifact, reusability, specificity)", () => {
    const p = buildJudgePrompt(makeSession());
    expect(p.toLowerCase()).toContain("artifact");
    expect(p.toLowerCase()).toContain("reused");
    expect(p.toLowerCase()).toContain("generic");
  });

  it("handles zero files modified without crashing", () => {
    const p = buildJudgePrompt(makeSession({ filesModified: [] }));
    expect(p).toContain("Files modified: (none)");
  });
});
