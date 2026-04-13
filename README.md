# SkillCam

> Turn successful AI agent runs into reusable markdown skills.

<!-- ![Demo](assets/demo.gif) -->

[![npm version](https://img.shields.io/npm/v/skillcam.svg)](https://www.npmjs.com/package/skillcam)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Quick Start

```bash
npx skillcam distill --latest
```

That's it. One command turns your last agent session into a reusable skill.

## What It Does

- **Reads** native session logs from Claude Code and Codex CLI
- **Distills** the successful pattern into a clean SKILL.md file
- **Works** with any LLM (Claude, GPT, or template-only mode)

## How It Works

```
Agent session (JSONL) → SkillCam → SKILL.md
```

Your AI coding agents solve problems every day. When they do something well, SkillCam captures the pattern so they can do it again. No more starting from zero.

### Before SkillCam

```
You: "Fix the auth tests"
Agent: *figures it out from scratch* (15 min, 50k tokens)

Next week:
You: "Fix the auth tests again"
Agent: *figures it out from scratch again* (15 min, 50k tokens)
```

### After SkillCam

```
You: "Fix the auth tests"
Agent: *figures it out* (15 min, 50k tokens)

$ skillcam distill --latest
✓ Wrote skill to ./skills/fix-auth-tests.md

Next week:
You: "Fix the auth tests again"
Agent: *reads the skill, follows the steps* (3 min, 8k tokens)
```

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

## Output Format

SkillCam generates standard SKILL.md files:

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

## Supported Agents

| Agent | Status | Session Location |
|-------|--------|------------------|
| Claude Code | Supported | `~/.claude/projects/<project>/<session>.jsonl` |
| Codex CLI | Supported | `~/.codex/sessions/YYYY/MM/DD/<session>.jsonl` |
| Gemini CLI | Planned | — |

## LLM Providers

SkillCam can use an LLM to generate higher-quality skills, or run in template-only mode:

| Mode | Command | API Key Required |
|------|---------|-----------------|
| Template | `--no-llm` | No |
| Anthropic | `--provider anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `--provider openai` | `OPENAI_API_KEY` |

Template mode works great for structured extraction. LLM mode produces more natural, actionable skills.

## Examples

See [`examples/skills/`](examples/skills/) for real skills generated from actual sessions.

## Contributing

PRs welcome. Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
