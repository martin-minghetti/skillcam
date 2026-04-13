export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: string;
  timestamp: string;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls: ToolCall[];
  tokenUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  model?: string;
}

export interface ParsedSession {
  sessionId: string;
  agent: "claude-code" | "codex" | "gemini";
  project: string;
  branch: string;
  startedAt: string;
  endedAt: string;
  messages: SessionMessage[];
  totalTokens: { input: number; output: number };
  totalToolCalls: number;
  filesModified: string[];
  summary: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    uniqueTools: string[];
  };
}
