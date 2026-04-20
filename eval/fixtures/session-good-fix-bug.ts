import { baseSession, type Fixture } from "../types.js";

export const fixture: Fixture = {
  name: "good-fix-bug",
  description: "Productive session: agent fixes failing tests, ends with green suite",
  session: baseSession({
    sessionId: "fix-bug-0001",
    project: "/Users/dev/Projects/gym-tracker-app",
    messages: [
      {
        role: "user",
        content: "Los tests están rotos después del refactor de auth. npm test falla.",
        timestamp: "2026-04-19T10:00:00.000Z",
        toolCalls: [],
        tokenUsage: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Corro la suite para ver los errores reales.",
        timestamp: "2026-04-19T10:00:10.000Z",
        toolCalls: [
          {
            name: "Bash",
            input: { command: "npm test", description: "Run test suite" },
            output: "FAIL tests/auth.test.ts\n  × validateToken returns valid token (15ms)\n    ReferenceError: validateToken is not defined\n  × validateToken rejects expired (12ms)\n  × validateToken rejects malformed (8ms)\n\nTest Suites: 1 failed, 8 passed\nTests: 3 failed, 47 passed",
            timestamp: "2026-04-19T10:00:15.000Z",
          },
        ],
        tokenUsage: { input: 200, output: 50, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "3 tests fallan con ReferenceError: validateToken. Leo el test.",
        timestamp: "2026-04-19T10:00:30.000Z",
        toolCalls: [
          {
            name: "Read",
            input: { file_path: "/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts" },
            output: "import { validateToken } from '../src/auth';\n\ndescribe('validateToken', () => { ... })",
            timestamp: "2026-04-19T10:00:35.000Z",
          },
          {
            name: "Read",
            input: { file_path: "/Users/dev/Projects/gym-tracker-app/src/auth.ts" },
            output: "export function verifyToken(token: string) { ... }",
            timestamp: "2026-04-19T10:00:40.000Z",
          },
        ],
        tokenUsage: { input: 800, output: 100, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "La función se renombró a verifyToken en el refactor. El test sigue importando validateToken. Fix en el test, no en el source.",
        timestamp: "2026-04-19T10:01:00.000Z",
        toolCalls: [
          {
            name: "Edit",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts",
              old_string: "import { validateToken } from '../src/auth';",
              new_string: "import { verifyToken as validateToken } from '../src/auth';",
            },
            output: "Successfully replaced",
            timestamp: "2026-04-19T10:01:05.000Z",
          },
          {
            name: "Bash",
            input: { command: "npx vitest run tests/auth.test.ts", description: "Re-run just the failing suite" },
            output: "Test Files: 1 passed\nTests: 3 passed",
            timestamp: "2026-04-19T10:01:15.000Z",
          },
          {
            name: "Bash",
            input: { command: "npm test", description: "Run full suite for regressions" },
            output: "Test Files: 9 passed\nTests: 50 passed",
            timestamp: "2026-04-19T10:01:30.000Z",
          },
        ],
        tokenUsage: { input: 1200, output: 150, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalToolCalls: 6,
    filesModified: ["tests/auth.test.ts"],
    summary: {
      userMessages: 1,
      assistantMessages: 3,
      toolCalls: 6,
      uniqueTools: ["Bash", "Read", "Edit"],
    },
  }),
  expected: {
    kind: "skill",
    mustContain: [
      "test",
      "fail",
      "verify",
    ],
    mustNotContain: [
      "/Users/dev/",
      "Use `Bash` on",
      "1.1.",
    ],
  },
};
