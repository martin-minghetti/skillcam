import { readdirSync, lstatSync, type Stats } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

export interface DiscoveredSession {
  sessionId: string;
  agent: "claude-code" | "codex";
  path: string;
  modifiedAt: string;
  sizeBytes: number;
}

interface DiscoverOptions {
  agent?: "claude-code" | "codex";
  limit?: number;
}

/**
 * C5 — use lstatSync (not statSync) so we see the link itself, not the target.
 * Symlinks are skipped silently: they may be benign but they let an attacker
 * with disk access point a .jsonl name at /etc/passwd or at a file outside the
 * trust root. trust-root confinement is enforced at read time in cli.ts.
 */
function statIfRegularFile(path: string): Stats | null {
  try {
    const st = lstatSync(path) as Stats;
    if (st.isSymbolicLink()) return null;
    if (!st.isFile()) return null;
    return st;
  } catch {
    return null;
  }
}

function findClaudeCodeSessions(): DiscoveredSession[] {
  const baseDir = join(homedir(), ".claude", "projects");
  const sessions: DiscoveredSession[] = [];

  try {
    const projectDirs = readdirSync(baseDir);
    for (const dir of projectDirs) {
      const projectPath = join(baseDir, dir);
      // C5 — skip symlinked project directories too
      try {
        const dirStat = lstatSync(projectPath);
        if (dirStat.isSymbolicLink()) continue;
        if (!dirStat.isDirectory()) continue;
      } catch {
        continue;
      }

      try {
        const files = readdirSync(projectPath).filter((f) =>
          f.endsWith(".jsonl")
        );
        for (const file of files) {
          const fullPath = join(projectPath, file);
          const stat = statIfRegularFile(fullPath);
          if (!stat) continue; // symlinks / non-files silently skipped
          sessions.push({
            sessionId: basename(file, ".jsonl"),
            agent: "claude-code",
            path: fullPath,
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
          });
        }
      } catch {
        // skip unreadable dirs
      }
    }
  } catch {
    // ~/.claude/projects doesn't exist
  }

  return sessions;
}

function findCodexSessions(): DiscoveredSession[] {
  const baseDir = join(homedir(), ".codex", "sessions");
  const sessions: DiscoveredSession[] = [];

  function walkDir(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        // C5 — Dirent.isDirectory()/isFile() uses lstat semantics for name
        // entries; symbolic links report isSymbolicLink()=true here, so
        // recursing only into isDirectory() already excludes symlinked dirs.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const stat = statIfRegularFile(fullPath);
          if (!stat) continue;
          sessions.push({
            sessionId: basename(entry.name, ".jsonl"),
            agent: "codex",
            path: fullPath,
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
          });
        }
      }
    } catch {
      // skip
    }
  }

  walkDir(baseDir);
  return sessions;
}

export function discoverSessions(
  options: DiscoverOptions = {}
): DiscoveredSession[] {
  const { agent, limit = 20 } = options;
  let sessions: DiscoveredSession[] = [];

  if (!agent || agent === "claude-code") {
    sessions.push(...findClaudeCodeSessions());
  }
  if (!agent || agent === "codex") {
    sessions.push(...findCodexSessions());
  }

  sessions.sort(
    (a, b) =>
      new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  );

  return sessions.slice(0, limit);
}
