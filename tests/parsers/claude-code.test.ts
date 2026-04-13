import { describe, it, expect } from "vitest";
import { parseClaudeCodeSession } from "../../src/parsers/claude-code.js";
import { readFileSync } from "fs";
import { join } from "path";

const fixturePath = join(
  import.meta.dirname,
  "../fixtures/claude-code-session.jsonl"
);

describe("parseClaudeCodeSession", () => {
  it("parses a JSONL file into a ParsedSession", () => {
    const jsonl = readFileSync(fixturePath, "utf-8");
    const session = parseClaudeCodeSession(jsonl);

    expect(session.agent).toBe("claude-code");
    expect(session.sessionId).toBeTruthy();
    expect(session.messages.length).toBeGreaterThan(0);
    expect(session.summary.userMessages).toBeGreaterThan(0);
    expect(session.summary.assistantMessages).toBeGreaterThan(0);
  });

  it("extracts tool calls from assistant messages", () => {
    const jsonl = readFileSync(fixturePath, "utf-8");
    const session = parseClaudeCodeSession(jsonl);

    const toolMessages = session.messages.filter(
      (m) => m.toolCalls.length > 0
    );
    expect(toolMessages.length).toBeGreaterThan(0);
    expect(toolMessages[0].toolCalls[0].name).toBeTruthy();
  });

  it("calculates total token usage", () => {
    const jsonl = readFileSync(fixturePath, "utf-8");
    const session = parseClaudeCodeSession(jsonl);

    expect(session.totalTokens.input).toBeGreaterThan(0);
    expect(session.totalTokens.output).toBeGreaterThan(0);
  });
});
