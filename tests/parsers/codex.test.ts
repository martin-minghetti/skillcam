import { describe, it, expect } from "vitest";
import { parseCodexSession } from "../../src/parsers/codex.js";
import { readFileSync } from "fs";
import { join } from "path";

const fixturePath = join(
  import.meta.dirname,
  "../fixtures/codex-session.jsonl"
);

describe("parseCodexSession", () => {
  it("parses a Codex JSONL file into a ParsedSession", () => {
    const jsonl = readFileSync(fixturePath, "utf-8");
    const session = parseCodexSession(jsonl);

    expect(session.agent).toBe("codex");
    expect(session.sessionId).toBeTruthy();
    expect(session.messages.length).toBeGreaterThan(0);
  });

  it("extracts tool calls from response items", () => {
    const jsonl = readFileSync(fixturePath, "utf-8");
    const session = parseCodexSession(jsonl);

    expect(session.totalToolCalls).toBeGreaterThanOrEqual(0);
  });
});
