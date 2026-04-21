<p align="center">
  <img src="assets/demo.gif" alt="SkillCam demo" width="700">
</p>

<h1 align="center">SkillCam</h1>

<p align="center">
  Turn successful AI agent runs into reusable markdown skills.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skillcam"><img src="https://img.shields.io/npm/v/skillcam.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/skillcam"><img src="https://img.shields.io/npm/dm/skillcam.svg" alt="npm downloads"></a>
  <a href="https://www.npmjs.com/package/skillcam"><img src="https://img.shields.io/badge/sigstore-provenance-9d4edd?logo=sigstore&logoColor=white" alt="Sigstore provenance"></a>
</p>

---

## Two paths — pick yours

**If you use Claude Code**, install SkillCam as a native skill — no API key needed:

```bash
$ npm install -g skillcam
$ skillcam init
✓ Installed skillcam-distill skill to ~/.claude/skills/skillcam-distill/SKILL.md
```

Next Claude Code session, at the end of any productive work, say **"skillcam this session"**. Claude runs the distillation inline, using its own reasoning — no separate LLM call, no API key. The generated SKILL.md lands at `~/.claude/skills/<slug>/`, where Claude Code auto-discovers it on the next session.

**If you use Codex CLI, batch processing, or CI** (or want the classic CLI flow), use `skillcam distill` with an API key:

```bash
$ export ANTHROPIC_API_KEY=sk-...
$ skillcam distill --latest
✓ Read session a1b2c3d4... (claude-code)
✓ Found 12 messages, 47 tool calls
✓ Quality judge (high): produced concrete artifact, pattern is reusable
✓ Distilling with anthropic...
✓ Wrote skill to ./skills/fix-broken-imports-after-rename-refactor.md
```

The rest of this README describes the CLI path in detail. The native Claude Code skill (`skillcam init`) follows the same pipeline conceptually but runs inside the agent session — see [`skills/skillcam-distill/SKILL.md`](skills/skillcam-distill/SKILL.md) for the full prompt contract, and [`examples/`](examples/) for sample outputs.

Same task next week, with vs. without the skill the agent now has on disk:

|              | Without SkillCam       | With SkillCam              |
|--------------|------------------------|----------------------------|
| Time         | ~15 min                | ~3 min                     |
| Input tokens | ~50k                   | ~8k                        |
| What happens | Agent figures it out from scratch | Agent reads the skill, runs the steps |

Numbers above are illustrative on a typical "fix the auth tests"-style task. Your mileage varies by session length and model.

## Why

Your AI coding agent solves something today. Tomorrow the same problem comes back and the agent starts from zero — same files read, same tools tried, same tokens spent. The session log already on disk in `~/.claude/projects/` or `~/.codex/sessions/` has the answer. SkillCam pulls it out into a `SKILL.md` your agent reads next time.

