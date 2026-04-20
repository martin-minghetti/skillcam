import type { ParsedSession } from "./parsers/types.js";
import { anonymizePath } from "./tool-summary.js";
import { extractFirstJson } from "./skill-render.js";
import { sanitizeForTerminal } from "./terminal-safety.js";
import {
  scanAndRedact,
  SecretsDetectedError,
  type SecretMatch,
} from "./secret-scan.js";

export type SecretPolicy = "abort" | "redact" | "allow";

// Audit #3 J2 — strict tool schema for the judge response. Forcing the
// model to call this tool (instead of emitting JSON in a text block)
// closes every attack that relied on injecting literal output bytes:
// malformed JSON, text-only replies, control-char smuggling, etc. It does
// NOT prevent a jailbroken model from choosing the wrong distillable
// value — that is defense-in-depth work for a future revision.
const JUDGE_TOOL_NAME = "report_judgment";
const JUDGE_TOOL_DESCRIPTION =
  "Report whether the agent session contains a reusable pattern worth turning into a skill.";
const JUDGE_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    distillable: { type: "boolean" as const },
    reason: { type: "string" as const, maxLength: 200 },
    confidence: {
      type: "string" as const,
      enum: ["high", "medium", "low"],
    },
  },
  required: ["distillable", "reason", "confidence"],
};

function coerceJudgeInput(input: unknown): JudgeResult {
  if (!input || typeof input !== "object") {
    return {
      distillable: false,
      reason: "judge tool returned non-object input",
      confidence: "low",
    };
  }
  const obj = input as Record<string, unknown>;
  const distillable = obj.distillable === true;
  const reason = typeof obj.reason === "string" ? obj.reason : "no reason given";
  const rawConfidence = typeof obj.confidence === "string" ? obj.confidence : "low";
  const confidence: JudgeResult["confidence"] =
    rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low"
      ? rawConfidence
      : "low";
  return { distillable, reason, confidence, raw: JSON.stringify(obj) };
}

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
  // Audit #3 S1 — apply the same secret policy the distiller does. Without
  // this the cheap-gate call exfiltrates session content to the LLM before
  // any scan runs.
  secretPolicy?: SecretPolicy;
  onSecretsDetected?: (matches: SecretMatch[]) => void;
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

export function coerceResult(raw: string): JudgeResult {
  // Audit #3 J1 — use the string-aware extractor from skill-render so that
  // a literal "}" inside `reason` does not break parsing. The previous
  // local implementation counted braces unconditionally and returned null
  // on valid JSON whose reason contained a "}", which then triggered a
  // fail-open default.
  const obj = extractFirstJson(raw);
  if (!obj) {
    // Fail CLOSED on unparseable output. Otherwise an attacker who can
    // induce parser failure (corrupt output, truncation, prompt injection
    // emitting non-JSON) bypasses the quality gate. A skipped distill is
    // recoverable; a bypassed gate is not.
    return {
      distillable: false,
      reason: "judge output unparseable, refusing to distill",
      confidence: "low",
      raw,
    };
  }
  // Audit #3 J1b — strict boolean check. Boolean("false") === true would
  // accept any truthy string ("false", "no", "0") as distillable. Only the
  // literal JSON boolean `true` opens the gate.
  const distillable = obj.distillable === true;
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
  const {
    provider = "anthropic",
    model,
    timeoutMs = JUDGE_TIMEOUT_MS,
    secretPolicy = "abort",
    onSecretsDetected,
  } = options;
  const rawPrompt = buildJudgePrompt(session);

  // Audit #3 S1 — scan the judge prompt before any network call. Apply the
  // same policy semantics the distiller uses (abort | redact | allow).
  const { matches, redacted } = scanAndRedact(rawPrompt, "judge-prompt");
  if (matches.length > 0) {
    onSecretsDetected?.(matches);
    if (secretPolicy === "abort") {
      throw new SecretsDetectedError(matches);
    }
  }
  const prompt = secretPolicy === "redact" && matches.length > 0 ? redacted : rawPrompt;

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
        // Audit #3 J2 — force the model to call our typed tool instead of
        // emitting JSON in a text block. The SDK gives us back the input
        // already parsed.
        tools: [
          {
            name: JUDGE_TOOL_NAME,
            description: JUDGE_TOOL_DESCRIPTION,
            input_schema: JUDGE_INPUT_SCHEMA,
          },
        ],
        tool_choice: { type: "tool", name: JUDGE_TOOL_NAME },
        messages: [{ role: "user", content: prompt }],
      });
      const toolUseBlock = response.content.find(
        (b: { type: string; name?: string }) =>
          b.type === "tool_use" && b.name === JUDGE_TOOL_NAME
      ) as { input?: unknown } | undefined;
      if (toolUseBlock) {
        return coerceJudgeInput(toolUseBlock.input);
      }
      // Defense in depth — model ignored the tool and replied with text.
      // Try the legacy string-aware parser as a fallback rather than fail.
      const textBlock = response.content.find(
        (b: { type: string }) => b.type === "text"
      ) as { text?: string } | undefined;
      return coerceResult(textBlock?.text ?? "");
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
        // Audit #3 J2 — equivalent function-calling enforcement on OpenAI.
        tools: [
          {
            type: "function" as const,
            function: {
              name: JUDGE_TOOL_NAME,
              description: JUDGE_TOOL_DESCRIPTION,
              parameters: JUDGE_INPUT_SCHEMA,
            },
          },
        ],
        tool_choice: {
          type: "function" as const,
          function: { name: JUDGE_TOOL_NAME },
        },
        messages: [{ role: "user", content: prompt }],
      });
      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      // OpenAI SDK 6+ unions ChatCompletionMessageToolCall with a custom-tool
      // variant; only the function-tool variant has `.function`. Narrow it.
      if (toolCall && "function" in toolCall && toolCall.function?.name === JUDGE_TOOL_NAME) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          return coerceJudgeInput(parsed);
        } catch {
          return {
            distillable: false,
            reason: "judge tool arguments not valid JSON",
            confidence: "low",
          };
        }
      }
      // Defense in depth — fall back to text content if the model ignored
      // the function. Same rationale as the Anthropic path above.
      const text = response.choices[0]?.message?.content ?? "";
      return coerceResult(text);
    }
  } catch (err) {
    // Audit #3 S1 — propagate SecretsDetectedError unchanged so the CLI sees
    // the policy violation; only soft-fail on transient LLM/network errors.
    if (err instanceof SecretsDetectedError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // Judge failures are not fatal — degrade gracefully (closed). v0.3.1: was
    // fail-open; aligned with J1 to fail-closed so an attacker who can force
    // a transport error cannot bypass the gate.
    return {
      distillable: false,
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
    // Audit #3 R1 — sanitize the LLM-controlled reason before embedding it
    // into the message. Otherwise console.error rendering this message would
    // execute ANSI/OSC sequences embedded by a jailbroken judge model.
    const safeReason = sanitizeForTerminal(judgment.reason);
    super(
      `Session is not distillable: ${safeReason}\n  Override with --force-distill to skip the quality gate.`
    );
    this.name = "NotDistillableError";
  }
}
