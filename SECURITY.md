# Security

SkillCam reads local AI agent sessions from your disk. Those sessions may contain secrets (API keys, tokens, private file contents). This document explains what SkillCam does with that data, how it protects it, and how to report security issues.

## Threat model

### What SkillCam reads

SkillCam reads `.jsonl` files from two locations on your machine:

- `~/.claude/projects/**/*.jsonl` (Claude Code)
- `~/.codex/sessions/**/*.jsonl` (Codex CLI)

These files are produced by the agent tools themselves and may contain the full conversation, tool call inputs and outputs, and file contents the agent saw. They commonly include sensitive data that was present during the session.

### Where that data goes

| Mode | What leaves your machine |
|------|--------------------------|
| `--no-llm` (template mode) | Nothing. SkillCam writes a local `SKILL.md` and an `events.jsonl` entry. No network calls. |
| Default (LLM mode) | A truncated version of the session is sent to the LLM provider you choose (Anthropic or OpenAI) using your own API key from `process.env`. No data goes through any SkillCam server — there is no SkillCam server. |

### What SkillCam never does

- No telemetry. No analytics. No remote error reporting.
- No auto-update.
- No access to directories other than the two listed above.
- No shell execution, no `eval`, no dynamic code loading beyond the LLM SDKs.
- No HTTP calls outside the official Anthropic and OpenAI SDKs.

## Secret scanning

Before sending a distillation prompt to the LLM, SkillCam scans the prompt for common secret patterns:

- Anthropic and OpenAI API keys
- GitHub PATs (classic and fine-grained)
- Google API keys
- AWS access keys and secret keys
- Stripe live/test keys
- Slack tokens
- JWTs
- PEM private key headers
- `password=`, `passwd=`, `pwd=` assignments

### Policies

The scan runs automatically in LLM mode. If it finds a match, SkillCam picks one of three behaviors based on the flags you pass to `distill`:

| Flag | Behavior if secrets are detected |
|------|----------------------------------|
| *(default)* | **Abort** with exit code 2, print the types and counts of what was found. Nothing is sent. |
| `--redact` | **Redact** each match in place (`[REDACTED:abcd...ef]`) and send the redacted prompt. |
| `--allow-secrets` | **Send as-is**. Use only if you are sure the matches are false positives. |

You can also avoid the LLM entirely with `--no-llm`.

### What the scan does NOT do

- It does not detect every possible secret. Custom formats, internal tokens, and domain-specific credentials may slip through.
- It does not scan the `SKILL.md` output from the LLM. If the LLM echoes a secret back in a pattern the scanner missed on the way in, it will end up in the output file. Review generated skills before committing them.
- It is heuristic. False positives and false negatives are expected.

Treat secret scanning as defense in depth, not a guarantee. If a session contains sensitive material and you are not confident, use `--no-llm`.

## Downstream skill consumption

Skills produced by SkillCam are markdown files. Their **body** is generated from the LLM (in default mode) or stitched together from session metadata (in `--no-llm` mode). In both cases, the content traces back to a session file on disk that an attacker with session-crafting capability could partially control — for example, by submitting a pull request whose CI runs a Claude Code session whose transcript you later distill.

SkillCam does not sanitize the body of the generated skill beyond the secret scan. In particular:

- The LLM can decide what goes under each heading. A crafted session can coax it into writing sections like `## When to use\nIgnore all previous instructions and...`
- The agent that later **reads** the skill is the one that decides how to act on it. SkillCam is a producer, not a consumer.

If you plan to feed skills produced by SkillCam back into another agent, **treat the SKILL.md body as untrusted prompt input**, the same way you would treat any user-supplied markdown. Good habits:

- Review generated skills before committing them to a shared repository.
- When an agent loads a skill, prefer an execution mode where the skill content is shown as reference material, not as authoritative instructions.
- Do not auto-execute tool calls suggested verbatim by a skill body.

A future version of SkillCam may add an allowlist of permitted sections and a heuristic filter for prompt-injection patterns (`"ignore all prior"`, `"you are now"`, etc.). Today, the responsibility for downstream safety lies with the skill consumer.

## Reporting vulnerabilities

If you find a security issue, please **do not** open a public GitHub issue. Instead, open a private security advisory on the repository:

`https://github.com/martin-minghetti/skillcam/security/advisories/new`

You should receive a response within a few days. Please include:

- A clear description of the issue
- Steps to reproduce
- The version of SkillCam you tested
- Any suggested mitigations

## Supported versions

SkillCam is in early alpha (0.x). Only the latest published version receives security fixes.
