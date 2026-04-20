import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { emitEvent } from "../src/events/emit.js";

describe("emitEvent", () => {
  let tmp: string;
  const ORIGINAL_ENV = process.env.SKILLCAM_NO_EVENTS;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "skillcam-events-"));
    delete process.env.SKILLCAM_NO_EVENTS;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (ORIGINAL_ENV === undefined) delete process.env.SKILLCAM_NO_EVENTS;
    else process.env.SKILLCAM_NO_EVENTS = ORIGINAL_ENV;
  });

  it("appends a JSONL line with schema_version, event_id, ts, plus the supplied fields", () => {
    emitEvent(
      {
        run_id: "run_abc",
        type: "skill.created",
        agent_name: "skillcam",
        attrs: { foo: 1 },
      },
      tmp
    );
    const file = join(tmp, "events.jsonl");
    expect(existsSync(file)).toBe(true);
    const line = readFileSync(file, "utf-8").trim();
    const evt = JSON.parse(line);
    expect(evt.schema_version).toBe("0.1");
    expect(evt.event_id).toMatch(/^evt_/);
    expect(typeof evt.ts).toBe("string");
    expect(evt.run_id).toBe("run_abc");
    expect(evt.type).toBe("skill.created");
  });

  // v0.4.3 — opt-out env var. Some users (CI, sandboxed envs, audit-conscious
  // ops) want zero side effects on disk beyond the SKILL.md write itself.
  it("skips the write entirely when SKILLCAM_NO_EVENTS=1", () => {
    process.env.SKILLCAM_NO_EVENTS = "1";
    emitEvent(
      {
        run_id: "run_xyz",
        type: "skill.created",
        agent_name: "skillcam",
        attrs: {},
      },
      tmp
    );
    const file = join(tmp, "events.jsonl");
    expect(existsSync(file)).toBe(false);
  });

  it("respects SKILLCAM_NO_EVENTS=1 even when the dir already exists", () => {
    process.env.SKILLCAM_NO_EVENTS = "1";
    // Pre-create the dir to make sure the skip is at the writeline level,
    // not just at the mkdir level.
    require("fs").mkdirSync(tmp, { recursive: true });
    emitEvent(
      {
        run_id: "run_xyz",
        type: "skill.created",
        agent_name: "skillcam",
        attrs: {},
      },
      tmp
    );
    expect(existsSync(join(tmp, "events.jsonl"))).toBe(false);
  });

  it("writes when SKILLCAM_NO_EVENTS is anything other than '1' (strict opt-out)", () => {
    // We don't want sloppy truthiness ("0", "false", "no") to suppress events
    // by accident — only the explicit "1" opts out. This matches the existing
    // SKILLCAM_SKIP_UPDATE_CHECK convention.
    process.env.SKILLCAM_NO_EVENTS = "0";
    emitEvent(
      {
        run_id: "run_keeps",
        type: "skill.created",
        agent_name: "skillcam",
        attrs: {},
      },
      tmp
    );
    expect(existsSync(join(tmp, "events.jsonl"))).toBe(true);
  });
});
