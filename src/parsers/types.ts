export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: string;
  timestamp: string;
}

export interface SessionMessage {
  // M5 — `developer` is a distinct Codex role (system-level instructions).
  // It must NOT be folded into `user` because the distiller prompt treats
  // user messages as conversation content. See src/parsers/codex.ts.
  role: "user" | "assistant" | "system" | "developer";
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
