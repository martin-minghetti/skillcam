# SkillCam v0.2.6 — Distiller rewrite comparison

> Dry-run demo. No API calls. Shows the prompts the distiller builds for five curated fixtures, side-by-side with what v0.2.5 would have emitted for the same input.

## Summary across 5 fixtures

| Metric | v0.2.5 | v0.2.6 | Δ |
| --- | --- | --- | --- |
| Prompt chars | 10558 | 25504 | +142% |
| Prompt lines | 311 | 601 | +93% |
| `/Users/` or `/home/` leaks | 21 | 0 |  |
| Few-shot examples | no | yes |  |
| Abort protocol | no | yes |  |
| Closed tag taxonomy | no | yes |  |
| JSON schema enforced | no | yes |  |
| Causal-chain rule | no | yes |  |
| BAD/GOOD hints in rules | 0 | 10 |  |

### What changed in v0.2.6

1. **Two-step architecture.** A cheap Haiku "quality judge" runs before the main Sonnet call and aborts when the session is exploratory or has no reusable pattern. Kills the #1 cause of low-quality skills in v0.2.5.
2. **JSON schema output.** The distiller now emits strict JSON, which TypeScript renders to SKILL.md. Frontmatter is no longer controlled by the LLM.
3. **Semantic tool-call summaries.** Replaces `JSON.stringify(tc.input).slice(0, 100)` with per-tool-type extraction that keeps the full semantic value (file path, command, pattern) and anonymizes `/Users/*` paths.
4. **Prompt reordered:** intent → conversation → actions → outcome (was tool calls first).
5. **Anti-literal rule with BAD/GOOD examples**, causal-chain rule, abort protocol, closed tag taxonomy.
6. **New metadata:** `confidence`, `why_this_worked`, `distill_prompt_version` — enables re-distill and reuse scoring.
7. **Caps per section** (steps ≤ 8, key_decisions ≤ 5) instead of a single global "under 100 lines" that LLMs ignore.

### How to run this locally

```bash
# regenerate this document
npx tsx scripts/demo.ts

# run the full eval suite (requires ANTHROPIC_API_KEY)
npx tsx eval/run.ts
```


---

## Fixture: `good-fix-bug`

Productive session: agent fixes failing tests, ends with green suite

**Expected outcome:** a skill whose output contains `test`, `fail`, `verify` and does NOT contain `/Users/dev/`, `Use `Bash` on`, `1.1.`.

### Metrics

| Metric | v0.2.5 | v0.2.6 | Δ |
| --- | --- | --- | --- |
| Prompt chars | 2191 | 5244 | +139% |
| Prompt lines | 65 | 122 | +88% |
| `/Users/` or `/home/` leaks | 4 | 0 |  |
| Few-shot examples | no | yes |  |
| Abort protocol | no | yes |  |
| Closed tag taxonomy | no | yes |  |
| JSON schema enforced | no | yes |  |
| Causal-chain rule | no | yes |  |
| BAD/GOOD hints in rules | 0 | 2 |  |

### v0.2.6 judge prompt (new, cheap pre-gate)

<details><summary>Click to expand</summary>

```
You are a quality gate for skill extraction. Decide whether this agent session contains a REUSABLE PATTERN worth turning into a skill.

A session IS distillable when ALL of these hold:
1. It produced a concrete artifact (files modified, commands completed, or a specific answer to a posed question).
2. The pattern could plausibly be reused in a future session with different specifics.
3. Steps are not entirely generic tool usage — there is a goal you can name in one sentence.

A session is NOT distillable when:
- It was pure exploration with no outcome.
- The user abandoned the task or ended without success.
- Every action was generic ("read the file", "search the codebase") without a specific goal.

## Session

### Intent (first user message)
Los tests están rotos después del refactor de auth. npm test falla.

### Outcome signals
- Files modified: tests/auth.test.ts
- Tool calls: 6
- Tools used: Bash, Read, Edit
- Last 3 Bash outputs: FAIL tests/auth.test.ts
  × validateToken returns valid token (15ms)
    ReferenceError: validateToken is not defined
  × validateToken rejects expired (12ms)
  × validateToken rejects malformed (8ms) | Test Files: 1 passed
Tests: 3 passed | Test Files: 9 passed
Tests: 50 passed
- Final assistant message: La función se renombró a verifyToken en el refactor. El test sigue importando validateToken. Fix en el test, no en el source.

## Output

Emit EXACTLY this JSON object, nothing else, no prose, no code fences:

{"distillable": <true|false>, "reason": "<one short sentence>", "confidence": "<high|medium|low>"}
```

</details>

### v0.2.5 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: claude-code
- Project: /Users/dev/Projects/gym-tracker-app
- Tool calls: 6
- Tools used: Bash, Read, Edit
- Files modified: tests/auth.test.ts

