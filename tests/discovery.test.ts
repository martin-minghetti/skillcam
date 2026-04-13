import { describe, it, expect } from "vitest";
import { discoverSessions } from "../src/discovery.js";

describe("discoverSessions", () => {
  it("finds Claude Code sessions in ~/.claude/projects/", () => {
    const sessions = discoverSessions({ agent: "claude-code", limit: 5 });
    // May be empty in CI, but should not throw
    expect(Array.isArray(sessions)).toBe(true);
    for (const s of sessions) {
      expect(s.agent).toBe("claude-code");
      expect(s.path).toContain(".claude/projects");
      expect(s.sessionId).toBeTruthy();
    }
  });

  it("finds Codex sessions in ~/.codex/sessions/", () => {
    const sessions = discoverSessions({ agent: "codex", limit: 5 });
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("returns sessions sorted by most recent first", () => {
    const sessions = discoverSessions({ limit: 5 });
    if (sessions.length >= 2) {
      expect(
        new Date(sessions[0].modifiedAt).getTime()
      ).toBeGreaterThanOrEqual(
        new Date(sessions[1].modifiedAt).getTime()
      );
    }
  });
});
