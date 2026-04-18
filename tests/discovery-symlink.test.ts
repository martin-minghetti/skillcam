import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Redirect os.homedir() to a temp dir so discovery uses our fake trust root.
// ESM forbids spyOn of module namespace exports, so we mock the module instead.
let fakeHome = "";
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => fakeHome,
  };
});

describe("discoverSessions — symlink skipping (C5)", () => {
  let outsideFile: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "skillcam-sym-"));
    const projectDir = join(fakeHome, ".claude", "projects", "myproject");
    mkdirSync(projectDir, { recursive: true });

    // A real session file
    writeFileSync(join(projectDir, "real.jsonl"), "{}\n");

    // A symlink pointing at another real file in the same dir
    symlinkSync(join(projectDir, "real.jsonl"), join(projectDir, "link.jsonl"));

    // A symlink pointing OUTSIDE the trust root
    const outsideDir = mkdtempSync(join(tmpdir(), "skillcam-outside-"));
    outsideFile = join(outsideDir, "evil.jsonl");
    writeFileSync(outsideFile, "{}\n");
    symlinkSync(outsideFile, join(projectDir, "outside-link.jsonl"));
  });

  afterEach(() => {
    try {
      rmSync(fakeHome, { recursive: true, force: true });
    } catch {}
    try {
      rmSync(outsideFile, { force: true });
    } catch {}
  });

  it("returns only the regular file, skipping both symlinks", async () => {
    const { discoverSessions } = await import("../src/discovery.js");
    const sessions = discoverSessions({ agent: "claude-code", limit: 50 });

    // Filter to our fake home so the test is not flaky if the CI runner
    // happens to have a real ~/.claude with sessions.
    const ours = sessions.filter((s) => s.path.startsWith(fakeHome));
    expect(ours).toHaveLength(1);
    expect(ours[0]!.path.endsWith("real.jsonl")).toBe(true);
    expect(ours.find((s) => s.path.endsWith("link.jsonl"))).toBeUndefined();
    expect(
      ours.find((s) => s.path.endsWith("outside-link.jsonl"))
    ).toBeUndefined();
  });
});
