#!/usr/bin/env node
import { program } from "commander";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  lstatSync,
  realpathSync,
} from "fs";
import { join, resolve, sep } from "path";
import { homedir } from "os";
import { discoverSessions } from "./discovery.js";
import { parseClaudeCodeSession } from "./parsers/claude-code.js";
import { parseCodexSession } from "./parsers/codex.js";
import { distillSkill, SecretsDetectedError, type SecretPolicy } from "./distiller.js";
import { summarize } from "./secret-scan.js";
import { emitEvent } from "./events/emit.js";
import type { ParsedSession } from "./parsers/types.js";
import { sanitizeSkillName, isInsideDirectory } from "./path-safety.js";
import {
  MAX_SESSION_BYTES,
  isSessionSizeAllowed,
  truncateSkill,
} from "./limits.js";

/**
 * C5 — verify that a session file path lives inside the expected trust root
 * for its agent. We resolve BOTH sides with realpathSync so that symlinks
 * pointing outside (or TOCTOU swaps between discovery and read) are caught.
 */
function assertInsideTrustRoot(
  targetPath: string,
  agent: "claude-code" | "codex"
): void {
  const trustRoot = agent === "claude-code"
    ? join(homedir(), ".claude", "projects")
    : join(homedir(), ".codex", "sessions");

  // Before we realpath, confirm the file itself is not a symlink. realpath
  // would happily follow it, but for a session file we want to refuse to
  // read symlinks entirely (see C5 in the audit).
  try {
    const lst = lstatSync(targetPath);
    if (lst.isSymbolicLink()) {
      console.error(
        `✗ Refusing to read symlinked session file: ${targetPath}`
      );
      process.exit(5);
    }
  } catch (err) {
    console.error(`✗ Cannot stat session file: ${targetPath}`);
    process.exit(5);
  }

  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = realpathSync(targetPath);
    realRoot = realpathSync(trustRoot);
  } catch (err) {
    console.error(
      `✗ refusing to read file outside trust root (cannot resolve): ${targetPath}`
    );
    process.exit(5);
  }

  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
    console.error(
      `✗ refusing to read file outside trust root: ${targetPath}`
    );
    process.exit(5);
  }
}

function parseSessionFile(
  path: string,
  agent: "claude-code" | "codex"
): ParsedSession {
  // C5 — trust-root confinement + symlink rejection
  assertInsideTrustRoot(path, agent);

  // M4 — size cap to prevent OOM on huge or attacker-crafted JSONL
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    console.error(`✗ Cannot stat session file: ${path}`);
    process.exit(6);
  }
  if (!isSessionSizeAllowed(size)) {
    console.error(
      `✗ Session file exceeds ${MAX_SESSION_BYTES} bytes (${size} bytes). Refusing to read.`
    );
    process.exit(6);
  }

  const content = readFileSync(path, "utf-8");
  return agent === "claude-code"
    ? parseClaudeCodeSession(content)
    : parseCodexSession(content);
}

program
  .name("skillcam")
  .description(
    "Turn successful AI agent runs into reusable markdown skills"
  )
  .version("0.1.0");

program
  .command("list")
  .description("List available agent sessions")
  .option("--agent <agent>", "Filter by agent (claude-code, codex)")
  .option("--last <n>", "Number of sessions to show", "10")
  .action((opts) => {
    const agent = opts.agent as "claude-code" | "codex" | undefined;
    const sessions = discoverSessions({
      agent,
      limit: parseInt(opts.last, 10),
    });

    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }

    console.log(`Found ${sessions.length} sessions:\n`);
    for (const s of sessions) {
      const size = (s.sizeBytes / 1024).toFixed(1);
      const date = new Date(s.modifiedAt).toLocaleDateString();
      console.log(
        `  ${s.agent.padEnd(12)} ${date}  ${size.padStart(8)}KB  ${s.sessionId.slice(0, 8)}...`
      );
    }
  });

program
  .command("preview [session-id]")
  .description("Preview what a session did")
  .option("--latest", "Use the most recent session")
  .option("--agent <agent>", "Filter by agent")
  .action((sessionId, opts) => {
    const sessions = discoverSessions({
      agent: opts.agent,
      limit: 100,
    });
    const target = opts.latest
      ? sessions[0]
      : sessions.find((s) => s.sessionId.startsWith(sessionId));

    if (!target) {
      console.error("Session not found.");
      process.exit(1);
    }

    const parsed = parseSessionFile(target.path, target.agent);
    console.log(`\nSession: ${parsed.sessionId.slice(0, 8)}...`);
    console.log(`Agent:   ${parsed.agent}`);
    console.log(`Project: ${parsed.project}`);
    console.log(`Branch:  ${parsed.branch}`);
    console.log(
      `Messages: ${parsed.summary.userMessages} user, ${parsed.summary.assistantMessages} assistant`
    );
    console.log(
      `Tools:   ${parsed.totalToolCalls} calls (${parsed.summary.uniqueTools.join(", ")})`
    );
    console.log(
      `Tokens:  ${parsed.totalTokens.input} in / ${parsed.totalTokens.output} out`
    );
    console.log(`Files:   ${parsed.filesModified.join(", ") || "none tracked"}`);
  });

