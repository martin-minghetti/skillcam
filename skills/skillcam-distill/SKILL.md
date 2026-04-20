---
name: skillcam-distill
description: Use when a coding session just produced a reusable pattern and should be preserved for future reuse. Triggered by phrases like "save this as a skill", "distill this session", "skillcam this", "I want to remember how we solved this", or when the user wraps up a productive session and wants it captured. Reads the current session log from ~/.claude/projects, extracts the causal chain to success, and writes a SKILL.md that Claude Code will auto-discover on the next session.
---

# skillcam-distill

Native Claude Code port of the `skillcam` pipeline. The CLI needs an API key to make its own LLM calls; this skill runs inline on the active Claude session and skips the duplicate call entirely.

## When to use

Invoke when **all** of the following hold:

1. The current session reached a successful outcome (tests passed, deploy worked, bug fixed, feature built end-to-end, etc.).
2. At least one file was modified OR a concrete sequence of tool calls produced an artifact.
3. The pattern is **reusable** — next week, with a similar problem, another run would follow the same causal chain. Exploratory "learning" sessions without a concrete pattern should abort.
4. The user explicitly asked to preserve it, OR the session has the shape of a reusable pattern and preserving it is clearly in scope.

If any fails → **abort** with a brief reason. Do not write a half-formed skill.

## Judge (before doing anything)

Before writing a SKILL.md, silently ask yourself:

- **Q1 artifact**: Did a file get modified or a concrete artifact get produced? If no → abort `no_artifact`.
- **Q2 reusable pattern**: If the same task appeared in a different project next month, would the steps in this session apply with minor adjustments? If no (one-off debugging, personal vault work, chat-only sessions) → abort `no_reusable_pattern`.
- **Q3 scope**: Is the session focused on a single outcome, or is it a multi-goal marathon? Marathon sessions (100+ tool calls spanning unrelated tasks) rarely produce one clean skill. If marathon → abort `too_broad` and suggest the user narrow the request.

When aborting, write nothing and print: *"Skipping skillcam-distill: <reason>. <one-sentence explanation>."*

## Input discovery

1. Read the current project root from the Claude Code session context (it's already in your working directory).
2. Build the expected session log dir: `~/.claude/projects/<encoded-cwd>/` where `<encoded-cwd>` is the cwd with `/` replaced by `-` and leading `-` preserved. Example: `/Users/martinminghetti/Projects/foo` → `-Users-martinminghetti-Projects-foo`.
3. List `*.jsonl` files in that dir, sorted by mtime desc. Take the most recent one — that's the current session. The session file has the same `sessionId` as the current conversation.
4. Parse the JSONL. Each line is an entry with `type` (`user` / `assistant` / `tool_result`), `message`, `timestamp`, `toolUseId`.

Skip parsing if you can reconstruct the session from your in-conversation context (you have it in memory). Read the JSONL only to verify timestamps / confirm filesModified / grab specific tool_result content.

## Distillation schema

The output SKILL.md has:

### Frontmatter (required)

```yaml
---
name: <kebab-case-slug, ≤40 chars>
description: <trigger phrase for Claude to match on — see below>
---
```

**Description format — non-negotiable.** Must follow: *"Use when [context condition]. Triggered by [paraphrases the user might say] OR [signals in the task]. Handles [short specific scope]."*

Wrong: *"First-time production deploy of a Next.js app..."*  (narrative, no trigger)
Right: *"Use when promoting a Next.js + Supabase + Vercel + Trigger.dev app from local to production for the first time. Triggered by 'first deploy to prod', 'link supabase and deploy', or when the user lists a prod-deploy checklist. Handles supabase/config.toml version alignment and Trigger.dev build-time env failures."*

Max 400 chars. Specific > generic. Reference concrete stack names, error signatures, tool names.

### Body sections (in this order, all required)

1. **## When to use** — 1-3 sentences. Expand the trigger condition with nuance. Explicitly say when NOT to use it (typical edge case or anti-match).
2. **## Steps** — numbered list, ≤ 8 items. Each step is imperative, describes **what was accomplished**, not which tool was invoked. No "Use `Bash` on ..."; yes "Run the DB migrations with `supabase db push`".
3. **## Key decisions** — ≤ 5 bullets. The non-obvious choices and WHY, not WHAT. Failed alternatives count here.
4. **## Gotchas** — the specific traps (error messages, silent no-ops, version mismatches) an executor hits without this skill. Keep tight.
5. **## Example (optional)** — one concrete run as narrative. Project-agnostic but keeps names for memorability.

### Path anonymization (required)

- Absolute paths → relative to project root where possible: `/Users/martinminghetti/Projects/foo/src/a.ts` → `src/a.ts`.
- Project-specific identifiers (Supabase project refs, Vercel URLs, API tokens) → placeholders: `<PROJECT_REF>`, `<VERCEL_URL>`, `<API_TOKEN>`.
- `/Users/<user>/` or `/home/<user>/` never appear in output.
- Keep generic OS paths (`/tmp`, `~/.claude/`) since they are reference points, not leaks.

### Output location

Write to: `~/.claude/skills/<kebab-slug>/SKILL.md`

Create the parent dir if missing. Use the same slug as the `name` in frontmatter. That's the path Claude Code scans on next session start.

If a SKILL.md with that slug already exists, do a **dedup check**: compare descriptions. If similar (same stack + same error class), abort with `duplicate_skill: <existing path>` and suggest the user edit the existing one instead. If different, suffix the slug with `-2`, `-3`, etc.

## Closed tag taxonomy (optional, for future tooling)

Frontmatter may include `tags:` drawn only from this list (no free-form tags):

`deployment · migration · testing · debugging · refactoring · infrastructure · auth · database · frontend · backend · api · cli · tooling · build · ci · env-vars · security · performance`

## Anti-patterns

**Do NOT**:
- Paste raw tool-call transcripts ("Use `Bash` on `supabase db push`") into Steps. Steps describe outcomes.
- Describe more than one task. One session → one skill. If the session did two unrelated things, pick the primary one and skip the other (or abort `too_broad`).
- Copy the user's intent message verbatim as the description. The description is a trigger phrase for future matching, not a session summary.
- Leave failed attempts in the Steps list. They belong in Key Decisions as explicit "tried X, it failed because Y, so we did Z".
- Write SKILL.md to `./skills/` (cwd-relative). Claude Code does not scan that path.
