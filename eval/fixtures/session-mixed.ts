import { baseSession, type Fixture } from "../types.js";

export const fixture: Fixture = {
  name: "mixed",
  description: "Session with two parallel intents: fix a build error AND add a logger. Distiller should pick the dominant one or abort.",
  session: baseSession({
    sessionId: "mixed-0005",
    project: "/Users/dev/Projects/gym-tracker-app",
    messages: [
      {
        role: "user",
        content: "El build tira error en TS y de paso agregá logging con pino.",
        timestamp: "2026-04-19T10:00:00.000Z",
        toolCalls: [],
        tokenUsage: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Arranco por el build, sin eso nada anda.",
        timestamp: "2026-04-19T10:00:10.000Z",
        toolCalls: [
          {
            name: "Bash",
            input: { command: "npx tsc --noEmit", description: "Get TS errors" },
            output: "src/api/handler.ts(12,3): TS2322: Type 'string' not assignable to 'number'.",
            timestamp: "2026-04-19T10:00:20.000Z",
          },
          {
            name: "Read",
            input: { file_path: "/Users/dev/Projects/gym-tracker-app/src/api/handler.ts" },
            output: "const port: number = process.env.PORT;",
            timestamp: "2026-04-19T10:00:30.000Z",
          },
          {
            name: "Edit",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/src/api/handler.ts",
              old_string: "const port: number = process.env.PORT;",
              new_string: "const port: number = Number(process.env.PORT ?? 3000);",
            },
            output: "Edited",
            timestamp: "2026-04-19T10:00:40.000Z",
          },
          {
            name: "Bash",
            input: { command: "npx tsc --noEmit", description: "Verify" },
            output: "No errors.",
            timestamp: "2026-04-19T10:00:50.000Z",
          },
        ],
        tokenUsage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Build fixed. Ahora pino. Instalo y configuro.",
        timestamp: "2026-04-19T10:01:00.000Z",
        toolCalls: [
          {
            name: "Bash",
            input: { command: "npm install pino", description: "Install pino" },
            output: "added 8 packages",
            timestamp: "2026-04-19T10:01:20.000Z",
          },
          {
            name: "Write",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/src/lib/logger.ts",
              content: "import pino from 'pino';\nexport const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });",
            },
            output: "File created",
            timestamp: "2026-04-19T10:01:30.000Z",
          },
        ],
        tokenUsage: { input: 1200, output: 150, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalToolCalls: 6,
    filesModified: [
      "src/api/handler.ts",
      "src/lib/logger.ts",
    ],
    summary: {
      userMessages: 1,
      assistantMessages: 2,
      toolCalls: 6,
      uniqueTools: ["Bash", "Read", "Edit", "Write"],
    },
  }),
  expected: {
    kind: "skill",
    mustContain: [
      "TS",
      "type",
    ],
    mustNotContain: [
      "Use `Bash` on",
      "/Users/dev/",
    ],
  },
};