One command, no daemon. Works without an LLM (template stub) or with one (real distill). Has a small set of opt-in/opt-out env vars and writes one event line per successful distill — see [Side effects](#side-effects-on-disk) below.

```bash
npx skillcam distill --latest
```

## Requirements

- Node.js `>= 20.0.0` (uses `fetch`, `AbortSignal.timeout`, top-level `await`).
- **Claude Code path (`skillcam init`)**: no API key. Distillation runs inside your active Claude session.
- **CLI path (`skillcam distill`)**: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for the real distill. `--no-llm` produces a template stub; in v0.5.0 the template mode is kept for offline inspection but the recommended offline path is now `skillcam init` on any Claude Code machine.

## How It Works

SkillCam reads an agent session from disk, extracts what worked, and writes a `SKILL.md` your agent can reuse next time.

### The loop it creates

<p align="center">
  <img src="https://raw.githubusercontent.com/martin-minghetti/skillcam/main/docs/img/loop.svg" alt="The loop: agent solves → session.jsonl → skillcam distill → SKILL.md → agent reuses" width="900">
</p>

One session becomes one skill. One skill turns the next run from a fresh discovery into a quick execution.

### The pipeline

<p align="center">
  <img src="https://raw.githubusercontent.com/martin-minghetti/skillcam/main/docs/img/pipeline.svg" alt="Pipeline: discover → parse → distill (LLM or template) → emit → SKILL.md" width="600">
</p>

### Two-step quality pipeline (v0.3.0)

1. **Quality judge** — a cheap Haiku call decides whether the session even contains a reusable pattern. Exploratory sessions, abandoned attempts, and tasks that produced no artifact short-circuit here with exit code `7`, before any Sonnet tokens are spent. Override with `--force-distill`.
2. **Distill** — if the judge says yes, a Sonnet call emits a strict JSON payload (name, steps, decisions, `confidence`, `why_this_worked`, etc.). TypeScript validates the schema and renders the canonical `SKILL.md`. Frontmatter is never controlled by the LLM.

### Two distill modes

| Mode | When to use | What happens |
|------|-------------|--------------|
| **LLM mode** (default) | You want a real skill — polished, specific, actionable | Runs the two-step pipeline above. Produces clean "when to use", concrete steps without tool-call literals, path-anonymized, with `confidence` + `why_this_worked` signals. See [`demo/RESULTS.md`](demo/RESULTS.md) for side-by-side output against v0.2.x. |
| **Template mode** (`--no-llm`) | No API key / no network / privacy-only debug | Writes a minimal stub that captures session metadata (files modified, tools used, first user message) and tells you to re-run with `--llm` for a real skill. Not a substitute for the real distillation. |

### What each stage does

- **Discover** — scans `~/.claude/projects/` and `~/.codex/sessions/` for `.jsonl` files. Each agent format has its own parser. Sessions are sorted by most recent first.
- **Parse** — reads the raw JSONL into a typed shape: user/assistant messages, tool calls with inputs/outputs, files modified, token usage, project metadata.
- **Judge** — (LLM mode only) Haiku call on session metadata decides `distillable: yes/no`. Forces the model to invoke a typed tool (`report_judgment`) so the verdict can't be smuggled through raw text. The verdict is then cross-checked against deterministic local signals (`filesModified`, `totalToolCalls`); a `distillable: true` verdict on a session with zero artifacts is overridden to abort. **This is one of two provider network calls in LLM mode.**
- **Distill** — (LLM mode) Sonnet emits strict JSON; template mode writes a stub. **This is the second provider network call in LLM mode.** Together with the judge, a single `skillcam distill` in LLM mode performs **two** LLM round-trips before writing.
- **Render** — JSON → SKILL.md in TypeScript. Schema-validated, frontmatter under our control, tags restricted to a closed taxonomy.
- **Dedup** — before write, the new skill's `description` is compared (Jaro-Winkler) against every existing skill in `--output`. If any match exceeds the threshold (default `0.80`), exit `9` and surface the matches. Bypass with `--no-dedup`; tune with `--dedup-threshold 0.85`. Catches the common shape where two productive sessions on the same problem produce two near-identical skills under different names.
- **Emit** — appends one JSONL line per successful distill to `./agents/_core/events.jsonl` (relative to the cwd) with session metadata, skill path, token costs, judge verdict, and distill mode. **Today this is just a structured log on disk** — there is no other tool consuming it yet. The schema (`schema_version: 0.1`) is published so future tooling can read it, but for now treat it as an audit trail of what `skillcam distill` did. Opt out with `SKILLCAM_NO_EVENTS=1`.

### How well does the judge filter?

The judge is one cheap LLM call. To make its quality measurable instead of asserted, the repo ships an eval harness with hand-curated synthetic sessions and a runner that scores the judge against them.

| | |
|--|--|
| Last run | `2026-04-20` (against `claude-haiku-4-5`) |
| Fixtures | 5 (4 distillable, 1 not) |
| Accuracy | 100% (5/5) |
| Precision | 100% — when the judge says distillable, how often is it right |
| Recall | 100% — of the distillable sessions, how many it catches |

Reproduce: `ANTHROPIC_API_KEY=… npm run eval:judge` (cost ≈ $0.001). Full report at `eval/out/judge-results.md` after the run.

**Caveat** — five hand-curated synthetic fixtures is enough to catch obvious regressions, not statistical evidence that the judge generalizes. The 100% number above is honest about what it measured and dishonest about what it implies. If you have an agent session where the judge made the wrong call (either direction), please open an issue with the redacted JSONL — every real-world example sharpens the eval set.

## Side effects on disk

`skillcam distill` is not pure — it writes more than the SKILL.md. Honest list of everything it touches:

| What | Where | When | How to opt out |
|------|-------|------|----------------|
| The skill itself | `--output/<name>.md` (default `./skills/`) | every successful distill | n/a (the point of the tool) |
| Event log line | `./agents/_core/events.jsonl` (cwd-relative) | every successful distill | `SKILLCAM_NO_EVENTS=1` |
| Update-check cache | `~/.skillcam/update-check.json` | once per 24h on TTY runs that aren't `npx` / CI / `NODE_ENV=test` | `SKILLCAM_SKIP_UPDATE_CHECK=1` (or `NO_UPDATE_NOTIFIER=1`) |
| Update-check network call | `https://registry.npmjs.org/skillcam/latest` | when the cache is stale | same as above |

**Reads** (no writes): session JSONLs in `~/.claude/projects/` and `~/.codex/sessions/`, plus existing `.md` files in `--output` for the dedup check.

## Security

Agent sessions can carry secrets (API keys, tokens, file contents) and can be hostile if anything else writes to `~/.claude/projects` or `~/.codex/sessions`. SkillCam treats every session as untrusted input.

- **In-prompt** — secret scanner (14 patterns, normalized against NFKC / zero-width / URL-encode / Unicode escape / homoglyphs / combining marks / recursive base64), output sanitizer that strips prompt-injection payloads from `SKILL.md` before write, terminal-injection guards on every session-derived field including error paths.
- **On disk** — trust-root confinement on read, symlink rejection, atomic writes with `O_EXCL`, path-traversal guards on the LLM-controlled filename, 50 MB session cap + 100 KB skill cap.
- **Supply chain** — published from CI via npm Trusted Publishing (OIDC) with Sigstore provenance, no long-lived tokens.

Four adversarial audits are recorded in the project notes (audits #1-#3 on the v0.2.x and v0.3.0 surfaces, audit #4 retroactive on v0.4.0/v0.4.1). Across the four audits, ~30 findings were filed and fixed; the most recent (v0.4.2) closed three blockers — including one that was a regression of an earlier fix — that shipped because v0.4.0 and v0.4.1 went out without an audit of their own. **Honest read**: the threat model is taken seriously and the audit cadence is real, but the project is recent and most of the security validation has happened in this repo, not in real adversarial use. Threat model + reporting path in [`SECURITY.md`](SECURITY.md).

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
skillcam distill --latest                              # Distill most recent session (LLM mode, default)
skillcam distill <session-id>                          # Distill specific session
skillcam distill --latest --agent codex                # Disambiguate when a prefix matches sessions across both agents
skillcam distill --latest --provider openai --model gpt-4o  # Use GPT-4o for the main call
skillcam distill --latest --judge-model claude-haiku-4-5-20251001   # Override judge model
skillcam distill --latest --force-distill              # Skip the quality judge and distill anyway
skillcam distill --latest --output ./my-skills/        # Custom output directory
skillcam distill --latest --force                      # Overwrite the output file if it already exists (default: refuse)
skillcam distill --latest --redact                     # Redact detected secrets before sending
skillcam distill --latest --allow-secrets              # Send as-is even if secrets are detected
skillcam distill --latest --no-llm                     # Template stub only (no API key, no real distill)
skillcam distill --latest --no-dedup                   # Skip the similarity check against existing skills in --output
skillcam distill --latest --dedup-threshold 0.85       # Tighten the dedup check (default 0.80)
```

**Exit codes** (v0.4.3)

| Code | Meaning |
|------|---------|
| `0` | Success — skill written to disk |
| `1` | Session not found (run `skillcam list` to see available sessions) |
| `2` | Secrets detected and policy is `abort` (use `--redact` or `--allow-secrets`), OR `--dedup-threshold` value is invalid (not a number in `[0, 1]`) |
| `7` | Quality judge refused — session not distillable (use `--force-distill` to override) |
| `8` | LLM emitted an `abort` payload after the judge passed (session content broke the anti-literal rule) |
| `9` | A similar skill already exists in `--output` (use `--no-dedup` to write anyway) |

By default, `distill` scans the prompt for common secret patterns (API keys, tokens, private keys) and aborts if any are found. See [`SECURITY.md`](SECURITY.md).

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

Template mode writes a stub only — it is not a substitute for the real distillation. Use LLM mode for anything you want an agent to reuse. If the LLM call fails, SkillCam falls back to the template stub so the command never crashes.

## Output Format

Skills are standard markdown with YAML frontmatter. This example is the actual output v0.3.0 produced from a session where an agent fixed failing auth tests (the full run is in [`demo/RESULTS.md`](demo/RESULTS.md)):

```markdown
---
name: fix-broken-imports-after-rename-refactor
description: Fix failing tests caused by stale import names after a function was renamed during refactoring.
source_session: fix-bug-0001
source_agent: claude-code
created: 2026-04-20
distill_prompt_version: v2.2026-04-19
confidence: high
tags:
  - testing
  - debugging
  - refactor
  - auth
---

# Fix Broken Imports After Rename Refactor

## When to use
When tests fail with ReferenceError or 'not exported' errors after a refactor. Use when the error points to a symbol that no longer exists in the source but tests still reference the old name.

## Steps
1. Run the full test suite to capture the exact error messages and failing test files
2. Read the failing test file to identify which imported symbol is missing
3. Read the corresponding source file to find the current exported name
4. Fix the import in the test using an alias (e.g., `import { newName as oldName }`) to preserve test readability without touching source
5. Re-run only the failing test suite to confirm the fix
6. Run the full test suite to catch any regressions

## Example
User ran `npm test` after auth refactor; 3 tests failed with ReferenceError on `validateToken`. Agent read the test, then the source, and found the function was renamed to `verifyToken`. Fixed the import alias in the test file. Full suite passed.

## Key decisions
- Fix the test import, not the source — the rename was intentional and the test was stale
- Use an import alias (`import { verifyToken as validateToken }`) to minimize test churn
- Always re-run the full suite after a targeted fix to rule out regressions
- ReferenceError on an imported symbol almost always means a rename or deletion in source, not a logic bug

## Why this worked
Reading both the test and the source before editing revealed the rename as the sole root cause, avoiding unnecessary source changes
```

Frontmatter fields:

| Field | Meaning |
|-------|---------|
| `name` | Kebab-case descriptive name, sanitized in TS (not LLM-controlled). Max 64 chars. |
| `description` | One-sentence summary of what the skill does. |
| `source_session` | Session ID this skill was distilled from. |
| `source_agent` | `claude-code` or `codex`. |
| `created` | ISO date (YYYY-MM-DD). |
| `distill_prompt_version` | Version tag of the prompt used. Lets you re-distill when the prompt evolves. |
| `confidence` | `high` / `medium` / `low` — the LLM's own rating of output quality. Useful for filtering and reuse-scoring. |
| `tags` | 2–4 tags from a closed taxonomy (`testing`, `debugging`, `api`, `database`, `security`, `auth`, `performance`, `deployment`, `refactor`, `typescript`, `react`, `next-js`, `supabase`, `build`, `tooling`, `ci`, `migrations`, `observability`). |

See [`examples/skills/`](examples/skills/) for curated reference skills and [`demo/RESULTS.md`](demo/RESULTS.md) for a side-by-side comparison of v0.2.x vs v0.3.0 output across five fixtures.

## Works with Obsidian

SkillCam is CLI-first and markdown-native — **Obsidian is not required**, but the output is designed to work well inside a vault.

- **YAML frontmatter** is Obsidian-compatible: `name`, `description`, `tags`, `created` render in the Properties panel with no config.
- **Skill files are plain markdown**. Drop them anywhere in your vault, link to them with wikilinks (`[[fix-auth-tests]]`), or pull them into a Dataview / Bases query by tag.
- **No plugin to install**. The CLI writes markdown, Obsidian reads markdown. Same files work for agents, for humans, and for CI.

Typical workflow:

```bash
# Distill the session straight into your vault
skillcam distill --latest --output ~/Vault/skills/
```

Add `skills/` to a folder note or to a Base view and your agent skills become searchable alongside your research and daily notes.

If you're an agent-tooling power user or vault-curator, please open an issue with workflows you'd want — a `--vault` flag that reads `$OBSIDIAN_VAULT` is on the roadmap.

## Project Structure

The code is grouped by role. Each layer has one job.

### Data flow

<p align="center">
  <img src="https://raw.githubusercontent.com/martin-minghetti/skillcam/main/docs/img/data-flow.svg" alt="Data flow: CLI → Discovery → Parsers → Distiller → SKILL.md + Events log" width="900">
</p>

### Files by layer

| Layer | File | Purpose |
|-------|------|---------|
| **CLI** | `src/cli.ts` | Commander entry — `list`, `preview`, `distill` |
| **Discovery** | `src/discovery.ts` | Finds session logs in `~/.claude/projects/` and `~/.codex/sessions/` |
| **Parsers** | `src/parsers/claude-code.ts` | Parses Claude Code JSONL format |
|  | `src/parsers/codex.ts` | Parses Codex CLI JSONL format |
|  | `src/parsers/types.ts` | `ParsedSession` shared shape |
| **Distiller** | `src/distiller.ts` | Orchestrates LLM vs template mode |
|  | `src/distiller-prompt.ts` | Builds the LLM prompt (with billing cap) |
| **Safety** | `src/secret-scan.ts` | Scanner — 14 patterns + bypass-class normalization |
|  | `src/skill-schema.ts` | Output sanitizer — strips prompt-injection payloads from SKILL.md |
|  | `src/path-safety.ts` | Filename sanitization + path-traversal guard |
|  | `src/terminal-safety.ts` | Strips control chars from session fields before console output |
|  | `src/limits.ts` | DoS / cost caps (session size, prompt messages, skill output) |
| **Events** | `src/events/emit.ts` | Appends structured events to `events.jsonl` |
|  | `src/events/types.ts` | `AgentEvent` schema |
| **Update check** | `src/update-check.ts` | Once-per-day npm registry check, atomic + sandboxed |
| **Examples** | `examples/skills/` | Real skills generated from sessions |
| **Tests** | `tests/` | Vitest suite (169 tests across 17 files) |

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
