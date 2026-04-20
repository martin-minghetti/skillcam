import { baseSession, type Fixture } from "../types.js";

export const fixture: Fixture = {
  name: "good-build-feature",
  description: "Productive session: build API endpoint with Zod validation + tests",
  session: baseSession({
    sessionId: "build-feat-0003",
    project: "/Users/dev/Projects/gym-tracker-app",
    messages: [
      {
        role: "user",
        content: "Agregá un POST /api/exercises que acepte {name, muscleGroup, equipment?}. Validá input y devolvé 201 con el recurso.",
        timestamp: "2026-04-19T10:00:00.000Z",
        toolCalls: [],
        tokenUsage: { input: 80, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        role: "assistant",
        content: "Defino el schema Zod y el route handler.",
        timestamp: "2026-04-19T10:00:10.000Z",
        toolCalls: [
          {
            name: "Read",
            input: { file_path: "/Users/dev/Projects/gym-tracker-app/src/app/api/workouts/route.ts" },
            output: "import { z } from 'zod'; ...",
            timestamp: "2026-04-19T10:00:15.000Z",
          },
          {
            name: "Write",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/src/app/api/exercises/route.ts",
              content:
                "import { z } from 'zod';\nimport { NextResponse } from 'next/server';\n\nconst ExerciseSchema = z.object({\n  name: z.string().min(1),\n  muscleGroup: z.string().min(1),\n  equipment: z.string().optional(),\n});\n\nexport async function POST(req: Request) {\n  const body = await req.json();\n  const parsed = ExerciseSchema.safeParse(body);\n  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });\n  const { data } = parsed;\n  return NextResponse.json({ data }, { status: 201 });\n}",
            },
            output: "File created",
            timestamp: "2026-04-19T10:00:30.000Z",
          },
          {
            name: "Write",
            input: {
              file_path: "/Users/dev/Projects/gym-tracker-app/tests/api-exercises.test.ts",
              content:
                "import { POST } from '@/app/api/exercises/route';\n\ndescribe('POST /api/exercises', () => {\n  it('returns 201 with valid input', async () => { ... });\n  it('returns 400 when name missing', async () => { ... });\n  it('returns 400 when equipment is number', async () => { ... });\n});",
            },
            output: "File created",
            timestamp: "2026-04-19T10:00:45.000Z",
          },
          {
            name: "Bash",
            input: { command: "npx vitest run tests/api-exercises.test.ts", description: "Run new tests" },
            output: "Test Files: 1 passed\nTests: 3 passed",
            timestamp: "2026-04-19T10:01:00.000Z",
          },
        ],
        tokenUsage: { input: 2000, output: 400, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalToolCalls: 4,
    filesModified: [
      "src/app/api/exercises/route.ts",
      "tests/api-exercises.test.ts",
    ],
    summary: {
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 4,
      uniqueTools: ["Read", "Write", "Bash"],
    },
  }),
  expected: {
    kind: "skill",
    mustContain: [
      "Zod",
      "schema",
      "validation",
      "test",
    ],
    mustNotContain: [
      "/Users/dev/",
      "Use `Write` on",
    ],
  },
};
