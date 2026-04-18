import { describe, it, expect } from "vitest";
import {
  MAX_SESSION_BYTES,
  MAX_LINE_BYTES,
  MAX_SKILL_BYTES,
  isSessionSizeAllowed,
  truncateSkill,
} from "../src/limits.js";
import { parseClaudeCodeSession } from "../src/parsers/claude-code.js";
import { parseCodexSession } from "../src/parsers/codex.js";

describe("DoS limits — constants (M4)", () => {
  it("exposes documented byte caps", () => {
    expect(MAX_SESSION_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_LINE_BYTES).toBe(1024 * 1024);
    expect(MAX_SKILL_BYTES).toBe(100 * 1024);
  });
});

describe("isSessionSizeAllowed (M4)", () => {
  it("accepts a 10MB file", () => {
    expect(isSessionSizeAllowed(10 * 1024 * 1024)).toBe(true);
  });

  it("accepts exactly MAX_SESSION_BYTES", () => {
    expect(isSessionSizeAllowed(MAX_SESSION_BYTES)).toBe(true);
  });

  it("rejects one byte over MAX_SESSION_BYTES", () => {
    expect(isSessionSizeAllowed(MAX_SESSION_BYTES + 1)).toBe(false);
  });

  it("rejects a 1GB file", () => {
    expect(isSessionSizeAllowed(1024 * 1024 * 1024)).toBe(false);
  });
});

describe("truncateSkill (M4)", () => {
  it("returns short strings unchanged", () => {
    const s = "hello world";
    expect(truncateSkill(s)).toBe(s);
  });

  it("truncates oversized strings with a marker", () => {
    const big = "a".repeat(MAX_SKILL_BYTES + 1000);
    const out = truncateSkill(big);
    expect(out.length).toBeLessThanOrEqual(MAX_SKILL_BYTES + 20);
    expect(out.endsWith("[TRUNCATED]")).toBe(true);
  });
});

describe("parsers — per-line cap (M4)", () => {
  it("claude-code parser drops lines over MAX_LINE_BYTES", () => {
    // A 2MB single-line "string" that, were it to reach JSON.parse, would be
    // an explicit CPU/memory DoS. Our parser must skip it silently.
    const badLine = JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) });
    const goodLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "hello" },
      timestamp: "2026-04-17T10:00:00Z",
      sessionId: "abc",
      cwd: "/tmp",
      gitBranch: "main",
      uuid: "u1",
    });
    const jsonl = `${badLine}\n${goodLine}`;
    const session = parseClaudeCodeSession(jsonl);
    // The good line's content must still show up
    expect(session.messages.some((m) => m.content === "hello")).toBe(true);
  });

  it("codex parser drops lines over MAX_LINE_BYTES", () => {
    const badLine = JSON.stringify({ payload: "y".repeat(2 * 1024 * 1024) });
    const goodLine = JSON.stringify({
      timestamp: "2026-04-17T10:00:00Z",
      type: "session_meta",
      payload: { id: "abc", cwd: "/tmp" },
    });
    const jsonl = `${badLine}\n${goodLine}`;
    const session = parseCodexSession(jsonl);
    expect(session.sessionId).toBe("abc");
  });
});
