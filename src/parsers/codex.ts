import type { ParsedSession, SessionMessage, ToolCall } from "./types.js";

interface CodexEntry {
  timestamp: string;
  type: "session_meta" | "response_item" | "event_msg" | "turn_context" | string;
  payload: Record<string, unknown>;
}

export function parseCodexSession(jsonl: string): ParsedSession {
  const lines = jsonl.trim().split("\n");
  const entries: CodexEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip
    }
  }

  const messages: SessionMessage[] = [];
  const filesModified = new Set<string>();
  const toolNames = new Set<string>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalToolCalls = 0;

  const meta = entries.find((e) => e.type === "session_meta");
  const metaPayload = meta?.payload as {
    id?: string;
    cwd?: string;
    model_provider?: string;
    model?: string;
  } | undefined;

  // Extract token counts from event_msg/token_count
  for (const entry of entries) {
    if (entry.type === "event_msg") {
      const p = entry.payload as { type?: string; input_tokens?: number; output_tokens?: number };
      if (p.type === "token_count") {
        totalInputTokens += p.input_tokens ?? 0;
        totalOutputTokens += p.output_tokens ?? 0;
      }
    }
  }

  for (const entry of entries) {
    if (entry.type === "response_item") {
      const p = entry.payload as {
        type?: string;
        role?: string;
        content?: Array<{ type: string; text?: string }>;
        call_id?: string;
        name?: string;
        arguments?: string;
        output?: string;
      };

      // Track function/tool calls
      if (p.type === "function_call" || p.type === "web_search_call") {
        const name = p.name ?? p.type;
        toolNames.add(name);
        totalToolCalls++;
        continue;
      }

      // Skip reasoning entries
      if (p.type === "reasoning") continue;

      const role = p.role === "user" || p.role === "developer"
        ? "user" as const
        : "assistant" as const;

      const content = Array.isArray(p.content)
        ? p.content
            .filter((b) => b.type === "output_text" || b.type === "input_text" || b.type === "text")
            .map((b) => b.text ?? "")
            .join("")
        : "";

      if (!content && role === "user") continue; // skip empty system messages

      messages.push({
        role,
        content,
        timestamp: entry.timestamp ?? "",
        toolCalls: [],
        tokenUsage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        model: metaPayload?.model,
      });
    }
  }

  // Attach tool call summaries to assistant messages
  const toolCallList: ToolCall[] = [];
  for (const entry of entries) {
    if (entry.type === "response_item") {
      const p = entry.payload as { type?: string; name?: string; arguments?: string };
      if (p.type === "function_call" || p.type === "web_search_call") {
        toolCallList.push({
          name: p.name ?? p.type,
          input: p.arguments ? tryParseJson(p.arguments) : {},
          output: "",
          timestamp: entry.timestamp ?? "",
        });
      }
    }
  }

  // Distribute tool calls to the nearest preceding assistant message
  let toolIdx = 0;
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const msgTime = new Date(msg.timestamp).getTime();
      while (toolIdx < toolCallList.length) {
        const tcTime = new Date(toolCallList[toolIdx].timestamp).getTime();
        if (tcTime >= msgTime) {
          msg.toolCalls.push(toolCallList[toolIdx]);
          toolIdx++;
        } else {
          break;
        }
      }
    }
  }

  const timestamps = entries
    .filter((e) => e.timestamp)
    .map((e) => e.timestamp);

  return {
    sessionId: metaPayload?.id ?? "unknown",
    agent: "codex",
    project: metaPayload?.cwd ?? "unknown",
    branch: "unknown",
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

function tryParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}
