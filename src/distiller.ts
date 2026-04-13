import type { ParsedSession } from "./parsers/types.js";
import { buildDistillPrompt } from "./distiller-prompt.js";

interface DistillOptions {
  useLlm?: boolean;
  provider?: "anthropic" | "openai";
  model?: string;
}

function templateDistill(session: ParsedSession): string {
  const name = session.project
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") ?? "unnamed-skill";

  const tools = session.summary.uniqueTools.join(", ");
  const files = session.filesModified.join(", ") || "none tracked";

  const steps = session.messages
    .filter((m) => m.role === "assistant" && m.toolCalls.length > 0)
    .flatMap((m, i) =>
      m.toolCalls.map(
        (tc, j) =>
          `${i + 1}.${j + 1}. Use \`${tc.name}\` on \`${JSON.stringify(tc.input).slice(0, 100)}\``
      )
    )
    .join("\n");

  return `---
name: ${name}
description: Pattern extracted from ${session.agent} session (${session.totalToolCalls} tool calls)
source_session: ${session.sessionId}
source_agent: ${session.agent}
created: ${new Date().toISOString().split("T")[0]}
tags:
  - auto-extracted
  - ${session.agent}
---

# ${name}

## When to use
When working on a similar task in \`${session.project}\`. This pattern used ${tools}.

## Steps
${steps || "No tool call steps extracted."}

## Example
Session started with: "${session.messages.find((m) => m.role === "user")?.content.slice(0, 200) ?? "N/A"}"
Modified files: ${files}
Total tool calls: ${session.totalToolCalls}

## Key decisions
- Tools used: ${tools}
- Token cost: ${session.totalTokens.input + session.totalTokens.output} tokens
- Duration: ${session.startedAt} to ${session.endedAt}
`;
}

async function llmDistill(
  session: ParsedSession,
  provider: "anthropic" | "openai",
  model: string
): Promise<string> {
  const prompt = buildDistillPrompt(session);

  try {
    if (provider === "anthropic") {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=sk-ant-...\nOr use --no-llm for template-only mode.");
      }
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.text ?? templateDistill(session);
    }

    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=sk-...\nOr use --no-llm for template-only mode.");
      }
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI();
      const response = await client.chat.completions.create({
        model,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0]?.message?.content ?? templateDistill(session);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ LLM distillation failed: ${msg}`);
    console.error("  Falling back to template mode.\n");
    return templateDistill(session);
  }

  return templateDistill(session);
}

export async function distillSkill(
  session: ParsedSession,
  options: DistillOptions = {}
): Promise<string> {
  const {
    useLlm = true,
    provider = "anthropic",
    model = provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o",
  } = options;

  if (!useLlm) {
    return templateDistill(session);
  }

  return llmDistill(session, provider, model);
}
