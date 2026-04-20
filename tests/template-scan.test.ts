import { describe, it, expect } from "vitest";
import { distillSkill, SecretsDetectedError } from "../src/distiller.js";
import type { ParsedSession } from "../src/parsers/types.js";

// Obfuscated to avoid tripping GitHub push protection / secret scanners on
// the test file itself. Same pattern as tests/secret-scan.test.ts.
const anthropicKey =
  "sk-ant" + "-api03-" + "abc123def456ghi789jkl0mnopqrstuv";

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: "test-session-xyz",
    agent: "claude-code",
    project: "/Users/test/my-project",
    branch: "main",
    startedAt: "2026-04-17T10:00:00Z",
    endedAt: "2026-04-17T10:30:00Z",
    messages: [
      {
        role: "user",
        content: "Do a thing",
        timestamp: "2026-04-17T10:00:00Z",
        toolCalls: [],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalTokens: { input: 10, output: 10 },
    totalToolCalls: 0,
    filesModified: [],
    summary: {
      userMessages: 1,
      assistantMessages: 0,
      toolCalls: 0,
      uniqueTools: [],
    },
    ...overrides,
  };
}

describe("templateDistill secret scanning (C4)", () => {
  it("aborts on secret in session.project under default (abort) policy", async () => {
    const session = makeSession({
      project: `/Users/test/${anthropicKey}/stuff`,
    });
    await expect(
      distillSkill(session, { useLlm: false, secretPolicy: "abort" })
    ).rejects.toBeInstanceOf(SecretsDetectedError);
  });

  it("aborts on secret in first user message", async () => {
    const session = makeSession({
      messages: [
        {
          role: "user",
          content: `Here is the key ${anthropicKey} please use it`,
          timestamp: "2026-04-17T10:00:00Z",
          toolCalls: [],
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    await expect(
      distillSkill(session, { useLlm: false, secretPolicy: "abort" })
    ).rejects.toBeInstanceOf(SecretsDetectedError);
  });

  it("aborts on secret in filesModified", async () => {
    const session = makeSession({
      filesModified: [`/Users/test/${anthropicKey}/.env`],
    });
    await expect(
      distillSkill(session, { useLlm: false, secretPolicy: "abort" })
    ).rejects.toBeInstanceOf(SecretsDetectedError);
  });

  it("redacts instead of aborting under 'redact' policy", async () => {
    // v0.2.6 — template output is now a minimalist stub; `project` is no
    // longer embedded in it. Route the secret through `filesModified` which
    // the stub still surfaces, to keep the invariant under test: with
    // redact policy the output must not contain the raw secret but must
    // show the redaction marker.
    const session = makeSession({
      filesModified: [`/Users/test/${anthropicKey}/.env`],
    });
    const skill = await distillSkill(session, {
      useLlm: false,
      secretPolicy: "redact",
    });
    expect(skill).not.toContain(anthropicKey);
    expect(skill).toContain("[REDACTED:");
  });

  it("calls onSecretsDetected with collected matches", async () => {
    const session = makeSession({
      project: `/Users/test/${anthropicKey}/stuff`,
    });
    const calls: unknown[] = [];
    await distillSkill(session, {
      useLlm: false,
      secretPolicy: "redact",
      onSecretsDetected: (m) => calls.push(m),
    });
    expect(calls.length).toBeGreaterThan(0);
  });

  it("clean session still renders a valid skill (no regression)", async () => {
    const session = makeSession();
    const skill = await distillSkill(session, {
      useLlm: false,
      secretPolicy: "abort",
    });
    expect(skill).toContain("## When to use");
    expect(skill).toContain("## Steps");
    expect(skill).not.toContain("[REDACTED:");
  });
});