## Tool Calls
- Bash: {"command":"npm test","description":"Run test suite"}
- Read: {"file_path":"/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts"}
- Read: {"file_path":"/Users/dev/Projects/gym-tracker-app/src/auth.ts"}
- Edit: {"file_path":"/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts","old_string":"import { validateToken } from '../src/auth';","new_string":"import { verifyToken as validateToken } from '../src/aut
- Bash: {"command":"npx vitest run tests/auth.test.ts","description":"Re-run just the failing suite"}
- Bash: {"command":"npm test","description":"Run full suite for regressions"}

## Conversation
user: Los tests están rotos después del refactor de auth. npm test falla.

assistant: Corro la suite para ver los errores reales.
  [Tools: Bash]

assistant: 3 tests fallan con ReferenceError: validateToken. Leo el test.
  [Tools: Read, Read]

assistant: La función se renombró a verifyToken en el refactor. El test sigue importando validateToken. Fix en el test, no en el source.
  [Tools: Edit, Bash, Bash]

## Your Task

Extract the reusable pattern from this session. Output a SKILL.md with this exact format:

```markdown
---
name: <kebab-case-name>
description: <one line description of what this skill does>
source_session: fix-bug-0001
source_agent: claude-code
created: 2026-04-20
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
```

Rules:
- Be specific and actionable, not generic
- Include actual file paths, commands, or patterns from the session
- The skill should be usable by someone who never saw the original session
- Keep it under 100 lines
```

</details>

### v0.2.6 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Extract the REUSABLE PATTERN from this AI agent session into a single JSON object.

## Session

### Project
gym-tracker-app

### Intent (first user message)
Los tests están rotos después del refactor de auth. npm test falla.

### Conversation
user: Los tests están rotos después del refactor de auth. npm test falla.

assistant: Corro la suite para ver los errores reales.

assistant: 3 tests fallan con ReferenceError: validateToken. Leo el test.

assistant: La función se renombró a verifyToken en el refactor. El test sigue importando validateToken. Fix en el test, no en el source.

### Actions taken
- Bash: npm test (Run test suite)
- Read tests/auth.test.ts
- Read src/auth.ts
- Edit tests/auth.test.ts: "import { validateToken } from '../src/auth';" → "import { verifyToken as validateToken } from '../src/auth';"
- Bash: npx vitest run tests/auth.test.ts (Re-run just the failing suite)
- Bash: npm test (Run full suite for regressions)

### Outcome
- Files modified: tests/auth.test.ts
- Tool calls: 6
- Tools used: Bash, Read, Edit
- Final assistant message: La función se renombró a verifyToken en el refactor. El test sigue importando validateToken. Fix en el test, no en el source.

---

## Your task

Output EXACTLY ONE valid JSON object. No prose before or after. No code fences.

### If the session is distillable, use this schema:

{
  "name": "kebab-case-descriptive-name",
  "description": "one sentence describing what this skill does, from the agent's perspective",
  "when_to_use": "1-3 sentences naming the TRIGGER situation. What signal in a future conversation should make the agent reach for this skill?",
  "steps": ["step 1", "step 2", "..."],
  "example": "one short narrative: User asked X → agent did Y → result Z",
  "key_decisions": ["non-obvious rule 1", "gotcha 2", "..."],
  "tags": ["tag1", "tag2"],
  "confidence": "high" | "medium" | "low",
  "why_this_worked": "one sentence naming the single key insight"
}

### If the session is NOT distillable, use this schema instead:

{"abort": "no_artifact" | "no_reusable_pattern", "reason": "<one short sentence>"}

---

## Hard rules

1. **No tool names in steps.** Describe WHAT was accomplished, not WHICH tool was invoked.
   - BAD: "Use Bash to run npm test"
   - GOOD: "Run the full test suite first to get the exact failure output"

2. **No absolute paths.** Use relative paths (src/foo.ts). Never `/Users/<name>/` or `/home/<name>/`.

3. **Only the causal chain.** If the session had abandoned attempts before the working fix, include ONLY the steps that led to the successful outcome. Discard dead ends.

4. **Abort protocol.** Emit `{"abort": "no_artifact", ...}` if the session produced no concrete artifact (no files modified, no successful commands, no resolved answer). Emit `{"abort": "no_reusable_pattern", ...}` if every step is generic ("read a file", "search the codebase") without a specific goal a future agent could recognize.

5. **Section caps.**
   - `steps`: max 8, each one single-line.
   - `key_decisions`: max 5 bullets.
   - `description`: ≤ 140 chars.
   - `when_to_use`: ≤ 3 sentences.

6. **Tags from this closed taxonomy ONLY (pick 2-4):**
   testing, debugging, api, database, security, auth, performance, deployment, refactor, typescript, react, next-js, supabase, build, tooling, ci, migrations, observability

---

## Example 1 — distillable session

Intent: "Tests broke after the auth refactor."
Actions: ran test suite → read failing test → read source → fixed import → re-ran.
Outcome: tests/auth.test.ts modified, full suite green.

Output:
{
  "name": "debug-failing-tests",
  "description": "Systematically debug and fix failing tests by reading errors and tracing to root cause",
  "when_to_use": "When tests fail after refactoring, dependency upgrades, or merges. Apply before guessing at fixes.",
  "steps": [
    "Run the full test suite first — don't guess failures from file names",
    "Read the failing test to see what it asserts",
    "Read the source under test to find where it diverges from the test's expectation",
    "Check git diff to narrow the time window of the break",
    "Fix the root cause, not the test — unless the test was wrong",
    "Re-run only the failing test to verify",
    "Run the full suite to catch regressions"
  ],
  "example": "Agent ran npm test, saw 3 failures in auth.test.ts expecting validateToken. Read source and found it was renamed to verifyToken during refactor. Fixed the import alias. Full suite green.",
  "key_decisions": [
    "Fix source over test when the test was correct before",
    "Always run full suite after, not just the broken test",
    "Narrow scope with git diff before reading widely"
  ],
  "tags": ["testing", "debugging", "refactor"],
  "confidence": "high",
  "why_this_worked": "Reading the source before touching the test surfaced the rename as the true root cause"
}

## Example 2 — non-distillable session

Intent: "What's in this repo? Never saw it."
Actions: ls, read README, read package.json, grep TODO.
Outcome: no files modified, agent summarized findings.

Output:
{"abort": "no_artifact", "reason": "Pure exploration with no concrete outcome — agent summarized but produced nothing reusable"}

```

</details>


---

## Fixture: `good-build-feature`

Productive session: build API endpoint with Zod validation + tests

**Expected outcome:** a skill whose output contains `Zod`, `schema`, `validation`, `test` and does NOT contain `/Users/dev/`, `Use `Write` on`.

### Metrics

| Metric | v0.2.5 | v0.2.6 | Δ |
| --- | --- | --- | --- |
| Prompt chars | 2042 | 5061 | +148% |
| Prompt lines | 57 | 116 | +104% |
| `/Users/` or `/home/` leaks | 4 | 0 |  |
| Few-shot examples | no | yes |  |
| Abort protocol | no | yes |  |
| Closed tag taxonomy | no | yes |  |
| JSON schema enforced | no | yes |  |
| Causal-chain rule | no | yes |  |
| BAD/GOOD hints in rules | 0 | 2 |  |

### v0.2.6 judge prompt (new, cheap pre-gate)

<details><summary>Click to expand</summary>

```
You are a quality gate for skill extraction. Decide whether this agent session contains a REUSABLE PATTERN worth turning into a skill.

A session IS distillable when ALL of these hold:
1. It produced a concrete artifact (files modified, commands completed, or a specific answer to a posed question).
2. The pattern could plausibly be reused in a future session with different specifics.
3. Steps are not entirely generic tool usage — there is a goal you can name in one sentence.

A session is NOT distillable when:
- It was pure exploration with no outcome.
- The user abandoned the task or ended without success.
- Every action was generic ("read the file", "search the codebase") without a specific goal.

## Session

### Intent (first user message)
Agregá un POST /api/exercises que acepte {name, muscleGroup, equipment?}. Validá input y devolvé 201 con el recurso.

### Outcome signals
- Files modified: src/app/api/exercises/route.ts, tests/api-exercises.test.ts
- Tool calls: 4
- Tools used: Read, Write, Bash
- Last 3 Bash outputs: Test Files: 1 passed
Tests: 3 passed
- Final assistant message: Defino el schema Zod y el route handler.

## Output

Emit EXACTLY this JSON object, nothing else, no prose, no code fences:

{"distillable": <true|false>, "reason": "<one short sentence>", "confidence": "<high|medium|low>"}
```

</details>

### v0.2.5 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: claude-code
- Project: /Users/dev/Projects/gym-tracker-app
- Tool calls: 4
- Tools used: Read, Write, Bash
- Files modified: src/app/api/exercises/route.ts, tests/api-exercises.test.ts

## Tool Calls
- Read: {"file_path":"/Users/dev/Projects/gym-tracker-app/src/app/api/workouts/route.ts"}
- Write: {"file_path":"/Users/dev/Projects/gym-tracker-app/src/app/api/exercises/route.ts","content":"import { z } from 'zod';\nimport { NextResponse } from 'next/server';\n\nconst ExerciseSchema = z.object({\
- Write: {"file_path":"/Users/dev/Projects/gym-tracker-app/tests/api-exercises.test.ts","content":"import { POST } from '@/app/api/exercises/route';\n\ndescribe('POST /api/exercises', () => {\n  it('returns 20
- Bash: {"command":"npx vitest run tests/api-exercises.test.ts","description":"Run new tests"}

## Conversation
user: Agregá un POST /api/exercises que acepte {name, muscleGroup, equipment?}. Validá input y devolvé 201 con el recurso.

assistant: Defino el schema Zod y el route handler.
  [Tools: Read, Write, Write, Bash]

## Your Task

Extract the reusable pattern from this session. Output a SKILL.md with this exact format:

```markdown
---
name: <kebab-case-name>
description: <one line description of what this skill does>
source_session: build-feat-0003
source_agent: claude-code
created: 2026-04-20
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
```

Rules:
- Be specific and actionable, not generic
- Include actual file paths, commands, or patterns from the session
- The skill should be usable by someone who never saw the original session
- Keep it under 100 lines
```

</details>

### v0.2.6 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Extract the REUSABLE PATTERN from this AI agent session into a single JSON object.

## Session

### Project
gym-tracker-app

### Intent (first user message)
Agregá un POST /api/exercises que acepte {name, muscleGroup, equipment?}. Validá input y devolvé 201 con el recurso.

### Conversation
user: Agregá un POST /api/exercises que acepte {name, muscleGroup, equipment?}. Validá input y devolvé 201 con el recurso.

assistant: Defino el schema Zod y el route handler.

### Actions taken
- Read src/app/api/workouts/route.ts
- Write src/app/api/exercises/route.ts (515b): import { z } from 'zod'; · import { NextResponse } from 'next/server';
- Write tests/api-exercises.test.ts (280b): import { POST } from '@/app/api/exercises/route'; · 
- Bash: npx vitest run tests/api-exercises.test.ts (Run new tests)

### Outcome
- Files modified: src/app/api/exercises/route.ts, tests/api-exercises.test.ts
- Tool calls: 4
- Tools used: Read, Write, Bash
- Final assistant message: Defino el schema Zod y el route handler.

---

## Your task

Output EXACTLY ONE valid JSON object. No prose before or after. No code fences.

### If the session is distillable, use this schema:

{
  "name": "kebab-case-descriptive-name",
  "description": "one sentence describing what this skill does, from the agent's perspective",
  "when_to_use": "1-3 sentences naming the TRIGGER situation. What signal in a future conversation should make the agent reach for this skill?",
  "steps": ["step 1", "step 2", "..."],
  "example": "one short narrative: User asked X → agent did Y → result Z",
  "key_decisions": ["non-obvious rule 1", "gotcha 2", "..."],
  "tags": ["tag1", "tag2"],
  "confidence": "high" | "medium" | "low",
  "why_this_worked": "one sentence naming the single key insight"
}

### If the session is NOT distillable, use this schema instead:

{"abort": "no_artifact" | "no_reusable_pattern", "reason": "<one short sentence>"}

---

## Hard rules

1. **No tool names in steps.** Describe WHAT was accomplished, not WHICH tool was invoked.
   - BAD: "Use Bash to run npm test"
   - GOOD: "Run the full test suite first to get the exact failure output"

2. **No absolute paths.** Use relative paths (src/foo.ts). Never `/Users/<name>/` or `/home/<name>/`.

3. **Only the causal chain.** If the session had abandoned attempts before the working fix, include ONLY the steps that led to the successful outcome. Discard dead ends.

4. **Abort protocol.** Emit `{"abort": "no_artifact", ...}` if the session produced no concrete artifact (no files modified, no successful commands, no resolved answer). Emit `{"abort": "no_reusable_pattern", ...}` if every step is generic ("read a file", "search the codebase") without a specific goal a future agent could recognize.

5. **Section caps.**
   - `steps`: max 8, each one single-line.
   - `key_decisions`: max 5 bullets.
   - `description`: ≤ 140 chars.
   - `when_to_use`: ≤ 3 sentences.

6. **Tags from this closed taxonomy ONLY (pick 2-4):**
   testing, debugging, api, database, security, auth, performance, deployment, refactor, typescript, react, next-js, supabase, build, tooling, ci, migrations, observability

---

## Example 1 — distillable session

Intent: "Tests broke after the auth refactor."
Actions: ran test suite → read failing test → read source → fixed import → re-ran.
Outcome: tests/auth.test.ts modified, full suite green.

Output:
{
  "name": "debug-failing-tests",
  "description": "Systematically debug and fix failing tests by reading errors and tracing to root cause",
  "when_to_use": "When tests fail after refactoring, dependency upgrades, or merges. Apply before guessing at fixes.",
  "steps": [
    "Run the full test suite first — don't guess failures from file names",
    "Read the failing test to see what it asserts",
    "Read the source under test to find where it diverges from the test's expectation",
    "Check git diff to narrow the time window of the break",
    "Fix the root cause, not the test — unless the test was wrong",
    "Re-run only the failing test to verify",
    "Run the full suite to catch regressions"
  ],
  "example": "Agent ran npm test, saw 3 failures in auth.test.ts expecting validateToken. Read source and found it was renamed to verifyToken during refactor. Fixed the import alias. Full suite green.",
  "key_decisions": [
    "Fix source over test when the test was correct before",
    "Always run full suite after, not just the broken test",
    "Narrow scope with git diff before reading widely"
  ],
  "tags": ["testing", "debugging", "refactor"],
  "confidence": "high",
  "why_this_worked": "Reading the source before touching the test surfaced the rename as the true root cause"
}

## Example 2 — non-distillable session

Intent: "What's in this repo? Never saw it."
Actions: ls, read README, read package.json, grep TODO.
Outcome: no files modified, agent summarized findings.

Output:
{"abort": "no_artifact", "reason": "Pure exploration with no concrete outcome — agent summarized but produced nothing reusable"}

```

</details>


---

## Fixture: `exploratory`

Pure exploration: user asks state of a project, agent greps/reads, no artifact produced

**Expected outcome:** abort (`no_artifact`). The quality judge should short-circuit before the main LLM call.

### Metrics

| Metric | v0.2.5 | v0.2.6 | Δ |
| --- | --- | --- | --- |
| Prompt chars | 1638 | 4736 | +189% |
| Prompt lines | 59 | 118 | +100% |
| `/Users/` or `/home/` leaks | 4 | 0 |  |
| Few-shot examples | no | yes |  |
| Abort protocol | no | yes |  |
| Closed tag taxonomy | no | yes |  |
| JSON schema enforced | no | yes |  |
| Causal-chain rule | no | yes |  |
| BAD/GOOD hints in rules | 0 | 2 |  |

### v0.2.6 judge prompt (new, cheap pre-gate)

<details><summary>Click to expand</summary>

```
You are a quality gate for skill extraction. Decide whether this agent session contains a REUSABLE PATTERN worth turning into a skill.

A session IS distillable when ALL of these hold:
1. It produced a concrete artifact (files modified, commands completed, or a specific answer to a posed question).
2. The pattern could plausibly be reused in a future session with different specifics.
3. Steps are not entirely generic tool usage — there is a goal you can name in one sentence.

A session is NOT distillable when:
- It was pure exploration with no outcome.
- The user abandoned the task or ended without success.
- Every action was generic ("read the file", "search the codebase") without a specific goal.

## Session

### Intent (first user message)
Qué hay en este repo? Nunca lo vi.

### Outcome signals
- Files modified: (none)
- Tool calls: 4
- Tools used: Bash, Read, Grep
- Last 3 Bash outputs: README.md  package.json  src/  tests/
- Final assistant message: Es una library TypeScript simple. Tiene README mínimo y 2 TODOs pendientes.

## Output

Emit EXACTLY this JSON object, nothing else, no prose, no code fences:

{"distillable": <true|false>, "reason": "<one short sentence>", "confidence": "<high|medium|low>"}
```

</details>

### v0.2.5 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: claude-code
- Project: /Users/dev/Projects/some-unknown-repo
- Tool calls: 4
- Tools used: Bash, Read, Grep
- Files modified: 

## Tool Calls
- Bash: {"command":"ls -la","description":"List root"}
- Read: {"file_path":"/Users/dev/Projects/some-unknown-repo/README.md"}
- Read: {"file_path":"/Users/dev/Projects/some-unknown-repo/package.json"}
- Grep: {"pattern":"TODO","path":"/Users/dev/Projects/some-unknown-repo"}

## Conversation
user: Qué hay en este repo? Nunca lo vi.

assistant: Exploro la estructura.
  [Tools: Bash, Read, Read, Grep]

assistant: Es una library TypeScript simple. Tiene README mínimo y 2 TODOs pendientes.

## Your Task

Extract the reusable pattern from this session. Output a SKILL.md with this exact format:

```markdown
---
name: <kebab-case-name>
description: <one line description of what this skill does>
source_session: explore-0002
source_agent: claude-code
created: 2026-04-20
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
```

Rules:
- Be specific and actionable, not generic
- Include actual file paths, commands, or patterns from the session
- The skill should be usable by someone who never saw the original session
- Keep it under 100 lines
```

</details>

### v0.2.6 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Extract the REUSABLE PATTERN from this AI agent session into a single JSON object.

## Session

### Project
some-unknown-repo

### Intent (first user message)
Qué hay en este repo? Nunca lo vi.

### Conversation
user: Qué hay en este repo? Nunca lo vi.

assistant: Exploro la estructura.

assistant: Es una library TypeScript simple. Tiene README mínimo y 2 TODOs pendientes.

### Actions taken
- Bash: ls -la (List root)
- Read README.md
- Read package.json
- Grep pattern=TODO in=some-unknown-repo

### Outcome
- Files modified: (none)
- Tool calls: 4
- Tools used: Bash, Read, Grep
- Final assistant message: Es una library TypeScript simple. Tiene README mínimo y 2 TODOs pendientes.

---

## Your task

Output EXACTLY ONE valid JSON object. No prose before or after. No code fences.

### If the session is distillable, use this schema:

{
  "name": "kebab-case-descriptive-name",
  "description": "one sentence describing what this skill does, from the agent's perspective",
  "when_to_use": "1-3 sentences naming the TRIGGER situation. What signal in a future conversation should make the agent reach for this skill?",
  "steps": ["step 1", "step 2", "..."],
  "example": "one short narrative: User asked X → agent did Y → result Z",
  "key_decisions": ["non-obvious rule 1", "gotcha 2", "..."],
  "tags": ["tag1", "tag2"],
  "confidence": "high" | "medium" | "low",
  "why_this_worked": "one sentence naming the single key insight"
}

### If the session is NOT distillable, use this schema instead:

{"abort": "no_artifact" | "no_reusable_pattern", "reason": "<one short sentence>"}

---

## Hard rules

1. **No tool names in steps.** Describe WHAT was accomplished, not WHICH tool was invoked.
   - BAD: "Use Bash to run npm test"
   - GOOD: "Run the full test suite first to get the exact failure output"

2. **No absolute paths.** Use relative paths (src/foo.ts). Never `/Users/<name>/` or `/home/<name>/`.

3. **Only the causal chain.** If the session had abandoned attempts before the working fix, include ONLY the steps that led to the successful outcome. Discard dead ends.

4. **Abort protocol.** Emit `{"abort": "no_artifact", ...}` if the session produced no concrete artifact (no files modified, no successful commands, no resolved answer). Emit `{"abort": "no_reusable_pattern", ...}` if every step is generic ("read a file", "search the codebase") without a specific goal a future agent could recognize.

5. **Section caps.**
   - `steps`: max 8, each one single-line.
   - `key_decisions`: max 5 bullets.
   - `description`: ≤ 140 chars.
   - `when_to_use`: ≤ 3 sentences.

6. **Tags from this closed taxonomy ONLY (pick 2-4):**
   testing, debugging, api, database, security, auth, performance, deployment, refactor, typescript, react, next-js, supabase, build, tooling, ci, migrations, observability

---

## Example 1 — distillable session

Intent: "Tests broke after the auth refactor."
Actions: ran test suite → read failing test → read source → fixed import → re-ran.
Outcome: tests/auth.test.ts modified, full suite green.

Output:
{
  "name": "debug-failing-tests",
  "description": "Systematically debug and fix failing tests by reading errors and tracing to root cause",
  "when_to_use": "When tests fail after refactoring, dependency upgrades, or merges. Apply before guessing at fixes.",
  "steps": [
    "Run the full test suite first — don't guess failures from file names",
    "Read the failing test to see what it asserts",
    "Read the source under test to find where it diverges from the test's expectation",
    "Check git diff to narrow the time window of the break",
    "Fix the root cause, not the test — unless the test was wrong",
    "Re-run only the failing test to verify",
    "Run the full suite to catch regressions"
  ],
  "example": "Agent ran npm test, saw 3 failures in auth.test.ts expecting validateToken. Read source and found it was renamed to verifyToken during refactor. Fixed the import alias. Full suite green.",
  "key_decisions": [
    "Fix source over test when the test was correct before",
    "Always run full suite after, not just the broken test",
    "Narrow scope with git diff before reading widely"
  ],
  "tags": ["testing", "debugging", "refactor"],
  "confidence": "high",
  "why_this_worked": "Reading the source before touching the test surfaced the rename as the true root cause"
}

## Example 2 — non-distillable session

Intent: "What's in this repo? Never saw it."
Actions: ls, read README, read package.json, grep TODO.
Outcome: no files modified, agent summarized findings.

Output:
{"abort": "no_artifact", "reason": "Pure exploration with no concrete outcome — agent summarized but produced nothing reusable"}

```

</details>


---

## Fixture: `dead-ends`

Productive session with abandoned attempts: agent tries 2 wrong paths before hitting the right one

**Expected outcome:** a skill whose output contains `profile`, `beforeAll` and does NOT contain `Use `Edit` on`, `1.1.`.

### Metrics

| Metric | v0.2.5 | v0.2.6 | Δ |
| --- | --- | --- | --- |
| Prompt chars | 2578 | 5386 | +109% |
| Prompt lines | 68 | 125 | +84% |
| `/Users/` or `/home/` leaks | 5 | 0 |  |
| Few-shot examples | no | yes |  |
| Abort protocol | no | yes |  |
| Closed tag taxonomy | no | yes |  |
| JSON schema enforced | no | yes |  |
| Causal-chain rule | no | yes |  |
| BAD/GOOD hints in rules | 0 | 2 |  |

### v0.2.6 judge prompt (new, cheap pre-gate)

<details><summary>Click to expand</summary>

```
You are a quality gate for skill extraction. Decide whether this agent session contains a REUSABLE PATTERN worth turning into a skill.

A session IS distillable when ALL of these hold:
1. It produced a concrete artifact (files modified, commands completed, or a specific answer to a posed question).
2. The pattern could plausibly be reused in a future session with different specifics.
3. Steps are not entirely generic tool usage — there is a goal you can name in one sentence.

A session is NOT distillable when:
- It was pure exploration with no outcome.
- The user abandoned the task or ended without success.
- Every action was generic ("read the file", "search the codebase") without a specific goal.

## Session

### Intent (first user message)
Los tests tardan 45s. Hacelos más rápidos sin perder cobertura.

### Outcome signals
- Files modified: tests/auth.test.ts
- Tool calls: 9
- Tools used: Bash, Edit, Read
- Last 3 Bash outputs: Top 3 slowest: auth.test.ts 18.4s, db.test.ts 12.1s, workouts.test.ts 5.8s. Rest < 1s. | Duration 3.8s (was 18.4s). All 24 tests pass. | Duration 18.9s (was 45s). All 180 tests pass.
- Final assistant message: Ambos intentos fallaron. Perfilo para ver dónde se va el tiempo.

## Output

Emit EXACTLY this JSON object, nothing else, no prose, no code fences:

{"distillable": <true|false>, "reason": "<one short sentence>", "confidence": "<high|medium|low>"}
```

</details>

### v0.2.5 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: claude-code
- Project: /Users/dev/Projects/gym-tracker-app
- Tool calls: 9
- Tools used: Bash, Edit, Read
- Files modified: tests/auth.test.ts

## Tool Calls
- Bash: {"command":"npx vitest run --pool=threads","description":"Try threads pool"}
- Edit: {"file_path":"/Users/dev/Projects/gym-tracker-app/vitest.config.ts","old_string":"poolOptions: { threads: {} }","new_string":"poolOptions: { threads: { isolate: false } }"}
- Bash: {"command":"npx vitest run","description":"Re-run with isolate=false"}
- Edit: {"file_path":"/Users/dev/Projects/gym-tracker-app/vitest.config.ts","old_string":"poolOptions: { threads: { isolate: false } }","new_string":"poolOptions: { threads: {} }"}
- Bash: {"command":"npx vitest run --reporter=verbose --logHeapUsage","description":"Profile test durations"}
- Read: {"file_path":"/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts"}
- Edit: {"file_path":"/Users/dev/Projects/gym-tracker-app/tests/auth.test.ts","old_string":"beforeEach(async () => { await createTestDb(); })","new_string":"beforeAll(async () => { await createTestDb(); })\na
- Bash: {"command":"npx vitest run tests/auth.test.ts","description":"Verify"}
- Bash: {"command":"npx vitest run","description":"Full suite after fix"}

## Conversation
user: Los tests tardan 45s. Hacelos más rápidos sin perder cobertura.

assistant: Pruebo con --pool=threads primero.
  [Tools: Bash]

assistant: Nada. Reduzco isolate=false.
  [Tools: Edit, Bash, Edit]

assistant: Ambos intentos fallaron. Perfilo para ver dónde se va el tiempo.
  [Tools: Bash, Read, Edit, Bash, Bash]

## Your Task

Extract the reusable pattern from this session. Output a SKILL.md with this exact format:

```markdown
---
name: <kebab-case-name>
description: <one line description of what this skill does>
source_session: dead-ends-0004
source_agent: claude-code
created: 2026-04-20
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
```

Rules:
- Be specific and actionable, not generic
- Include actual file paths, commands, or patterns from the session
- The skill should be usable by someone who never saw the original session
- Keep it under 100 lines
```

</details>

### v0.2.6 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Extract the REUSABLE PATTERN from this AI agent session into a single JSON object.

## Session

### Project
gym-tracker-app

### Intent (first user message)
Los tests tardan 45s. Hacelos más rápidos sin perder cobertura.

### Conversation
user: Los tests tardan 45s. Hacelos más rápidos sin perder cobertura.

assistant: Pruebo con --pool=threads primero.

assistant: Nada. Reduzco isolate=false.

assistant: Ambos intentos fallaron. Perfilo para ver dónde se va el tiempo.

### Actions taken
- Bash: npx vitest run --pool=threads (Try threads pool)
- Edit vitest.config.ts: "poolOptions: { threads: {} }" → "poolOptions: { threads: { isolate: false } }"
- Bash: npx vitest run (Re-run with isolate=false)
- Edit vitest.config.ts: "poolOptions: { threads: { isolate: false } }" → "poolOptions: { threads: {} }"
- Bash: npx vitest run --reporter=verbose --logHeapUsage (Profile test durations)
- Read tests/auth.test.ts
- Edit tests/auth.test.ts: "beforeEach(async () => { await createTestDb(); })" → "beforeAll(async () => { await createTestDb(); })…"
- Bash: npx vitest run tests/auth.test.ts (Verify)
- Bash: npx vitest run (Full suite after fix)

### Outcome
- Files modified: tests/auth.test.ts
- Tool calls: 9
- Tools used: Bash, Edit, Read
- Final assistant message: Ambos intentos fallaron. Perfilo para ver dónde se va el tiempo.

---

## Your task

Output EXACTLY ONE valid JSON object. No prose before or after. No code fences.

### If the session is distillable, use this schema:

{
  "name": "kebab-case-descriptive-name",
  "description": "one sentence describing what this skill does, from the agent's perspective",
  "when_to_use": "1-3 sentences naming the TRIGGER situation. What signal in a future conversation should make the agent reach for this skill?",
  "steps": ["step 1", "step 2", "..."],
  "example": "one short narrative: User asked X → agent did Y → result Z",
  "key_decisions": ["non-obvious rule 1", "gotcha 2", "..."],
  "tags": ["tag1", "tag2"],
  "confidence": "high" | "medium" | "low",
  "why_this_worked": "one sentence naming the single key insight"
}

### If the session is NOT distillable, use this schema instead:

{"abort": "no_artifact" | "no_reusable_pattern", "reason": "<one short sentence>"}

---

## Hard rules

1. **No tool names in steps.** Describe WHAT was accomplished, not WHICH tool was invoked.
   - BAD: "Use Bash to run npm test"
   - GOOD: "Run the full test suite first to get the exact failure output"

2. **No absolute paths.** Use relative paths (src/foo.ts). Never `/Users/<name>/` or `/home/<name>/`.

3. **Only the causal chain.** If the session had abandoned attempts before the working fix, include ONLY the steps that led to the successful outcome. Discard dead ends.

4. **Abort protocol.** Emit `{"abort": "no_artifact", ...}` if the session produced no concrete artifact (no files modified, no successful commands, no resolved answer). Emit `{"abort": "no_reusable_pattern", ...}` if every step is generic ("read a file", "search the codebase") without a specific goal a future agent could recognize.

5. **Section caps.**
   - `steps`: max 8, each one single-line.
   - `key_decisions`: max 5 bullets.
   - `description`: ≤ 140 chars.
   - `when_to_use`: ≤ 3 sentences.

6. **Tags from this closed taxonomy ONLY (pick 2-4):**
   testing, debugging, api, database, security, auth, performance, deployment, refactor, typescript, react, next-js, supabase, build, tooling, ci, migrations, observability

---

## Example 1 — distillable session

Intent: "Tests broke after the auth refactor."
Actions: ran test suite → read failing test → read source → fixed import → re-ran.
Outcome: tests/auth.test.ts modified, full suite green.

Output:
{
  "name": "debug-failing-tests",
  "description": "Systematically debug and fix failing tests by reading errors and tracing to root cause",
  "when_to_use": "When tests fail after refactoring, dependency upgrades, or merges. Apply before guessing at fixes.",
  "steps": [
    "Run the full test suite first — don't guess failures from file names",
    "Read the failing test to see what it asserts",
    "Read the source under test to find where it diverges from the test's expectation",
    "Check git diff to narrow the time window of the break",
    "Fix the root cause, not the test — unless the test was wrong",
    "Re-run only the failing test to verify",
    "Run the full suite to catch regressions"
  ],
  "example": "Agent ran npm test, saw 3 failures in auth.test.ts expecting validateToken. Read source and found it was renamed to verifyToken during refactor. Fixed the import alias. Full suite green.",
  "key_decisions": [
    "Fix source over test when the test was correct before",
    "Always run full suite after, not just the broken test",
    "Narrow scope with git diff before reading widely"
  ],
  "tags": ["testing", "debugging", "refactor"],
  "confidence": "high",
  "why_this_worked": "Reading the source before touching the test surfaced the rename as the true root cause"
}

## Example 2 — non-distillable session

Intent: "What's in this repo? Never saw it."
Actions: ls, read README, read package.json, grep TODO.
Outcome: no files modified, agent summarized findings.

Output:
{"abort": "no_artifact", "reason": "Pure exploration with no concrete outcome — agent summarized but produced nothing reusable"}

```

</details>


---

## Fixture: `mixed`

Session with two parallel intents: fix a build error AND add a logger. Distiller should pick the dominant one or abort.

**Expected outcome:** a skill whose output contains `TS`, `type` and does NOT contain `Use `Bash` on`, `/Users/dev/`.

### Metrics

| Metric | v0.2.5 | v0.2.6 | Δ |
| --- | --- | --- | --- |
| Prompt chars | 2109 | 5077 | +141% |
| Prompt lines | 62 | 120 | +94% |
| `/Users/` or `/home/` leaks | 4 | 0 |  |
| Few-shot examples | no | yes |  |
| Abort protocol | no | yes |  |
| Closed tag taxonomy | no | yes |  |
| JSON schema enforced | no | yes |  |
| Causal-chain rule | no | yes |  |
| BAD/GOOD hints in rules | 0 | 2 |  |

### v0.2.6 judge prompt (new, cheap pre-gate)

<details><summary>Click to expand</summary>

```
You are a quality gate for skill extraction. Decide whether this agent session contains a REUSABLE PATTERN worth turning into a skill.

A session IS distillable when ALL of these hold:
1. It produced a concrete artifact (files modified, commands completed, or a specific answer to a posed question).
2. The pattern could plausibly be reused in a future session with different specifics.
3. Steps are not entirely generic tool usage — there is a goal you can name in one sentence.

A session is NOT distillable when:
- It was pure exploration with no outcome.
- The user abandoned the task or ended without success.
- Every action was generic ("read the file", "search the codebase") without a specific goal.

## Session

### Intent (first user message)
El build tira error en TS y de paso agregá logging con pino.

### Outcome signals
- Files modified: src/api/handler.ts, src/lib/logger.ts
- Tool calls: 6
- Tools used: Bash, Read, Edit, Write
- Last 3 Bash outputs: src/api/handler.ts(12,3): TS2322: Type 'string' not assignable to 'number'. | No errors. | added 8 packages
- Final assistant message: Build fixed. Ahora pino. Instalo y configuro.

## Output

Emit EXACTLY this JSON object, nothing else, no prose, no code fences:

{"distillable": <true|false>, "reason": "<one short sentence>", "confidence": "<high|medium|low>"}
```

</details>

### v0.2.5 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Analyze this AI agent session and distill the successful pattern into a reusable skill.

## Session Info
- Agent: claude-code
- Project: /Users/dev/Projects/gym-tracker-app
- Tool calls: 6
- Tools used: Bash, Read, Edit, Write
- Files modified: src/api/handler.ts, src/lib/logger.ts

## Tool Calls
- Bash: {"command":"npx tsc --noEmit","description":"Get TS errors"}
- Read: {"file_path":"/Users/dev/Projects/gym-tracker-app/src/api/handler.ts"}
- Edit: {"file_path":"/Users/dev/Projects/gym-tracker-app/src/api/handler.ts","old_string":"const port: number = process.env.PORT;","new_string":"const port: number = Number(process.env.PORT ?? 3000);"}
- Bash: {"command":"npx tsc --noEmit","description":"Verify"}
- Bash: {"command":"npm install pino","description":"Install pino"}
- Write: {"file_path":"/Users/dev/Projects/gym-tracker-app/src/lib/logger.ts","content":"import pino from 'pino';\nexport const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });"}

## Conversation
user: El build tira error en TS y de paso agregá logging con pino.

assistant: Arranco por el build, sin eso nada anda.
  [Tools: Bash, Read, Edit, Bash]

assistant: Build fixed. Ahora pino. Instalo y configuro.
  [Tools: Bash, Write]

## Your Task

Extract the reusable pattern from this session. Output a SKILL.md with this exact format:

```markdown
---
name: <kebab-case-name>
description: <one line description of what this skill does>
source_session: mixed-0005
source_agent: claude-code
created: 2026-04-20
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
```

Rules:
- Be specific and actionable, not generic
- Include actual file paths, commands, or patterns from the session
- The skill should be usable by someone who never saw the original session
- Keep it under 100 lines
```

</details>

### v0.2.6 distill prompt

<details><summary>Click to expand</summary>

```
You are a skill extraction engine. Extract the REUSABLE PATTERN from this AI agent session into a single JSON object.

## Session

### Project
gym-tracker-app

### Intent (first user message)
El build tira error en TS y de paso agregá logging con pino.

### Conversation
user: El build tira error en TS y de paso agregá logging con pino.

assistant: Arranco por el build, sin eso nada anda.

assistant: Build fixed. Ahora pino. Instalo y configuro.

### Actions taken
- Bash: npx tsc --noEmit (Get TS errors)
- Read src/api/handler.ts
- Edit src/api/handler.ts: "const port: number = process.env.PORT;" → "const port: number = Number(process.env.PORT ?? 3000);"
- Bash: npx tsc --noEmit (Verify)
- Bash: npm install pino (Install pino)
- Write src/lib/logger.ts (96b): import pino from 'pino'; · export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

### Outcome
- Files modified: src/api/handler.ts, src/lib/logger.ts
- Tool calls: 6
- Tools used: Bash, Read, Edit, Write
- Final assistant message: Build fixed. Ahora pino. Instalo y configuro.

---

## Your task

Output EXACTLY ONE valid JSON object. No prose before or after. No code fences.

### If the session is distillable, use this schema:

{
  "name": "kebab-case-descriptive-name",
  "description": "one sentence describing what this skill does, from the agent's perspective",
  "when_to_use": "1-3 sentences naming the TRIGGER situation. What signal in a future conversation should make the agent reach for this skill?",
  "steps": ["step 1", "step 2", "..."],
  "example": "one short narrative: User asked X → agent did Y → result Z",
  "key_decisions": ["non-obvious rule 1", "gotcha 2", "..."],
  "tags": ["tag1", "tag2"],
  "confidence": "high" | "medium" | "low",
  "why_this_worked": "one sentence naming the single key insight"
}

### If the session is NOT distillable, use this schema instead:

{"abort": "no_artifact" | "no_reusable_pattern", "reason": "<one short sentence>"}

---

## Hard rules

1. **No tool names in steps.** Describe WHAT was accomplished, not WHICH tool was invoked.
   - BAD: "Use Bash to run npm test"
   - GOOD: "Run the full test suite first to get the exact failure output"

2. **No absolute paths.** Use relative paths (src/foo.ts). Never `/Users/<name>/` or `/home/<name>/`.

3. **Only the causal chain.** If the session had abandoned attempts before the working fix, include ONLY the steps that led to the successful outcome. Discard dead ends.

4. **Abort protocol.** Emit `{"abort": "no_artifact", ...}` if the session produced no concrete artifact (no files modified, no successful commands, no resolved answer). Emit `{"abort": "no_reusable_pattern", ...}` if every step is generic ("read a file", "search the codebase") without a specific goal a future agent could recognize.

5. **Section caps.**
   - `steps`: max 8, each one single-line.
   - `key_decisions`: max 5 bullets.
   - `description`: ≤ 140 chars.
   - `when_to_use`: ≤ 3 sentences.

6. **Tags from this closed taxonomy ONLY (pick 2-4):**
   testing, debugging, api, database, security, auth, performance, deployment, refactor, typescript, react, next-js, supabase, build, tooling, ci, migrations, observability

---

## Example 1 — distillable session

Intent: "Tests broke after the auth refactor."
Actions: ran test suite → read failing test → read source → fixed import → re-ran.
Outcome: tests/auth.test.ts modified, full suite green.

Output:
{
  "name": "debug-failing-tests",
  "description": "Systematically debug and fix failing tests by reading errors and tracing to root cause",
  "when_to_use": "When tests fail after refactoring, dependency upgrades, or merges. Apply before guessing at fixes.",
  "steps": [
    "Run the full test suite first — don't guess failures from file names",
    "Read the failing test to see what it asserts",
    "Read the source under test to find where it diverges from the test's expectation",
    "Check git diff to narrow the time window of the break",
    "Fix the root cause, not the test — unless the test was wrong",
    "Re-run only the failing test to verify",
    "Run the full suite to catch regressions"
  ],
  "example": "Agent ran npm test, saw 3 failures in auth.test.ts expecting validateToken. Read source and found it was renamed to verifyToken during refactor. Fixed the import alias. Full suite green.",
  "key_decisions": [
    "Fix source over test when the test was correct before",
    "Always run full suite after, not just the broken test",
    "Narrow scope with git diff before reading widely"
  ],
  "tags": ["testing", "debugging", "refactor"],
  "confidence": "high",
  "why_this_worked": "Reading the source before touching the test surfaced the rename as the true root cause"
}

## Example 2 — non-distillable session

Intent: "What's in this repo? Never saw it."
Actions: ls, read README, read package.json, grep TODO.
Outcome: no files modified, agent summarized findings.

Output:
{"abort": "no_artifact", "reason": "Pure exploration with no concrete outcome — agent summarized but produced nothing reusable"}

```

</details>

