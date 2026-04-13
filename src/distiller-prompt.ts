import type { ParsedSession } from "./parsers/types.js";

export function buildDistillPrompt(session: ParsedSession): string {
  const toolSummary = session.messages
    .flatMap((m) => m.toolCalls)
    .map((tc) => `- ${tc.name}: ${JSON.stringify(tc.input).slice(0, 200)}`)
    .join("\n");

  const conversation = session.messages
    .map((m) => {
      const toolInfo =
        m.toolCalls.length > 0
          ? `\n  [Tools: ${m.toolCalls.map((t) => t.name).join(", ")}]`
          : "";
      return `${m.role}: ${m.content.slice(0, 500)}${toolInfo}`;
    })
    .join("\n\n");

  return `You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: ${session.agent}
- Project: ${session.project}
- Tool calls: ${session.totalToolCalls}
- Tools used: ${session.summary.uniqueTools.join(", ")}
- Files modified: ${session.filesModified.join(", ")}

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
}