program
  .command("distill [session-id]")
  .description("Distill a session into a reusable skill")
  .option("--latest", "Use the most recent session")
  .option("--agent <agent>", "Filter by agent")
  .option("--output <dir>", "Output directory", "./skills")
  .option("--no-llm", "Use template extraction only (no API call)")
  .option("--provider <provider>", "LLM provider (anthropic, openai)", "anthropic")
  .option("--model <model>", "LLM model to use")
  .option("--redact", "Redact detected secrets before sending to the LLM")
  .option("--allow-secrets", "Send session as-is even if secrets are detected (not recommended)")
  .action(async (sessionId, opts) => {
    const sessions = discoverSessions({
      agent: opts.agent,
      limit: 100,
    });
    const target = opts.latest
      ? sessions[0]
      : sessions.find((s) => s.sessionId.startsWith(sessionId));

    if (!target) {
      console.error("Session not found. Run `skillcam list` to see available sessions.");
      process.exit(1);
    }

    console.log(
      `\n✓ Read session ${target.sessionId.slice(0, 8)}... (${target.agent})`
    );

    const parsed = parseSessionFile(target.path, target.agent);
    console.log(
      `✓ Found ${parsed.summary.userMessages} messages, ${parsed.totalToolCalls} tool calls`
    );

    const useLlm = opts.llm !== false;
    const secretPolicy: SecretPolicy = opts.allowSecrets
      ? "allow"
      : opts.redact
        ? "redact"
        : "abort";

    console.log(
      useLlm
        ? `✓ Distilling with ${opts.provider}...`
        : `✓ Distilling with template mode (no LLM)...`
    );

    let skill: string;
    try {
      skill = await distillSkill(parsed, {
        useLlm,
        provider: opts.provider,
        model: opts.model,
        secretPolicy,
        onSecretsDetected: (matches) => {
          if (secretPolicy === "redact") {
            console.warn(`\n⚠ Detected ${matches.length} potential secret(s), redacting before LLM call:`);
            console.warn(summarize(matches));
          } else if (secretPolicy === "allow") {
            console.warn(`\n⚠ Detected ${matches.length} potential secret(s), sending as-is (--allow-secrets):`);
            console.warn(summarize(matches));
          }
        },
      });
    } catch (err) {
      if (err instanceof SecretsDetectedError) {
        console.error(`\n✗ ${err.message}\n`);
        process.exit(2);
      }
      throw err;
    }

    // M4 — cap LLM output size before we ever touch disk. A compromised
    // provider or MITM could otherwise dump gigabytes of text here.
    const truncated = truncateSkill(skill);
    if (truncated !== skill) {
      console.warn(`⚠ LLM output exceeded skill size cap, truncating.`);
      skill = truncated;
    }

    // C1 — sanitize the LLM-controlled filename
    const nameMatch = skill.match(/^name:\s*(.+)$/m);
    const rawName = nameMatch?.[1]?.trim() ?? target.sessionId.slice(0, 8);
    const skillName = sanitizeSkillName(rawName, target.sessionId.slice(0, 8));
    const fileName = `${skillName}.md`;

    mkdirSync(opts.output, { recursive: true });

    // C1 — verify the resolved output path stays inside the output directory
    const outPath = join(opts.output, fileName);
    const resolvedFile = resolve(opts.output, fileName);
    if (!isInsideDirectory(resolvedFile, opts.output)) {
      console.error(
        `✗ Refusing to write outside output directory: ${resolvedFile}`
      );
      process.exit(3);
    }

    // C6 — if outPath already exists as a symlink, refuse. writeFileSync
    // would otherwise follow the link and overwrite its target (/etc/hostname,
    // a .zshrc, whatever). We also pass flag "wx" so a hostile race that
    // plants a file between the lstat and the write still fails.
    try {
      const existing = lstatSync(resolvedFile);
      if (existing.isSymbolicLink()) {
        console.error(
          `✗ Refusing to write to a symlinked path: ${resolvedFile}`
        );
        process.exit(4);
      }
      // If a regular file is already there, we also refuse (M2 overwrite
      // protection without a --force flag).
      if (existing.isFile()) {
        console.error(
          `✗ Output file already exists: ${resolvedFile}\n  Remove it or pick a different --output and retry.`
        );
        process.exit(4);
      }
    } catch (err: unknown) {
      // ENOENT is the happy path — nothing at that path yet.
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== "ENOENT") {
        console.error(`✗ Cannot stat output path: ${resolvedFile}`);
        process.exit(4);
      }
    }

    try {
      writeFileSync(resolvedFile, skill, { flag: "wx" });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "EEXIST") {
        console.error(
          `✗ Output file appeared after check (race): ${resolvedFile}`
        );
        process.exit(4);
      }
      throw err;
    }

    emitEvent({
      run_id: `run_${target.sessionId.slice(0, 8)}`,
      type: "skill.created",
      agent_name: "skillcam",
      attrs: {
        source_session: target.sessionId,
        source_agent: target.agent,
        skill_name: skillName,
        skill_path: outPath,
        token_cost_input: parsed.totalTokens.input,
        token_cost_output: parsed.totalTokens.output,
        distill_mode: useLlm ? "llm" : "template",
      },
    });

    console.log(`✓ Wrote skill to ${outPath}`);
    console.log(`\nYour agent can now reuse this skill in future sessions.`);
  });

program.parse();
