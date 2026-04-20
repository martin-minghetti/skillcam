import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { AgentEvent } from "./types.js";

export function emitEvent(
  event: Omit<AgentEvent, "schema_version" | "event_id" | "ts">,
  eventsDir: string = "./agents/_core"
): void {
  // v0.4.3 — explicit opt-out for users who want zero side effects on disk
  // beyond the SKILL.md write itself (CI, sandboxed envs, audit-conscious
  // ops). Strict "1" only — matches SKILLCAM_SKIP_UPDATE_CHECK convention,
  // avoids sloppy-truthy traps like "0" / "false" suppressing by accident.
  if (process.env.SKILLCAM_NO_EVENTS === "1") return;

  const full: AgentEvent = {
    schema_version: "0.1",
    event_id: `evt_${randomUUID().slice(0, 12)}`,
    ts: new Date().toISOString(),
    ...event,
  };

  mkdirSync(eventsDir, { recursive: true });
  const eventsFile = join(eventsDir, "events.jsonl");
  appendFileSync(eventsFile, JSON.stringify(full) + "\n");
}
