# Changelog

All notable changes to this project will be documented in this file.

## 0.3.0 — 2026-04-19

> **Release history note.** A fast-path release published as `skillcam@0.2.6` during the v0.3.0 preparation — the auto-release hook beat the package.json bump. Same code as v0.3.0. The `0.2.6` tag was not created; `v0.3.0` is the canonical release.


### Distiller quality rewrite

This release is a ground-up rewrite of the distillation pipeline, driven by an adversarial review of v0.2.5 outputs. None of the security hardening from 0.2.0–0.2.5 is regressed; the changes are all in the prompt and the pipeline around it.

#### Two-step architecture

- New `src/distiller-judge.ts` adds a cheap Haiku-based **quality gate** that runs before the main Sonnet call. It decides whether the session contains a reusable pattern at all. Exploratory sessions, abandoned attempts, and sessions with no artifact now abort before burning Sonnet tokens.
- Exits code `7` (`NotDistillableError`) and `8` (`DistillationAbortedError`) added for CLI users.
- New flag: `--force-distill` to skip the judge.
- New flag: `--judge-model <model>` to override the judge model.

#### Prompt v2 (`DISTILL_PROMPT_VERSION = v2.2026-04-19`)

- **JSON output schema** enforced. The LLM emits a strict JSON payload; TypeScript renders it to the canonical SKILL.md shape. Frontmatter is no longer controllable by the LLM (`src/skill-render.ts`).
- **Prompt reordered:** intent → conversation → actions → outcome (was tool calls first).
- **Semantic tool-call summaries** via `src/tool-summary.ts`. Replaces `JSON.stringify(tc.input).slice(0, 100)` — which truncated mid-string and leaked `/Users/<you>/` paths — with per-tool-type extraction (`Read → file_path`, `Grep → pattern`, `Edit → rel-path + before/after`, etc.).
- **Path anonymization.** All file paths passing through the prompt are project-relative, or `~/…` for home-scoped, or basename for everything else. Zero absolute `/Users/` or `/home/` leaks in the prompt body (verified by `scripts/demo.ts`).
- **Hard anti-literal rule** with BAD/GOOD examples: steps must describe WHAT was accomplished, not WHICH tool was invoked.
- **Causal-chain rule**: only include steps that led to the successful outcome. Dead ends discarded.
- **Abort protocol**: emit `{"abort": "no_artifact" | "no_reusable_pattern", "reason": "..."}` instead of a skill when the session did not produce one.
- **Closed tag taxonomy** (18 tags): no more `testing` vs `tests` vs `qa` fragmentation.
- **Per-section caps**: `steps ≤ 8`, `key_decisions ≤ 5`, `description ≤ 140 chars`, `when_to_use ≤ 3 sentences`. Replaces the v0.2.5 "keep it under 100 lines" global cap that LLMs ignore.
- **Two canonical few-shot examples** (one distillable, one abort). Large improvement to output consistency.

#### New frontmatter fields

- `confidence: high | medium | low` — the LLM's self-rating of skill quality.
- `why_this_worked: "..."` — the one key insight the skill captures.
- `distill_prompt_version: v2.2026-04-19` — enables safe re-distillation when the prompt evolves.

#### Templated (offline) mode

- `--no-llm` now produces a **minimal honest stub** instead of a tool-call transcript. The stub self-declares as `template-stub` in tags, sets `confidence: low`, and tells the user to re-run with `--llm` for a real skill. No more vault-hash names or literal tool-call dumps shipped as "skills".

#### Eval harness + demo

- New `eval/` directory with 5 curated fixtures (2 productive, 1 exploratory/abort, 1 with dead ends, 1 mixed) and a runner that checks output against expected `mustContain` / `mustNotContain` lists.
- New `scripts/demo.ts` generates a side-by-side `demo/RESULTS.md` comparing v0.2.5 and v0.2.6 prompts across the fixtures. Dry-run, no API calls.

#### Test suite

- 31 new unit tests: `tests/tool-summary.test.ts`, `tests/skill-render.test.ts`, `tests/distiller-judge.test.ts`.
- Full suite: **154 passing (up from 122 in v0.2.5).**

### Migration notes

- The distiller output shape is backwards-compatible at the SKILL.md level (same section headings). The frontmatter has three new optional fields; parsers that allowlist frontmatter keys will need to add them (skillcam's own schema sanitizer already does).
- Existing skills produced by v0.2.5 are not affected. To re-distill under the new prompt, run `skillcam distill --force --latest` against the same session.
- `--force-distill` is only needed if the quality judge refuses your session and you disagree.

---

## 0.2.5 — 2026-04-18

Homoglyph-aware secret scanner, recursive base64 scanner, skill output sanitizer (PI1), Sigstore provenance on npm. See [v0.2.5 release](https://github.com/martin-minghetti/skillcam/releases/tag/v0.2.5).

## 0.2.4 — 2026-04-18

Update-check hardening (symlink writeFile + terminal injection guards), billing cap, preview output sanitization. See [v0.2.4 release](https://github.com/martin-minghetti/skillcam/releases/tag/v0.2.4).

## 0.2.3 and earlier

See GitHub Releases.
