import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR = join(homedir(), ".skillcam");
const CACHE_FILE = join(CACHE_DIR, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://registry.npmjs.org/skillcam/latest";
const REGISTRY_TIMEOUT_MS = 2000;

type CacheEntry = {
  latest: string;
  checkedAt: number;
};

function shouldSkip(): boolean {
  if (process.env.NO_UPDATE_NOTIFIER === "1") return true;
  if (process.env.SKILLCAM_SKIP_UPDATE_CHECK === "1") return true;
  if (process.env.CI) return true;
  if (process.env.NODE_ENV === "test") return true;
  if (!process.stdout.isTTY) return true;
  // npx already resolves the latest version on each run; nagging is noise.
  if ((process.env.npm_execpath ?? "").includes("npx")) return true;
  return false;
}

function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isNewer(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    const a = l[i] as number;
    const b = c[i] as number;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/**
 * Exported for tests. Production callers omit the path args.
 */
export function readCache(file: string = CACHE_FILE): CacheEntry | null {
  try {
    const raw = readFileSync(file, "utf-8");
    const data = JSON.parse(raw) as unknown;
    if (
      typeof data === "object" &&
      data !== null &&
      typeof (data as CacheEntry).latest === "string" &&
      typeof (data as CacheEntry).checkedAt === "number"
    ) {
      return data as CacheEntry;
    }
  } catch {
    // Malformed or missing cache — treat as cold start.
  }
  return null;
}

/**
 * Exported for tests. Production callers omit the path args.
 */
export function writeCache(
  entry: CacheEntry,
  file: string = CACHE_FILE,
  dir: string = CACHE_DIR
): void {
  // U1 — write atomically via tmp + rename so a planted symlink at `file`
  // never gets followed. With O_EXCL on the tmp file (`flag: "wx"`), even a
  // TOCTOU race that pre-plants the tmp path fails. The final renameSync
  // removes whatever was at `file` (regular file, symlink) without writing
  // through it.
  //
  // U4 — mkdirSync only applies `mode` at creation. If `dir` already
  // existed as 0o777 (e.g. another process created it), enforce 0o700 now.
  let tmp: string | null = null;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // best-effort: on platforms where chmod is a no-op (Windows), skip.
    }
    tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
    tmp = null;
  } catch {
    // Cache is a best-effort optimization; losing it is harmless.
  } finally {
    // If rename failed but the tmp file landed on disk, clean it up so we
    // don't pollute `dir` with leftovers.
    if (tmp !== null) {
      try {
        unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
  }
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const version = (data as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function registerNotification(current: string, latest: string): void {
  if (!isNewer(latest, current)) return;
  process.on("beforeExit", () => {
    const lines = [
      "",
      `  Update available: ${current} → ${latest}`,
      `  Run: npm i -g skillcam@latest`,
      `  Changelog: https://github.com/martin-minghetti/skillcam/releases`,
      "",
    ];
    console.error(lines.join("\n"));
  });
}

export function scheduleUpdateCheck(currentVersion: string): void {
  if (shouldSkip()) return;

  const cached = readCache();
  const now = Date.now();
  const isFresh = cached !== null && now - cached.checkedAt < CACHE_TTL_MS;

  if (isFresh && cached) {
    registerNotification(currentVersion, cached.latest);
    return;
  }

  void fetchLatest().then((latest) => {
    if (!latest) return;
    writeCache({ latest, checkedAt: now });
    registerNotification(currentVersion, latest);
  });
}
