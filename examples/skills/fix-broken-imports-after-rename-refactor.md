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
- Use an import alias (`import { verifyToken as validateToken }`) to minimize test churn when the old name is used throughout the test
- Always re-run the full suite after a targeted fix to rule out regressions
- ReferenceError on an imported symbol almost always means a rename or deletion in source, not a logic bug

## Why this worked
Reading both the test and the source before editing revealed the rename as the sole root cause, avoiding unnecessary source changes
