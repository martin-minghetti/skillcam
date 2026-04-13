import { readdirSync, statSync } from "fs";
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

function findClaudeCodeSessions(): DiscoveredSession[] {
  const baseDir = join(homedir(), ".claude", "projects");
  const sessions: DiscoveredSession[] = [];

  try {
    const projectDirs = readdirSync(baseDir);
    for (const dir of projectDirs) {
      const projectPath = join(baseDir, dir);
      try {
        const files = readdirSync(projectPath).filter((f) =>
          f.endsWith(".jsonl")
        );
        for (const file of files) {
          const fullPath = join(projectPath, file);
          const stat = statSync(fullPath);
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
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith(".jsonl")) {
          const stat = statSync(fullPath);
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
