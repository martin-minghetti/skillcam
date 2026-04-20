import type { ParsedSession } from "./parsers/types.js";
import { buildDistillPrompt } from "./distiller-prompt.js";
import {
  scanAndRedact,
  SecretsDetectedError,
  type SecretMatch,
} from "./secret-scan.js";
import { sanitizeForTerminal } from "./terminal-safety.js";
import {
  judgeSession,
  NotDistillableError,
  type JudgeOptions,
  type JudgeResult,
} from "./distiller-judge.js";
import {
  parseDistillPayload,
  renderSkillMarkdown,
  DISTILL_PROMPT_VERSION,
  type DistillResult,
} from "./skill-render.js";

export type SecretPolicy = "abort" | "redact" | "allow";

const LLM_TIMEOUT_MS = 60_000;

export interface DistillOptions {
  useLlm?: boolean;
  provider?: "anthropic" | "openai";
  model?: string;
  judgeModel?: string;
  secretPolicy?: SecretPolicy;
  onSecretsDetected?: (matches: SecretMatch[]) => void;
  onJudgment?: (judgment: JudgeResult) => void;
  forceDistill?: boolean;
}

// SecretsDetectedError now lives in secret-scan.ts (so that distiller-judge
// can throw it without an import cycle). Re-exported here for backwards
// compatibility with v0.3.0 consumers.
export { NotDistillableError, DISTILL_PROMPT_VERSION, SecretsDetectedError };

export class DistillationAbortedError extends Error {
  constructor(
    public abortKind: "no_artifact" | "no_reusable_pattern",
    public reason: string
  ) {
    // Audit #3 R1 — sanitize the LLM-controlled reason before embedding it
    // into the message. Otherwise console.error rendering this message would
    // execute ANSI/OSC sequences embedded by a jailbroken distiller model.
    const safeReason = sanitizeForTerminal(reason);
    super(
      `Distiller aborted: ${abortKind}. ${safeReason}\n  Override with --force-distill to bypass.`
    );
    this.name = "DistillationAbortedError";
  }
}

function applyScanPolicy(
  value: string,
  location: string,
  policy: SecretPolicy,
  collected: SecretMatch[]
): string {
  if (!value) return value;
  const { matches, redacted } = scanAndRedact(value, location);
  if (matches.length === 0) return value;

  collected.push(...matches);
  if (policy === "abort") {
    throw new SecretsDetectedError(matches);
  }
  if (policy === "redact") {
    return redacted;
  }
  return value;
}

/**
 * Template distill — offline fallback. Rewritten for v0.2.6 to avoid the
 * v0.2.5 "session-id as skill name" + literal tool-call dump that made those
 * skills unusable. In template mode we ALWAYS emit a stub that's honest about
 * being a stub and tells the user to re-run with --llm for the real thing.
 */
function templateDistill(
  session: ParsedSession,
  secretPolicy: SecretPolicy = "abort",
  onSecretsDetected?: (matches: SecretMatch[]) => void
): string {
  const projectName = (session.project
    .split("/")
    .pop() ?? "unnamed")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const shortId = session.sessionId.slice(0, 8);
  const name = `${projectName}-${shortId}-stub`;

  const tools = session.summary.uniqueTools.join(", ");
  const firstUserMsg =
    session.messages.find((m) => m.role === "user")?.content.slice(0, 200) ?? "N/A";
  const rawFiles = session.filesModified.join(", ") || "none tracked";

  const collected: SecretMatch[] = [];
  const safeProject = applyScanPolicy(session.project, "template:project", secretPolicy, collected);
  const safeFiles = applyScanPolicy(rawFiles, "template:files-modified", secretPolicy, collected);
  const safeFirstMsg = applyScanPolicy(firstUserMsg, "template:first-user-message", secretPolicy, collected);
  const safeTools = applyScanPolicy(tools, "template:tools", secretPolicy, collected);

  if (collected.length > 0) {
    onSecretsDetected?.(collected);
  }

  return `---
name: ${name}
description: Template stub — session captured offline, re-run with --llm for a real skill
source_session: ${session.sessionId}
source_agent: ${session.agent}
created: ${new Date().toISOString().slice(0, 10)}
distill_prompt_version: ${DISTILL_PROMPT_VERSION}-template
confidence: low
tags:
  - auto-extracted
  - template-stub
---

# ${name}

## When to use
Template stub — this file captures the shape of the session but has no distilled pattern.
Re-run \`skillcam distill --llm <session-id>\` to generate an actionable skill.

## Steps
1. Re-run with \`--llm\` and a configured API key to distill a real pattern.

## Example
Session started with: "${safeFirstMsg}"
Modified files: ${safeFiles}
Tools used: ${safeTools}
Total tool calls: ${session.totalToolCalls}

## Key decisions
- (none — template mode does not extract decisions)

## Why this worked
(not captured — template mode)
`;
}

