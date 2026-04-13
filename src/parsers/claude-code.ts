import type { ParsedSession, SessionMessage, ToolCall } from "./types.js";

interface RawEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string; thinking?: string; name?: string; input?: Record<string, unknown>; id?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    model?: string;
  };
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  uuid?: string;
  parentUuid?: string;
}

export function parseClaudeCodeSession(jsonl: string): ParsedSession {
  const lines = jsonl.trim().split("\n");
  const entries: RawEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  const messages: SessionMessage[] = [];
  const filesModified = new Set<string>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const toolNames = new Set<string>();
  let totalToolCalls = 0;

  // Collect tool results by parentUuid for matching
  const toolResults = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "tool_result" && entry.message?.content) {
      const content =
        typeof entry.message.content === "string"
          ? entry.message.content
          : JSON.stringify(entry.message.content);
      if (entry.parentUuid) {
        toolResults.set(entry.parentUuid, content);
      }
    }
  }

  for (const entry of entries) {
    if (entry.type === "user" && entry.message?.role === "user") {
      const content =
        typeof entry.message.content === "string"
          ? entry.message.content
          : "";
      messages.push({
        role: "user",
        content,
        timestamp: entry.timestamp ?? "",
        toolCalls: [],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      });
    }

    if (entry.type === "assistant" && entry.message?.role === "assistant") {
      const usage = entry.message.usage;
      const inputTokens = usage?.input_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? 0;
      const cacheRead = usage?.cache_read_input_tokens ?? 0;
      const cacheWrite = usage?.cache_creation_input_tokens ?? 0;

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      // Extract text content
      let textContent = "";
      const toolCalls: ToolCall[] = [];

      if (Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block.type === "text" && block.text) {
            textContent += block.text;
          }
          if (block.type === "tool_use") {
            const tc = block as unknown as {
              name: string;
              input: Record<string, unknown>;
              id: string;
            };
            toolNames.add(tc.name);
            totalToolCalls++;

            // Track file modifications
            if (
              ["Write", "Edit"].includes(tc.name) &&
              tc.input?.file_path
            ) {
              filesModified.add(tc.input.file_path as string);
            }

            toolCalls.push({
              name: tc.name,
              input: tc.input ?? {},
              output: toolResults.get(entry.uuid ?? "") ?? "",
              timestamp: entry.timestamp ?? "",
            });
          }
        }
      }

      messages.push({
        role: "assistant",
        content: textContent,
        timestamp: entry.timestamp ?? "",
        toolCalls,
        tokenUsage: {
          input: inputTokens,
          output: outputTokens,
          cacheRead,
          cacheWrite,
        },
        model: entry.message.model,
      });
    }
  }

  const sessionId =
    entries.find((e) => e.sessionId)?.sessionId ?? "unknown";
  const project = entries.find((e) => e.cwd)?.cwd ?? "unknown";
  const branch = entries.find((e) => e.gitBranch)?.gitBranch ?? "unknown";
  const timestamps = entries
    .filter((e) => e.timestamp)
    .map((e) => e.timestamp!);

  return {
    sessionId,
    agent: "claude-code",
    project,
    branch,
    startedAt: timestamps[0] ?? "",
    endedAt: timestamps[timestamps.length - 1] ?? "",
    messages,
    totalTokens: { input: totalInputTokens, output: totalOutputTokens },
    totalToolCalls,
    filesModified: [...filesModified],
    summary: {
      userMessages: messages.filter((m) => m.role === "user").length,
      assistantMessages: messages.filter((m) => m.role === "assistant").length,
      toolCalls: totalToolCalls,
      uniqueTools: [...toolNames],
    },
  };
}
