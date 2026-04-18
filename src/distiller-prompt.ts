import { basename, relative, isAbsolute } from "path";
import type { ParsedSession } from "./parsers/types.js";
import { scanAndRedactTruncate, type SecretMatch } from "./secret-scan.js";

/**
 * Sprint 4 — trim absolute paths out of prompt metadata. The LLM still gets
 * the project name and each file name for context, but the full
 * /Users/<you>/<private-dir> prefix never leaves the machine.
 *
 * - Files inside the project → relative path ("src/foo.ts")
 * - Files outside the project → basename only ("other.ts")
 * - Relative inputs pass through unchanged
 */
function stripPath(p: string, projectRoot: string): string {
  if (!p) return p;
  if (!isAbsolute(p)) return p;
  if (isAbsolute(projectRoot)) {
    const rel = relative(projectRoot, p);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  return basename(p);
}

export interface BuildDistillPromptResult {
  prompt: string;
  matches: SecretMatch[];
}

/**
 * Build the distillation prompt from a parsed session.
 *
 * Sprint 2 / audit C2 B1 fix: we previously did `m.content.slice(0, 500)` and
 * `JSON.stringify(tc.input).slice(0, 200)` *before* the distiller ran the
 * secret scanner over the final prompt string. A long-enough padded message
 * let an attacker push a real API key into the slice-cut zone so the scanner
 * saw only its first few chars (below the 20-char regex minimum).
 *
 * Every user-controllable field now passes through `scanAndRedactTruncate`,
 * which scans first (on the full, normalized text) and truncates second.
 * Matches from each field are collected and returned so the caller can apply
 * its `abort | redact | allow` policy uniformly.
 */
export function buildDistillPrompt(session: ParsedSession): BuildDistillPromptResult {
  const matches: SecretMatch[] = [];

  const toolSummary = session.messages
    .flatMap((m, mi) =>
      m.toolCalls.map((tc, ti) => {
        const raw = `- ${tc.name}: ${JSON.stringify(tc.input)}`;
        const scanned = scanAndRedactTruncate(
          raw,
          200 + tc.name.length + 4, // keep the "- name: " prefix budget
          `tool-call[${mi}][${ti}]`
        );
        matches.push(...scanned.matches);
        return scanned.redacted;
      })
    )
    .join("\n");

  const conversation = session.messages
    .map((m, mi) => {
      const scanned = scanAndRedactTruncate(m.content, 500, `message[${mi}]`);
      matches.push(...scanned.matches);
      const toolInfo =
        m.toolCalls.length > 0
          ? `\n  [Tools: ${m.toolCalls.map((t) => t.name).join(", ")}]`
          : "";
      return `${m.role}: ${scanned.redacted}${toolInfo}`;
    })
    .join("\n\n");

  const projectName = isAbsolute(session.project)
    ? basename(session.project)
    : session.project;
  const strippedFiles = session.filesModified.map((f) =>
    stripPath(f, session.project)
  );

  const prompt = `You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: ${session.agent}
- Project: ${projectName}
- Tool calls: ${session.totalToolCalls}
- Tools used: ${session.summary.uniqueTools.join(", ")}
- Files modified: ${strippedFiles.join(", ")}

## Tool Calls
${toolSummary}

## Conversation
${conversation}

## Your Task

Extract the reusable pattern from this session. Output a SKILL.md with this exact format:

\`\`\`markdown
---
name: <kebab-case-name>
description: <one line description of what this skill does>
source_session: ${session.sessionId}
source_agent: ${session.agent}
created: ${new Date().toISOString().split("T")[0]}
tags:
  - <tag1>
  - <tag2>
---

# <Skill Name>

## When to use
<1-3 sentences describing when an agent should use this skill>

## Steps
<Numbered list of concrete steps the agent should follow>

## Example
<Short example showing input and expected output>

## Key decisions
<Bullet list of important decisions or gotchas discovered during the session>
\`\`\`

Rules:
- Be specific and actionable, not generic
- Include actual file paths, commands, or patterns from the session
- The skill should be usable by someone who never saw the original session
- Keep it under 100 lines`;

  return { prompt, matches };
}
