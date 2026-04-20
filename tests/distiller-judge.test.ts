import { describe, it, expect } from "vitest";
import {
  buildJudgePrompt,
  coerceResult,
  judgeSession,
  NotDistillableError,
} from "../src/distiller-judge.js";
import { SecretsDetectedError } from "../src/secret-scan.js";
import type { ParsedSession } from "../src/parsers/types.js";

// Audit #3 R1 — \x1b is the entry byte for every ANSI/CSI/OSC escape; \x07
// is the BEL terminator for OSC sequences. If any of these survive into
// Error.message they will be executed by the terminal when console.error
// prints them.
const ANSI_ENTRY_BYTES_RE = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;

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

describe("coerceResult — security regressions (audit #3)", () => {
  // J1 — parser must be string-aware: a literal "}" inside the reason string
  // must not break JSON extraction and trigger the fail-open default.
  it("parses valid JSON whose reason contains a literal } character", () => {
    const raw = '{"distillable": false, "reason": "task ended with } symbol present", "confidence": "high"}';
    const r = coerceResult(raw);
    expect(r.distillable).toBe(false);
    expect(r.reason).toBe("task ended with } symbol present");
    expect(r.confidence).toBe("high");
  });

  // J1b — type-coercion bypass: Boolean("false") === true. coerceResult must
  // treat anything other than the literal boolean true as false (fail-closed).
  it("treats string 'false' for distillable as false (no truthy coercion)", () => {
    const raw = '{"distillable": "false", "reason": "stringified bool", "confidence": "high"}';
    const r = coerceResult(raw);
    expect(r.distillable).toBe(false);
  });

  it("treats string 'true' for distillable as false (only literal true counts)", () => {
    // Strict policy: only the JSON boolean literal `true` opens the gate.
    // Any other type is treated as not distillable.
    const raw = '{"distillable": "true", "reason": "stringified bool", "confidence": "high"}';
    const r = coerceResult(raw);
    expect(r.distillable).toBe(false);
  });

  it("treats numeric 1 for distillable as false (only literal true counts)", () => {
    const raw = '{"distillable": 1, "reason": "numeric bool", "confidence": "high"}';
    const r = coerceResult(raw);
    expect(r.distillable).toBe(false);
  });

  // J1c — unparseable judge output must fail CLOSED, not open. Otherwise an
  // attacker can force a parse error to bypass the gate.
  it("fails closed (distillable=false) when judge output is unparseable", () => {
    const raw = "this is not json at all";
    const r = coerceResult(raw);
    expect(r.distillable).toBe(false);
  });

  it("fails closed when judge output is empty", () => {
    const r = coerceResult("");
    expect(r.distillable).toBe(false);
  });
});

describe("NotDistillableError — terminal-injection guard (audit #3 R1)", () => {
  it("strips ANSI escape bytes from the constructed message", () => {
    const judgment = {
      distillable: false,
      reason: "\x1b[2J\x1b[H\x1b[31m✓ FAKE SUCCESS\x1b[0m",
      confidence: "high" as const,
    };
    const err = new NotDistillableError(judgment);
    // No \x1b, no other C0/C1 controls (newlines from the message template
    // are explicitly allowed by the regex below).
    expect(err.message).not.toMatch(ANSI_ENTRY_BYTES_RE);
    // The visible payload should still appear so the user sees what the model
    // tried to say — only the control bytes are gone.
    expect(err.message).toContain("FAKE SUCCESS");
  });

  it("strips embedded newlines so the reason cannot fake a new log line", () => {
    const judgment = {
      distillable: false,
      reason: "boring\n\n✓ Wrote skill to /tmp/pwned.md",
      confidence: "low" as const,
    };
    const err = new NotDistillableError(judgment);
    // The constructed template introduces exactly ONE newline (between
    // the reason line and the "Override" hint). If the reason payload
    // smuggled additional newlines, the message would have more than one.
    const newlineCount = (err.message.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(1);
  });
});

describe("judgeSession — secret-scan guard (audit #3 S1)", () => {
  // S1 — the judge prompt embeds raw user/assistant content. Before v0.3.1 it
  // was sent to the LLM without any secret-scan, so a session with a key in
  // the first user message would exfiltrate to Anthropic on the cheap-gate
  // call BEFORE the main distill scan ran. The judge must apply the same
  // secretPolicy the distiller does.
  it("throws SecretsDetectedError when policy=abort and a secret is in the session", async () => {
    const session = makeSession({
      messages: [
        {
          role: "user",
          content:
            "deploy with key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef",
          timestamp: "2026-04-19T10:00:00Z",
          toolCalls: [],
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    await expect(
      judgeSession(session, { secretPolicy: "abort" })
    ).rejects.toBeInstanceOf(SecretsDetectedError);
  });

  it("calls onSecretsDetected when policy=redact and secrets are present", async () => {
    const session = makeSession({
      messages: [
        {
          role: "user",
          content:
            "use sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef",
          timestamp: "2026-04-19T10:00:00Z",
          toolCalls: [],
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const matches: unknown[] = [];
    // No API key is set in this test process, so the real LLM call is
    // short-circuited inside judgeSession. We only want to assert that the
    // scan ran and the callback fired.
    await judgeSession(session, {
      secretPolicy: "redact",
      onSecretsDetected: (m) => matches.push(...m),
    });
    expect(matches.length).toBeGreaterThan(0);
  });
});
