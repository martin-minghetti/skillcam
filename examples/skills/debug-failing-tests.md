---
name: debug-failing-tests
description: Systematically debug and fix failing test suites by reading errors, tracing root causes, and verifying fixes
source_session: a1b2c3d4-e5f6-7890-abcd-ef1234567890
source_agent: claude-code
created: 2026-04-10
tags:
  - testing
  - debugging
  - tdd
---

# Debug Failing Tests

## When to use
When the user reports failing tests or when `npm test` / `vitest run` produces errors. Especially useful after refactoring, dependency upgrades, or merging branches.

## Steps
1. Run the full test suite to get the exact failure output — don't guess from file names
2. Read the failing test file to understand what it asserts
3. Read the source file under test to find the divergence
4. Check recent git changes (`git diff HEAD~3`) to identify what broke
5. Fix the root cause in the source, not the test — unless the test was wrong
6. Run only the failing test to verify the fix: `vitest run <file>`
7. Run the full suite to check for regressions

## Example
User: "Tests are broken after the auth refactor"
Agent: Runs `npm test`, sees 3 failures in `auth.test.ts`. Reads test — expects `validateToken()` to return `{ valid: true, userId }`. Reads source — function was renamed to `verifyToken()` during refactor. Fixes the import in the test. All 3 tests pass. Full suite green.

## Key decisions
- Always run the full suite after fixing, not just the broken test
- Fix source over test — if the test was correct before, the source probably broke
- Check git diff to narrow scope instead of reading everything
- One fix at a time, verify, then move to the next failure
