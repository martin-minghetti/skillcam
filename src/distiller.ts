import type { ParsedSession } from "./parsers/types.js";
import { buildDistillPrompt } from "./distiller-prompt.js";
import { scanAndRedact, summarize, type SecretMatch } from "./secret-scan.js";

export type SecretPolicy = "abort" | "redact" | "allow";

// 60 second timeout for LLM calls (M3)
const LLM_TIMEOUT_MS = 60_000;

interface DistillOptions {
  useLlm?: boolean;
  provider?: "anthropic" | "openai";
  model?: string;
  secretPolicy?: SecretPolicy;
  onSecretsDetected?: (matches: SecretMatch[]) => void;
}

export class SecretsDetectedError extends Error {
  constructor(public matches: SecretMatch[]) {
    super(
      `Found ${matches.length} potential secret(s) in session. Run with --redact to redact and continue, --no-llm to stay local, or --allow-secrets to send as-is (not recommended).\n${summarize(matches)}`
    );
    this.name = "SecretsDetectedError";
  }
}

/**
 * Scan a field for secrets according to policy. Returns the value to use
 * (either original or redacted) or throws if policy is "abort" and matches found.
 *
 * C4 fix: template mode used to write session metadata (project, first user
 * message, filesModified) directly to SKILL.md without scanning. An agent that
 * put `ANTHROPIC_API_KEY=sk-ant-...` in a message or in a file path would have
 * it persisted in the skill file, where the user might commit it.
 */
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
  // "allow" — return as-is
  return value;
}

function templateDistill(
  session: ParsedSession,
  secretPolicy: SecretPolicy = "abort",
  onSecretsDetected?: (matches: SecretMatch[]) => void
): string {
  const projectName = session.project
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") ?? "unnamed";
  const shortId = session.sessionId.slice(0, 8);
  const name = `${projectName}-${shortId}`;

  const tools = session.summary.uniqueTools.join(", ");
  const firstUserMsg = session.messages.find((m) => m.role === "user")?.content.slice(0, 200) ?? "N/A";
  const rawFiles = session.filesModified.join(", ") || "none tracked";
  const rawProject = session.project;

  // Build tool-call steps and capture raw strings we need to scan
  const stepsRaw = session.messages
    .filter((m) => m.role === "assistant" && m.toolCalls.length > 0)
    .flatMap((m, i) =>
      m.toolCalls.map(
        (tc, j) =>
          `${i + 1}.${j + 1}. Use \`${tc.name}\` on \`${JSON.stringify(tc.input).slice(0, 100)}\``
      )
    )
    .join("\n");

  // C4 — scan every user-controllable field before it hits disk
  const collected: SecretMatch[] = [];
  const safeProject = applyScanPolicy(rawProject, "template:project", secretPolicy, collected);
  const safeProjectName = applyScanPolicy(projectName, "template:project-name", secretPolicy, collected);
  const safeFiles = applyScanPolicy(rawFiles, "template:files-modified", secretPolicy, collected);
  const safeFirstMsg = applyScanPolicy(firstUserMsg, "template:first-user-message", secretPolicy, collected);
  const safeSteps = applyScanPolicy(stepsRaw, "template:steps", secretPolicy, collected);
  const safeTools = applyScanPolicy(tools, "template:tools", secretPolicy, collected);
  const safeName = `${safeProjectName}-${shortId}`;

  if (collected.length > 0) {
    onSecretsDetected?.(collected);
  }

  return `---
name: ${safeName}
description: Pattern extracted from ${session.agent} session (${session.totalToolCalls} tool calls)
source_session: ${session.sessionId}
source_agent: ${session.agent}
created: ${new Date().toISOString().split("T")[0]}
tags:
  - auto-extracted
  - ${session.agent}
---

# ${safeName}

## When to use
When working on a similar task in \`${safeProject}\`. This pattern used ${safeTools}.

## Steps
${safeSteps || "No tool call steps extracted."}

## Example
Session started with: "${safeFirstMsg}"
Modified files: ${safeFiles}
Total tool calls: ${session.totalToolCalls}

## Key decisions
- Tools used: ${safeTools}
- Token cost: ${session.totalTokens.input + session.totalTokens.output} tokens
- Duration: ${session.startedAt} to ${session.endedAt}
`;
}

async function llmDistill(
  session: ParsedSession,
  provider: "anthropic" | "openai",
  model: string,
  secretPolicy: SecretPolicy,
  onSecretsDetected?: (matches: SecretMatch[]) => void
): Promise<string> {
  // Sprint 2 / audit C2 B1: buildDistillPrompt now returns the per-field
  // scan matches (collected BEFORE truncation) alongside the prompt. We still
  // run a final scanAndRedact over the composed prompt as defense-in-depth
  // for session metadata (project, filesModified, sessionId, tool names...)
  // that does not flow through the per-field scanner.
  const {
    prompt: builtPrompt,
    matches: builtMatches,
    truncatedMessageCount,
  } = buildDistillPrompt(session);
  if (truncatedMessageCount > 0) {
    // B1 — surface the cost-protection truncation so the user knows why some
    // of their session didn't reach the LLM.
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
      // outerRedacted contains both the per-field redactions (already baked
      // into builtPrompt) plus any extra redactions from the outer pass.
      prompt = outerRedacted;
    }
    // "allow" falls through and sends builtPrompt as-is
  }

  try {
    if (provider === "anthropic") {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=sk-ant-...\nOr use --no-llm for template-only mode.");
      }
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      // M3 — explicit client-level timeout so a stalled provider does not hang the CLI
      const client = new Anthropic({ timeout: LLM_TIMEOUT_MS });
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.text ?? templateDistill(session, secretPolicy, onSecretsDetected);
    }

    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=sk-...\nOr use --no-llm for template-only mode.");
      }
      const { default: OpenAI } = await import("openai");
      // M3 — same timeout for OpenAI client
      const client = new OpenAI({ timeout: LLM_TIMEOUT_MS });
      const response = await client.chat.completions.create({
        model,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0]?.message?.content ?? templateDistill(session, secretPolicy, onSecretsDetected);
    }
  } catch (err) {
    if (err instanceof SecretsDetectedError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ LLM distillation failed: ${msg}`);
    console.error("  Falling back to template mode.\n");
    return templateDistill(session, secretPolicy, onSecretsDetected);
  }

  return templateDistill(session, secretPolicy, onSecretsDetected);
}

export async function distillSkill(
  session: ParsedSession,
  options: DistillOptions = {}
): Promise<string> {
  const {
    useLlm = true,
    provider = "anthropic",
    model = provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o",
    secretPolicy = "abort",
    onSecretsDetected,
  } = options;

  if (!useLlm) {
    return templateDistill(session, secretPolicy, onSecretsDetected);
  }

  return llmDistill(session, provider, model, secretPolicy, onSecretsDetected);
}
