import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { AgentEvent } from "./types.js";

export function emitEvent(
  event: Omit<AgentEvent, "schema_version" | "event_id" | "ts">,
  eventsDir: string = "./agents/_core"
): void {
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
