<p align="center">
  <img src="assets/demo.gif" alt="SkillCam demo" width="700">
</p>

<h1 align="center">SkillCam</h1>

<p align="center">
  Turn successful AI agent runs into reusable markdown skills.<br>
  Stop solving the same problem twice.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skillcam"><img src="https://img.shields.io/npm/v/skillcam.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/skillcam"><img src="https://img.shields.io/npm/dm/skillcam.svg" alt="npm downloads"></a>
</p>

---

## The Problem

Your AI coding agents solve problems every day. They read files, run tools, iterate on solutions, and eventually get it right. Then they forget everything.

Next time the same problem shows up, the agent starts from scratch. Same research, same trial and error, same token burn. You're paying for the same work twice.

## The Solution

SkillCam reads native session logs from Claude Code and Codex CLI, extracts the successful pattern, and writes it as a clean `SKILL.md` file. Next time the agent sees the same kind of task, it reads the skill and follows the steps instead of figuring it out again.

One command. No config. Works with any LLM or without one.

```bash
npx skillcam distill --latest
```

## Before and After

```
Before SkillCam:

  You: "Fix the auth tests"
  Agent: *figures it out from scratch* (15 min, 50k tokens)

  Next week:
  You: "Fix the auth tests again"
  Agent: *figures it out from scratch again* (15 min, 50k tokens)
```

```
After SkillCam:

  You: "Fix the auth tests"
  Agent: *figures it out* (15 min, 50k tokens)

  $ skillcam distill --latest
  > Wrote skill to ./skills/fix-auth-tests.md

  Next week:
  You: "Fix the auth tests again"
  Agent: *reads the skill, follows the steps* (3 min, 8k tokens)
```

## How It Works

```
  ~/.claude/projects/**/*.jsonl
  ~/.codex/sessions/**/*.jsonl
           │
           ▼
   ┌──────────────┐
   │  1. Discover  │  Scan session dirs, sort by recency
   └──────┬───────┘
          │  session JSONL
          ▼
   ┌──────────────┐
   │   2. Parse    │  Extract messages, tool calls, files, tokens
   └──────┬───────┘
          │  ParsedSession
          ▼
   ┌──────────────┐    ┌─────────────────────────────┐
   │  3. Distill   │───▶│  LLM mode (default)         │
   └──────┬───────┘    │  Sends conversation + tool   │
          │            │  calls to Claude / GPT with   │
          │            │  a distillation prompt         │
          │            ├─────────────────────────────┤
          │            │  Template mode (--no-llm)    │
          │            │  Structured extraction, no   │
          │            │  API key needed               │
          │            └─────────────────────────────┘
          ▼
   ┌──────────────┐
   │  4. Emit      │  Log event to events.jsonl
   └──────┬───────┘
          │
          ▼
      SKILL.md
```

| Stage | What it does | Key details |
|-------|-------------|-------------|
| **Discover** | Finds session logs on disk | Scans `~/.claude/projects/` and `~/.codex/sessions/` for `.jsonl` files, sorted by most recent first |
| **Parse** | Reads the raw JSONL into a structured format | Extracts user/assistant messages, tool calls with inputs/outputs, files modified, token usage, and project metadata. Each agent format has its own parser |
| **Distill** | Converts the parsed session into a reusable skill | **LLM mode** (default): sends the conversation and tool call summary to Claude or GPT with a distillation prompt. **Template mode** (`--no-llm`): extracts steps directly from tool calls without any API call. Falls back to template mode automatically if the LLM call fails |
| **Emit** | Records the distillation for observability | Appends a structured event to `agents/_core/events.jsonl` with session metadata, skill path, token costs, and distill mode |

## Installation

```bash
# Use directly (no install needed)
npx skillcam distill --latest

# Or install globally
npm install -g skillcam
```

## CLI Reference

### `skillcam list`

List available agent sessions.

```bash
skillcam list                        # Show 10 most recent sessions
skillcam list --agent claude-code    # Only Claude Code sessions
skillcam list --agent codex          # Only Codex CLI sessions
skillcam list --last 20              # Show 20 sessions
```

