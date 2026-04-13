#!/usr/bin/env node
import { program } from "commander";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { discoverSessions } from "./discovery.js";
import { parseClaudeCodeSession } from "./parsers/claude-code.js";
import { parseCodexSession } from "./parsers/codex.js";
import { distillSkill } from "./distiller.js";
import { emitEvent } from "./events/emit.js";
import type { ParsedSession } from "./parsers/types.js";

function parseSessionFile(
  path: string,
  agent: "claude-code" | "codex"
): ParsedSession {
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
    console.log(
      useLlm
        ? `✓ Distilling with ${opts.provider}...`
        : `✓ Distilling with template mode (no LLM)...`
    );

    const skill = await distillSkill(parsed, {
      useLlm,
      provider: opts.provider,
      model: opts.model,
    });

    // Extract name from generated skill
    const nameMatch = skill.match(/^name:\s*(.+)$/m);
    const skillName = nameMatch?.[1]?.trim() ?? target.sessionId.slice(0, 8);
    const fileName = `${skillName}.md`;

    mkdirSync(opts.output, { recursive: true });
    const outPath = join(opts.output, fileName);
    writeFileSync(outPath, skill);

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
