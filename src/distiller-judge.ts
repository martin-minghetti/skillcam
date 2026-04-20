import type { ParsedSession } from "./parsers/types.js";
import { anonymizePath } from "./tool-summary.js";

/**
 * v0.2.6 — Two-step architecture.
 *
 * Before burning Sonnet tokens on the distill call, ask cheap Haiku whether
 * the session even contains a reusable pattern. Kills three of the worst
 * v0.2.5 failure modes in one shot:
 *
 *   1. Exploratory sessions (no artifact, agent just "looked around") no
 *      longer produce skills built from tool-call transcripts.
 *   2. Failed attempts that the user abandoned don't get canonized as
 *      "patterns".
 *   3. Sessions that ARE productive but generic ("read a file, write a
 *      file") get flagged low-confidence before the main call, so the user
 *      can bail cheaply.
 */

const JUDGE_TIMEOUT_MS = 20_000;
const JUDGE_MODEL_DEFAULT = "claude-haiku-4-5-20251001";

export interface JudgeResult {
  distillable: boolean;
  reason: string;
  confidence: "high" | "medium" | "low";
  raw?: string;
}

export interface JudgeOptions {
  provider?: "anthropic" | "openai";
  model?: string;
  timeoutMs?: number;
}

function firstUserMessage(session: ParsedSession): string {
  const m = session.messages.find((msg) => msg.role === "user");
  return (m?.content ?? "").slice(0, 500);
}

function lastAssistantMessage(session: ParsedSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.content) {
      return m.content.slice(0, 500);
    }
  }
  return "";
}

function bashOutcomes(session: ParsedSession): string {
  const outputs: string[] = [];
  for (const m of session.messages) {
    for (const tc of m.toolCalls) {
      if (tc.name === "Bash" && tc.output) {
        outputs.push(tc.output.slice(0, 200));
      }
    }
  }
  return outputs.slice(-3).join(" | ");
}

export function buildJudgePrompt(session: ParsedSession): string {
  const filesModified = session.filesModified
    .map((f) => anonymizePath(f, session.project))
    .join(", ");
  const intent = firstUserMessage(session);
  const outcome = lastAssistantMessage(session);
  const bash = bashOutcomes(session);

  return `You are a quality gate for skill extraction. Decide whether this agent session contains a REUSABLE PATTERN worth turning into a skill.

A session IS distillable when ALL of these hold:
1. It produced a concrete artifact (files modified, commands completed, or a specific answer to a posed question).
2. The pattern could plausibly be reused in a future session with different specifics.
3. Steps are not entirely generic tool usage — there is a goal you can name in one sentence.

A session is NOT distillable when:
- It was pure exploration with no outcome.
- The user abandoned the task or ended without success.
- Every action was generic ("read the file", "search the codebase") without a specific goal.

## Session

### Intent (first user message)
${intent}

### Outcome signals
- Files modified: ${filesModified || "(none)"}
- Tool calls: ${session.totalToolCalls}
- Tools used: ${session.summary.uniqueTools.join(", ")}
- Last 3 Bash outputs: ${bash || "(none)"}
- Final assistant message: ${outcome}

## Output

Emit EXACTLY this JSON object, nothing else, no prose, no code fences:

{"distillable": <true|false>, "reason": "<one short sentence>", "confidence": "<high|medium|low>"}`;
}

function extractFirstJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Find the first balanced top-level JSON object.
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function coerceResult(raw: string): JudgeResult {
  const obj = extractFirstJson(raw);
  if (!obj) {
    // Fail-open: when judge output is unparseable, default to distillable
    // with low confidence. Better to let the user see a skill than block
    // valid sessions on a parser quirk.
    return {
      distillable: true,
      reason: "judge output unparseable, defaulting to distill",
      confidence: "low",
      raw,
    };
  }
  const distillable = Boolean(obj.distillable);
  const reason = typeof obj.reason === "string" ? obj.reason : "no reason given";
  const rawConfidence = typeof obj.confidence === "string" ? obj.confidence : "low";
  const confidence: JudgeResult["confidence"] =
    rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low"
      ? rawConfidence
      : "low";
  return { distillable, reason, confidence, raw };
}

export async function judgeSession(
  session: ParsedSession,
  options: JudgeOptions = {}
): Promise<JudgeResult> {
  const { provider = "anthropic", model, timeoutMs = JUDGE_TIMEOUT_MS } = options;
  const prompt = buildJudgePrompt(session);

  try {
    if (provider === "anthropic") {
      if (!process.env.ANTHROPIC_API_KEY) {
        // No key: fail-open conservatively. The distiller will still run
        // template mode which is safe by default.
        return {
          distillable: true,
          reason: "ANTHROPIC_API_KEY not set, judge skipped",
          confidence: "low",
        };
      }
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ timeout: timeoutMs });
      const response = await client.messages.create({
        model: model ?? JUDGE_MODEL_DEFAULT,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.text ?? "";
      return coerceResult(text);
    }

    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        return {
          distillable: true,
          reason: "OPENAI_API_KEY not set, judge skipped",
          confidence: "low",
        };
      }
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ timeout: timeoutMs });
      const response = await client.chat.completions.create({
        model: model ?? "gpt-4o-mini",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.choices[0]?.message?.content ?? "";
      return coerceResult(text);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Judge failures are not fatal — degrade gracefully.
    return {
      distillable: true,
      reason: `judge call failed: ${msg}`,
      confidence: "low",
    };
  }

  return {
    distillable: true,
    reason: "unknown provider, judge skipped",
    confidence: "low",
  };
}

export class NotDistillableError extends Error {
  constructor(public judgment: JudgeResult) {
    super(
      `Session is not distillable: ${judgment.reason}\n  Override with --force-distill to skip the quality gate.`
    );
    this.name = "NotDistillableError";
  }
}