### `skillcam preview`

Preview what a session did without distilling.

```bash
skillcam preview --latest            # Preview most recent session
skillcam preview <session-id>        # Preview specific session
skillcam preview --latest --agent codex
```

### `skillcam distill`

Distill a session into a reusable SKILL.md.

```bash
skillcam distill --latest                              # Distill most recent session
skillcam distill <session-id>                          # Distill specific session
skillcam distill --latest --no-llm                     # Template mode (no API key needed)
skillcam distill --latest --provider anthropic          # Use Claude for distillation
skillcam distill --latest --provider openai --model gpt-4o  # Use GPT-4o
skillcam distill --latest --output ./my-skills/        # Custom output directory
```

## Supported Agents

| Agent | Status | Session Location |
|-------|--------|------------------|
| Claude Code | Supported | `~/.claude/projects/<project>/<session>.jsonl` |
| Codex CLI | Supported | `~/.codex/sessions/YYYY/MM/DD/<session>.jsonl` |
| Gemini CLI | Planned | -- |

## LLM Providers

| Mode | Command | API Key Required |
|------|---------|-----------------|
| Template | `--no-llm` | No |
| Anthropic | `--provider anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `--provider openai` | `OPENAI_API_KEY` |

Template mode works for structured extraction. LLM mode produces more natural, actionable skills. If the LLM call fails, SkillCam falls back to template mode automatically.

## Output Format

Skills are standard markdown with YAML frontmatter:

```markdown
---
name: fix-auth-tests
description: Debug and fix authentication test failures
source_session: 6f1d981e-bf14-445b-9786-a4e0ac09df32
source_agent: claude-code
created: 2026-04-12
tags:
  - testing
  - auth
---

# Fix Auth Tests

## When to use
When auth tests are failing after changes to the auth module.

## Steps
1. Read the failing test file to understand assertions
2. Check the auth module for recent changes
3. Fix the mock setup to match new auth flow
4. Run tests to verify

## Example
User: "The auth tests are broken again"
Agent: Reads test, finds mock mismatch, fixes setup, all tests pass.

## Key decisions
- Always update mocks when changing auth flow
- Check both unit and integration test suites
```

See [`examples/skills/`](examples/skills/) for real skills generated from actual sessions.

## Project Structure

```
skillcam/
├── src/
│   ├── cli.ts              # CLI entry point (commander)
│   ├── discovery.ts        # Session finder for Claude Code + Codex
│   ├── distiller.ts        # LLM and template distillation
│   ├── distiller-prompt.ts # Prompt for LLM distillation
│   ├── parsers/
│   │   ├── claude-code.ts  # Claude Code JSONL parser
│   │   ├── codex.ts        # Codex CLI JSONL parser
│   │   └── types.ts        # Shared parser types
│   └── events/
│       ├── emit.ts         # Event emitter (JSONL append)
│       └── types.ts        # Event schema types
├── examples/skills/        # Example generated skills
└── tests/                  # Vitest test suite
```

## Contributing

PRs welcome. Please open an issue first to discuss what you'd like to change.

Some areas where contributions would be useful:

- **New agent parsers** -- Gemini CLI, Cursor, Windsurf, or other agents that produce session logs
- **Better distillation prompts** -- improving the quality of LLM-generated skills
- **Skill validation** -- linting or scoring generated skills for completeness
- **CI integration** -- auto-distilling skills from successful CI runs

### Development

```bash
git clone https://github.com/martin-minghetti/skillcam.git
cd skillcam
npm install
npm run dev -- list          # Run from source
npm test                     # Run tests
npm run build                # Compile TypeScript
```

## Community

- [GitHub Issues](https://github.com/martin-minghetti/skillcam/issues) -- bugs, feature requests, questions
- [GitHub Discussions](https://github.com/martin-minghetti/skillcam/discussions) -- ideas, show & tell, general talk

## License

[MIT](LICENSE)
