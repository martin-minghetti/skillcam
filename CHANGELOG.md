# Changelog

All notable changes to this project will be documented in this file.

## 0.4.1 — 2026-04-20

> **Quality release.** Adds the third item from the post-v0.3.2 critique: a pre-write similarity check so two productive sessions on the same problem stop producing two near-identical skills under different names. No public API changes; drop-in upgrade.

### New

- **Pre-write dedup**. Before any write, the new skill's `description` is compared (Jaro-Winkler, case-insensitive, prefix-boosted) against every existing `.md` in `--output` (flat scan, no recurse). If any match is at or above the threshold (default `0.80`), `distill` exits `9` and prints up to three paths with their similarity %, suggesting `--no-dedup` or a different `--output`.
- **Two new flags on `distill`**:
  - `--no-dedup` — skip the check entirely
  - `--dedup-threshold <n>` — override the default `0.80` (0..1)
- **New exit code `9`** for the dedup hit.

### Why Jaro-Winkler

Better than Levenshtein for short strings (skill descriptions are 1-2 lines), boosts matches that share a common prefix (the typical near-duplicate shape: "Fix failing tests by ..." vs "Fix failing tests because ..."), and O(n*m) with no external dependency.

### Tests

- 10 new tests covering Jaro-Winkler properties (identity, empty input, typo-level edits, unrelated strings, symmetry) and `findSimilarSkills` edge cases (missing dir, no frontmatter, empty description, subdirectory isolation).
- Full suite: 193 / 193 passing (was 183).

### Known issues

- The dedup check is description-only. Two skills with very different descriptions but near-identical `steps` will not collide. Step-level dedup is on the v0.5 list once we have user signal that description-level isn't enough.
- Threshold tuning is heuristic. `0.80` was chosen from a handful of synthetic comparisons; expect to revise once we see real-world false positive / false negative ratios. Open an issue with the two descriptions if dedup misfires for you.

## 0.4.0 — 2026-04-20

> **Quality release.** Closes the two largest "how do I trust this?" gaps that came up after v0.3.2: how good is the judge, and how do you know? No public API changes; drop-in upgrade.

### Quality features

- **Judge × local-signals cross-check.** The judge verdict is now post-processed against deterministic signals from the parsed session before being returned. Two rules:
  - **Hard override** — if the judge says distillable but the session has zero `filesModified` AND zero `totalToolCalls`, the verdict flips to abort. Closes the residual of audit #3 J2 (a jailbroken model that lies about distillable still gets caught when the session has no artifact to back it up).
  - **Soft flag** — if the judge says no but the session has both files modified AND >5 tool calls, keep the abort but tag the reason so the disagreement is visible. Judge stays the oracle of "no" — false negatives are recoverable via `--force-distill`, false positives waste Sonnet tokens.
- **Publishable judge accuracy metrics.** New `npm run eval:judge` runs the cheap-gate Haiku call against the 5 hand-curated fixtures, compares with each fixture's expected outcome, and reports a confusion matrix + accuracy / precision / recall / F1 (total cost: ~$0.001). Output: `eval/out/judge-results.md` (paste-ready markdown) and `eval/out/judge-results.json` (machine-parseable). Exit `1` if accuracy < 100% so CI can gate on it.
- **README "How well does the judge filter?" subsection** with last-run numbers (5/5, 100% accuracy on `claude-haiku-4-5`) and an explicit caveat that 5 fixtures is regression coverage, not statistical significance. Issue template invites users to grow the eval set with real sessions where the judge made the wrong call.

### Tests

- 6 new tests (5 cross-check rules + 1 OpenAI parse-from-tool_call sanity that was missing from v0.3.2 J2 coverage).
- Full suite: 183 / 183 passing (was 177).

### Internal

- `judgeSession` is now a thin wrapper around the new private `runJudgeLlm` plus `applyLocalSignals`. Same external signature, easier to extend with more deterministic checks later.

## 0.3.2 — 2026-04-20

> **Security release.** Closes the four findings audit #3 deferred from v0.3.1 (`A1`, `D2`, `D3`, `J2`). No public API changes; drop-in upgrade.

### Security fixes

