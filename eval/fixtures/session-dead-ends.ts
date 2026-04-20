import { baseSession, type Fixture } from "../types.js";

export const fixture: Fixture = {
  name: "dead-ends",
  description: "Productive session with abandoned attempts: agent tries 2 wrong paths before hitting the right one",
  session: baseSession({
    sessionId: "dead-ends-0004",
    project: "/Users/dev/Projects/gym-tracker-app",
    messages: [
      {
        role: "user",
        content: "Los tests tardan 45s. Hacelos más rápidos sin perder cobertura.",
        timestamp: "2026-04-19T10:00:00.000Z",
        toolCalls: [],
        tokenUsage: { input: 40, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Pruebo con --pool=threads primero.",
        timestamp: "2026-04-19T10:00:10.000Z",
        toolCalls: [
          {
            name: "Bash",
            input: { command: "npx vitest run --pool=threads", description: "Try threads pool" },
            output: "Duration 44.2s (threads). No mejora.",
            timestamp: "2026-04-19T10:00:50.000Z",
          },
        ],
        tokenUsage: { input: 300, output: 80, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Nada. Reduzco isolate=false.",
        timestamp: "2026-04-19T10:01:00.000Z",
        toolCalls: [
          {
            name: "Edit",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/vitest.config.ts",
              old_string: "poolOptions: { threads: {} }",
              new_string: "poolOptions: { threads: { isolate: false } }",
            },
            output: "Edited",
            timestamp: "2026-04-19T10:01:10.000Z",
          },
          {
            name: "Bash",
            input: { command: "npx vitest run", description: "Re-run with isolate=false" },
            output: "Failed: global state leaks between tests. Duration irrelevant.",
            timestamp: "2026-04-19T10:01:40.000Z",
          },
          {
            name: "Edit",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/vitest.config.ts",
              old_string: "poolOptions: { threads: { isolate: false } }",
              new_string: "poolOptions: { threads: {} }",
            },
            output: "Reverted",
            timestamp: "2026-04-19T10:01:50.000Z",
          },
        ],
        tokenUsage: { input: 600, output: 150, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Ambos intentos fallaron. Perfilo para ver dónde se va el tiempo.",
        timestamp: "2026-04-19T10:02:00.000Z",
        toolCalls: [
          {
            name: "Bash",
            input: { command: "npx vitest run --reporter=verbose --logHeapUsage", description: "Profile test durations" },
            output: "Top 3 slowest: auth.test.ts 18.4s, db.test.ts 12.1s, workouts.test.ts 5.8s. Rest < 1s.",
            timestamp: "2026-04-19T10:02:10.000Z",
          },
          {
            name: "Read",
            input: { file_path: "/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts" },
            output: "beforeEach(async () => { await createTestDb(); }) // 3s per test, 24 tests",
            timestamp: "2026-04-19T10:02:20.000Z",
          },
          {
            name: "Edit",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts",
              old_string: "beforeEach(async () => { await createTestDb(); })",
              new_string: "beforeAll(async () => { await createTestDb(); })\nafterEach(async () => { await truncateTables(); })",
            },
            output: "Edited",
            timestamp: "2026-04-19T10:02:35.000Z",
          },
          {
            name: "Bash",
            input: { command: "npx vitest run tests/auth.test.ts", description: "Verify" },
            output: "Duration 3.8s (was 18.4s). All 24 tests pass.",
            timestamp: "2026-04-19T10:02:50.000Z",
          },
          {
            name: "Bash",
            input: { command: "npx vitest run", description: "Full suite after fix" },
            output: "Duration 18.9s (was 45s). All 180 tests pass.",
            timestamp: "2026-04-19T10:03:10.000Z",
          },
        ],
        tokenUsage: { input: 1500, output: 300, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalToolCalls: 9,
    filesModified: ["tests/auth.test.ts"],
    summary: {
      userMessages: 1,
      assistantMessages: 3,
      toolCalls: 9,
      uniqueTools: ["Bash", "Edit", "Read"],
    },
  }),
  expected: {
    kind: "skill",
    mustContain: [
      "profile",
      "beforeAll",
    ],
    mustNotContain: [
      "Use `Edit` on",
      "1.1.",
    ],
  },
};
