import type { ParsedSession } from "../src/parsers/types.js";

export type ExpectedOutcome =
  | { kind: "skill"; mustContain: string[]; mustNotContain?: string[] }
  | { kind: "abort"; reason: "no_artifact" | "no_reusable_pattern" };

export interface Fixture {
  name: string;
  description: string;
  session: ParsedSession;
  expected: ExpectedOutcome;
}

export function baseSession(
  overrides: Partial<ParsedSession> & { sessionId: string; project: string }
): ParsedSession {
  return {
    sessionId: overrides.sessionId,
    agent: overrides.agent ?? "claude-code",
    project: overrides.project,
    branch: overrides.branch ?? "main",
    startedAt: overrides.startedAt ?? "2026-04-19T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-04-19T10:45:00.000Z",
    messages: overrides.messages ?? [],
    totalTokens: overrides.totalTokens ?? { input: 5000, output: 2000 },
    totalToolCalls: overrides.totalToolCalls ?? 0,
    filesModified: overrides.filesModified ?? [],
    summary: overrides.summary ?? {
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      uniqueTools: [],
    },
  };
}
