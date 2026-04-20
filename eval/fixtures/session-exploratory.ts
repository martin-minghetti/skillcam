import { baseSession, type Fixture } from "../types.js";

export const fixture: Fixture = {
  name: "exploratory",
  description: "Pure exploration: user asks state of a project, agent greps/reads, no artifact produced",
  session: baseSession({
    sessionId: "explore-0002",
    project: "/Users/dev/Projects/some-unknown-repo",
    messages: [
      {
        role: "user",
        content: "Qué hay en este repo? Nunca lo vi.",
        timestamp: "2026-04-19T10:00:00.000Z",
        toolCalls: [],
        tokenUsage: { input: 30, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Exploro la estructura.",
        timestamp: "2026-04-19T10:00:05.000Z",
        toolCalls: [
          {
            name: "Bash",
            input: { command: "ls -la", description: "List root" },
            output: "README.md  package.json  src/  tests/",
            timestamp: "2026-04-19T10:00:10.000Z",
          },
          {
            name: "Read",
            input: { file_path: "/Users/dev/Projects/some-unknown-repo/README.md" },
            output: "# Some Unknown Repo\nA library.",
            timestamp: "2026-04-19T10:00:15.000Z",
          },
          {
            name: "Read",
            input: { file_path: "/Users/dev/Projects/some-unknown-repo/package.json" },
            output: '{"name":"some-unknown-repo"}',
            timestamp: "2026-04-19T10:00:20.000Z",
          },
          {
            name: "Grep",
            input: { pattern: "TODO", path: "/Users/dev/Projects/some-unknown-repo" },
            output: "src/main.ts:12: // TODO\nsrc/util.ts:5: // TODO",
            timestamp: "2026-04-19T10:00:25.000Z",
          },
        ],
        tokenUsage: { input: 600, output: 200, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Es una library TypeScript simple. Tiene README mínimo y 2 TODOs pendientes.",
        timestamp: "2026-04-19T10:00:35.000Z",
        toolCalls: [],
        tokenUsage: { input: 700, output: 80, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalToolCalls: 4,
    filesModified: [],
    summary: {
      userMessages: 1,
      assistantMessages: 2,
      toolCalls: 4,
      uniqueTools: ["Bash", "Read", "Grep"],
    },
  }),
  expected: {
    kind: "abort",
    reason: "no_artifact",
  },
};