async function callDistillLlm(
  prompt: string,
  provider: "anthropic" | "openai",
  model: string
): Promise<string> {
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=sk-ant-...\nOr use --no-llm for template-only mode."
      );
    }
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ timeout: LLM_TIMEOUT_MS });
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=sk-...\nOr use --no-llm for template-only mode."
    );
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ timeout: LLM_TIMEOUT_MS });
  const response = await client.chat.completions.create({
    model,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0]?.message?.content ?? "";
}

async function llmDistill(
  session: ParsedSession,
  options: Required<Pick<DistillOptions, "provider" | "model" | "secretPolicy">> &
    Pick<DistillOptions, "onSecretsDetected" | "onJudgment" | "judgeModel" | "forceDistill">
): Promise<string> {
  const {
    provider,
    model,
    secretPolicy,
    onSecretsDetected,
    onJudgment,
    judgeModel,
    forceDistill,
  } = options;

  // Step 1 — quality gate. Cheap Haiku call decides whether to spend Sonnet.
  if (!forceDistill) {
    // Audit #3 S1 — propagate the user's secret policy to the judge call so
    // the cheap-gate prompt is scanned BEFORE it leaves the host.
    const judgeOpts: JudgeOptions = {
      provider,
      model: judgeModel,
      secretPolicy,
      onSecretsDetected,
    };
    const judgment = await judgeSession(session, judgeOpts);
    onJudgment?.(judgment);
    if (!judgment.distillable) {
      throw new NotDistillableError(judgment);
    }
  }

  // Step 2 — build the distill prompt, scan for secrets.
  const {
    prompt: builtPrompt,
    matches: builtMatches,
    truncatedMessageCount,
  } = buildDistillPrompt(session);
  if (truncatedMessageCount > 0) {
    console.warn(
      `⚠ Session has ${session.messages.length} messages, capping to the most recent ${session.messages.length - truncatedMessageCount} (B1 billing guard).`
    );
  }
  const { matches: outerMatches, redacted: outerRedacted } = scanAndRedact(
    builtPrompt,
    "distill-prompt"
  );
  const matches: SecretMatch[] = [...builtMatches, ...outerMatches];

  let prompt = builtPrompt;
  if (matches.length > 0) {
    onSecretsDetected?.(matches);
    if (secretPolicy === "abort") {
      throw new SecretsDetectedError(matches);
    }
    if (secretPolicy === "redact") {
      prompt = outerRedacted;
    }
  }

  // Step 3 — main distill call (Sonnet by default).
  let rawLlmOutput: string;
  try {
    rawLlmOutput = await callDistillLlm(prompt, provider, model);
  } catch (err) {
    if (err instanceof SecretsDetectedError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ LLM distillation failed: ${msg}`);
    console.error("  Falling back to template mode.\n");
    return templateDistill(session, secretPolicy, onSecretsDetected);
  }

  // Step 4 — parse strict JSON + render markdown in TS.
  const projectName = (session.project.split("/").pop() ?? "skill")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const fallbackName = `${projectName}-${session.sessionId.slice(0, 8)}`;

  let result: DistillResult;
  try {
    result = parseDistillPayload(rawLlmOutput, fallbackName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Distiller output did not match schema: ${msg}`);
    console.error("  Falling back to template mode.\n");
    return templateDistill(session, secretPolicy, onSecretsDetected);
  }

  if (result.kind === "abort") {
    // Audit #3 D2 — when --force-distill is set, fall back to template
    // mode instead of throwing. The flag promises to "distill even
    // exploratory sessions"; if the model emits abort and we still die
    // with exit 8, the flag was effectively useless. Template stub is the
    // documented fallback shape and keeps the contract that the flag
    // always produces a file.
    if (forceDistill) {
      console.warn(
        `⚠ Distiller emitted abort (${result.payload.abort}); --force-distill is set, falling back to template mode.`
      );
      return templateDistill(session, secretPolicy, onSecretsDetected);
    }
    throw new DistillationAbortedError(result.payload.abort, result.payload.reason);
  }

  return renderSkillMarkdown(result.payload, {
    sessionId: session.sessionId,
    agent: session.agent,
    createdISO: new Date().toISOString().slice(0, 10),
    distillPromptVersion: DISTILL_PROMPT_VERSION,
  });
}

export async function distillSkill(
  session: ParsedSession,
  options: DistillOptions = {}
): Promise<string> {
  const {
    useLlm = true,
    provider = "anthropic",
    model = provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o",
    judgeModel,
    secretPolicy = "abort",
    onSecretsDetected,
    onJudgment,
    forceDistill = false,
  } = options;

  if (!useLlm) {
    return templateDistill(session, secretPolicy, onSecretsDetected);
  }

  return llmDistill(session, {
    provider,
    model,
    judgeModel,
    secretPolicy,
    onSecretsDetected,
    onJudgment,
    forceDistill,
  });
}
