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

## Reporting vulnerabilities

If you find a security issue, please **do not** open a public GitHub issue. Instead, open a private security advisory on the repository:

`https://github.com/martin-minghetti/skillcam/security/advisories/new`

You should receive a response within a few days. Please include:

- A clear description of the issue
- Steps to reproduce
- The version of SkillCam you tested
- Any suggested mitigations

## Supply chain

SkillCam takes several precautions to protect the build and release pipeline:

- **Trusted publishing + provenance.** Releases to npm are published from GitHub Actions using [npm trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/). Each release carries a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements) linking the published tarball to the exact source commit and workflow run. You can verify a locally installed copy with:

  ```sh
  npm audit signatures
  ```

- **No install scripts.** The repository-level `.npmrc` sets `ignore-scripts=true`, and CI installs with `npm ci --ignore-scripts`, so dependencies cannot execute arbitrary code during `npm install`.

- **Automated monitoring.** Dependabot watches npm and GitHub Actions dependencies weekly, and [CodeQL](https://codeql.github.com/) runs on every push and pull request against `main`. Vulnerability alerts, private vulnerability reporting, and secret scanning with validity checks are enabled on the repository.

- **Protected main branch.** Merges to `main` require pull requests, linear history, signed commits, and passing `test` and `CodeQL` status checks. Force-pushes and deletions of `main` are blocked.

## Supported versions

SkillCam is in early alpha (0.x). Only the latest published version receives security fixes.