- **J2 (medium)** — The judge now uses strict tool-calling instead of asking the model to emit raw JSON in a text response. Both providers (`@anthropic-ai/sdk` `tools` + `tool_choice: { type: "tool", name: "report_judgment" }`, OpenAI `tools` + `tool_choice: { type: "function", ... }`) are forced to invoke a single typed tool with a JSON Schema (`distillable: boolean`, `reason: string`, `confidence: enum`). Closes the family of bypasses that worked by injecting raw output bytes (malformed JSON, text-only replies, control-char smuggling). Does **not** prevent a jailbroken model from using the tool *correctly* but lying about `distillable` — that defense (cross-checking with local signals) is deferred to a future release.
- **A1 (low)** — `anonymizePath` now resolves relative paths against `projectRoot` and collapses anything that escapes the project to `basename`. Previously a tool call carrying `../../client-prod/.env` or similar passed through verbatim, leaking out-of-project directory structure into the prompt.
- **D2 (low)** — `--force-distill` now also bypasses the distiller's own abort, falling back to template mode if the LLM emits `{"abort": ...}`. Previously the flag only skipped the cheap-gate judge and the run still died with exit `8` if the main distill aborted, contradicting the flag's documented promise.
- **D3 (low)** — `scripts/demo-shim.sh` now exports `_skillcam_demo_cleanup`, callable to drop the `skillcam` mock function and helper variables. Useful when the shim is sourced by accident in an interactive shell.

### Tests

- 9 new tests, written test-first against the four findings (4 for J2, 4 for A1, 1 for D2, plus a smoke test for D3).
- Full suite: 177 / 177 passing (was 169).
- First SDK mocks land in the suite (`@anthropic-ai/sdk` and `openai`) — if you run the suite in a CI without those packages installed, this is a behavior change worth noting.

### Known issues

- Judge bypass via session-content prompt injection that targets the *value* of `distillable` (rather than the output channel) is still possible. See J2 above. Cost is bounded to one Sonnet call per bypass.

## 0.3.1 — 2026-04-20

> **Security release.** Closes the four actionable findings from security audit #3 of the v0.3.0 distiller rewrite. No API changes; drop-in upgrade.

### Security fixes

- **S1 (critical)** — The judge prompt now passes through `scanAndRedact` before any network call and respects the user's `secretPolicy` (`abort` | `redact` | `allow`). In v0.3.0 the cheap-gate Haiku call exfiltrated raw user/assistant content to Anthropic regardless of policy, bypassing the secret-hygiene guarantee that the distiller call already enforced.
- **J1 (critical)** — The judge JSON parser is now unified with `skill-render` (string-aware), uses a strict `obj.distillable === true` check, and fails CLOSED on parse error. In v0.3.0 a literal `}` inside the `reason` field broke parsing and triggered a fail-open default of `distillable: true`; additionally `Boolean(obj.distillable)` coerced `"false"`, `"0"`, `"no"` to `true`.
- **R1 (high)** — `NotDistillableError` and `DistillationAbortedError` now sanitize the LLM-controlled `reason` inside their constructors (not just at the CLI print site). A jailbroken model could otherwise embed ANSI escapes that cleared the screen and spoofed a fake success line when the error was rendered.
- **D1 (medium)** — `parseDistillPayload` now rejects unknown abort kinds with a strict allow-list (`no_artifact` | `no_reusable_pattern`) instead of silently coercing arbitrary strings to `no_reusable_pattern`. This was the load-bearing rung that let R1 fire from any payload.

`SecretsDetectedError` was moved from `distiller.ts` to `secret-scan.ts` (re-exported from `distiller.ts` for backwards compatibility) so that `distiller-judge.ts` can throw it without an import cycle.

### Tests

- 15 new tests, written test-first against the four findings (5 for J1 including the type-coercion bypass, 4 for R1, 2 for S1, 1 for D1, plus 3 covering the second canonical abort kind and edge cases).
- Full suite: 169 / 169 passing (was 154).

### Known issues (not blockers, deferred to a future release)

- `anonymizePath` does not anonymize relative paths (`../../foo/.env` passes through).
- The judge prompt is bypassable via prompt injection in session content; the cost is bounded (one Sonnet call per bypassed gate).
- `--force-distill` skips the judge but the distiller can still emit `{"abort": ...}`; the help text is misleading.
- The demo shim does not unset its function or variables when sourced.

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
