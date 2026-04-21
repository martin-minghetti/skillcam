---
name: architecture-comparison-test-design
description: Use when designing empirical tests to compare N architecture options in a research prototype. Triggered by "empirical comparison of architectures", "ADR prototype methodology", "prototype showing suspicious uniform results", or when N options produce identical result patterns across heterogeneous test scopes. Handles pair design validation, Codex adversarial passes, split-metric reporting, CRDT/replay semantics for DB options, and knowing when to demote a non-discriminating gap to ranking-only.
tags:
  - testing
  - debugging
  - refactoring
---

## When to use

Use when a research prototype compares N architectural options (file-based vs SQLite vs distributed vs lock-file, etc) with empirical tests meant to discriminate winners, and results look suspicious: identical patterns across different test scopes, showstoppers that apply equally to all options, or rankings that match the ADR's a priori definitions instead of revealing emergent behavior.

**Do NOT use** for: one-off comparison of two library choices (overkill), measurements where you control all variables and the test is trivially correct, or UX/user studies (this is for code-level empirical methodology).

## Steps

1. **Require external benchmark citation for every threshold** — each showstopper/acceptable/stretch level gets URL + literal quoted passage from source (paper, docs, prior benchmark). Thresholds invented or derived from the same test cohort are circular and invalid. Thresholds without (URL + quoted passage) → flag as ranking-only, not gating.

2. **Write a design doc before touching test code** — per-option storage model, pair/scenario definitions, row-key or locus policy (what counts as "same place" across options), conflict detection rules, expected outcome per pair per option. No hand-waving on "natural key" or "semantic equivalence."

3. **Pass design doc through Codex adversarial before implementing** — submit with explicit "Request for adversarial review" listing specific questions. Integrate findings as doc revisions (v2, v3). Repeat until verdict is "proceed with implementation." Schemas, protocols, and security decisions need at least 2 passes; complex ones need 3.

4. **Enforce representational symmetry across options** — if Option A measures body edits via filesystem line edit while Option B does it via hash-field overwrite in central manifest, that's a confound not architecture. Redesign pair semantics per option until each tests its own real storage. If impossible without refactoring all options, declare the gap asymmetric and demote.

5. **Split metric reporting by test category before running** — non-overlap / overlap / metadata (or whatever categories your pairs have) each get separate sub-rates with category-specific thresholds. This exposes script-determined vs data-determined signal pre-interpretation.

6. **Implement measurement engine in an isolated module with unit tests on hand-built fixtures** — hand-built minimal DB or filesystem mock, independent of main pipeline fixtures. Validate conflict detection + commutativity/canonical equality separately from the full rerun. Catch engine bugs before they contaminate full data.

7. **When all options show identical result patterns across multiple test scopes, treat as script-determined artifact** — not architecture signal. Investigate what pair mechanics dominate (serialization format, trailing delimiters, surrogate ID order, whole-record overwrites). Trace back to the pair construction, not the option behavior.

8. **Demote rather than force-fix when the fix still produces ties** — if remaining methodology work costs hours and the predicted outcome after fixes is "all options tied within margin," save the hours. Document the journey (v0 broken result, v1 fixed result, why still not discriminating), demote the metric to ranking-only in the sign-off criteria, and move on to other gaps.

## Key decisions

- **Logical-state over physical-state equality for commutativity checks**: surrogate IDs (auto-increment PKs) rotate with apply order, so ordered dump comparison fails disjoint-insert pairs spuriously. Compare canonical tuples excluding ID columns.
- **CRDT semantics for concurrent appends** (timestamp-based or user-id-keyed positions) model realistic multi-device sync. Explicit-position semantics model git-merge-style coordination, which mismatches append-only log intent. Pick semantics based on product use case, not test convenience.
- **Single heterogeneous test scope beats N identical scopes**: if 3 synthetic packs gave identical results, running all 3 adds zero info but meaningful translation-code cost. Limit rerun to the most heterogeneous scope, document the decision.
- **Tried auto-detecting targets to work across scopes, it re-introduced bias** (concentrating edits on first-sorted agent). Fixed names + single-scope is cleaner.
- **Three Codex passes felt like overkill on pass 1 but each caught a real P0**: blocker rate didn't drop until pass 3 returned only clarifications. Trust the ritual.

## Gotchas

- **SQLite surrogate IDs** break ordered-dump equality for commutative disjoint INSERTs. The IDs are assigned in insertion order; applying u1→u2 vs u2→u1 produces same logical state but different physical IDs. Must exclude `id` from canonical comparison.
- **Threshold in the plan text ≠ firmed threshold**: if the Day 0 benchmark file says 70% but the plan table says 40%, neither is automatically right. Check which has URL + quoted passage; amend the other to match, and log it as a sync, not a goal-post move.
- **Schema additions require regenerating existing fixtures**. A new UNIQUE constraint or new table won't exist in `outputs/**/state.db` files generated before the schema change. Add a regen step explicitly; "whatever produces the fixture" is not enough.
- **"Distinct targets" ≠ representationally distinct**: 10 named agents in a pair set still collapse onto 1 central JSON manifest physically for file+lock options. Logical distribution doesn't propagate to physical distribution across all architectures.
- **JSON array append always conflicts on git merge** because both users edit the trailing `]` line. Not architecture, it's serialization. If the gap-6 equivalent touches this pattern, the result is about JSON not about architecture. Flag before interpreting.
- **Your "self-adversarial finding" can still be wrong**: the first adversarial pass I flagged in sesión 11 ("threshold bug") was backwards — the script was right, the plan was the typo. Verify Day 0 citation files before changing code.

## Example

Cortex manifest prototype (sesión 11, 2026-04-20). Gap 6 (merge conflict auto-resolve) showed identical 30/20/10/30 across real + 3 synthetic packs in v0 Day 3 run. Hypothesis Day 2: test artifact. Day 3 synthetic re-run confirmed pattern stays → hypothesis wrong, structural finding suspected.

Sesión 11: designed 10 new distributed pairs (2 of 10 targets concentrated previously → 10 of 10 distinct targets), Codex adversarial 3×, logical transaction log replay engine for Op.3 (not dump+merge), pack_fork_chain table for CRDT-style pair 10 append, split-metric reporting non-overlap / overlap / metadata.

Rerun: Op.1 5/10, Op.2 5/10, Op.3 6/10, Op.4 5/10. Op.3's extra point came entirely from CRDT pair 10 — trivially replicable in other options with JSONL serialization (would be Step 4 work, ~2h). Predicted post-fix outcome: all four tied at 60%.

Decision: Gap 6 demoted to ranking-only. Saved ~4h of remaining JSON-confound + Op.2 body-semantics work, moved to Gap 3 / 7 / 8 which have genuine discriminator potential. Final report documented journey so future sessions don't retry the same dead end.
