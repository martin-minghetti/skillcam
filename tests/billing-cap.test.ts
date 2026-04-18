import { describe, it, expect } from "vitest";
import {
  MAX_PROMPT_MESSAGES,
  capPromptMessages,
} from "../src/limits.js";
import { buildDistillPrompt } from "../src/distiller-prompt.js";
import type { ParsedSession, SessionMessage } from "../src/parsers/types.js";

function makeMessage(role: "user" | "assistant", n: number): SessionMessage {
  return {
    role,
    content: `message-${n}`,
    timestamp: "2026-04-18T10:00:00Z",
    toolCalls: [],
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

describe("capPromptMessages (B1)", () => {
  it("exposes the documented cap", () => {
    expect(MAX_PROMPT_MESSAGES).toBe(1000);
  });

  it("passes short lists through unchanged", () => {
    const msgs = [makeMessage("user", 1), makeMessage("assistant", 2)];
    const out = capPromptMessages(msgs);
    expect(out.truncatedCount).toBe(0);
    expect(out.messages).toEqual(msgs);
  });

  it("trims to the most recent MAX_PROMPT_MESSAGES", () => {
    const msgs = Array.from({ length: MAX_PROMPT_MESSAGES + 250 }, (_, i) =>
      makeMessage(i % 2 === 0 ? "user" : "assistant", i)
    );
    const out = capPromptMessages(msgs);
    expect(out.messages).toHaveLength(MAX_PROMPT_MESSAGES);
    expect(out.truncatedCount).toBe(250);
    // Verify it kept the tail, not the head.
    expect(out.messages[0]?.content).toBe(`message-250`);
    expect(out.messages.at(-1)?.content).toBe(
      `message-${MAX_PROMPT_MESSAGES + 250 - 1}`
    );
  });

  it("keeps everything when length equals the cap", () => {
    const msgs = Array.from({ length: MAX_PROMPT_MESSAGES }, (_, i) =>
      makeMessage("user", i)
    );
    const out = capPromptMessages(msgs);
    expect(out.truncatedCount).toBe(0);
    expect(out.messages).toHaveLength(MAX_PROMPT_MESSAGES);
  });
});

describe("buildDistillPrompt — billing cap integration (B1)", () => {
  function makeSession(nMessages: number): ParsedSession {
    return {
      sessionId: "s1",
      agent: "claude-code",
      project: "/tmp/proj",
      branch: "main",
      startedAt: "2026-04-18T10:00:00Z",
      endedAt: "2026-04-18T11:00:00Z",
      messages: Array.from({ length: nMessages }, (_, i) =>
        makeMessage(i % 2 === 0 ? "user" : "assistant", i)
      ),
      totalTokens: { input: 0, output: 0 },
      totalToolCalls: 0,
      filesModified: [],
      summary: {
        userMessages: Math.ceil(nMessages / 2),
        assistantMessages: Math.floor(nMessages / 2),
        toolCalls: 0,
        uniqueTools: [],
      },
    };
  }

  it("reports zero truncation under the cap", () => {
    const result = buildDistillPrompt(makeSession(10));
    expect(result.truncatedMessageCount).toBe(0);
    expect(result.prompt).toContain("message-0");
    expect(result.prompt).toContain("message-9");
  });

  it("truncates to the cap and reports the dropped count", () => {
    const session = makeSession(MAX_PROMPT_MESSAGES + 500);
    const result = buildDistillPrompt(session);
    expect(result.truncatedMessageCount).toBe(500);
    // The oldest 500 must not appear; the newest must.
    expect(result.prompt).not.toContain(" message-0\n");
    expect(result.prompt).not.toContain("message-499");
    expect(result.prompt).toContain("message-500");
    expect(result.prompt).toContain(
      `message-${MAX_PROMPT_MESSAGES + 500 - 1}`
    );
  });

  it("bounds prompt size on a pathological 100k-message session", () => {
    // Simulates the billing-attack surface from the audit: huge session
    // with tiny messages that would otherwise produce a multi-MB prompt.
    const session = makeSession(100_000);
    const result = buildDistillPrompt(session);
    expect(result.truncatedMessageCount).toBe(100_000 - MAX_PROMPT_MESSAGES);
    // Rough upper bound: 1000 messages × ~20 chars each × 2 copies (summary+conv)
    // plus the static prompt skeleton (~1KB). Way under 1MB.
    expect(result.prompt.length).toBeLessThan(1024 * 1024);
  });
});
