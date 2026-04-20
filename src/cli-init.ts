/**
 * `skillcam init` — install the SkillCam Claude Code skill.
 *
 * Copies the packaged `skills/skillcam-distill/SKILL.md` into the user's
 * `~/.claude/skills/skillcam-distill/` so Claude Code discovers it on next
 * session start. This is the API-key-free path for Claude Code users:
 * distillation runs inside the active Claude session, not via a CLI LLM
 * call.
 *
 * Safety:
 *   - Refuses to overwrite an existing installation unless `--force`.
 *   - Rejects custom `--target` paths that escape `~/.claude/skills/` (no
 *     `../`, no absolute paths outside the skills dir) unless the user
 *     explicitly opts in with `--allow-any-target`.
 *   - `lstat` + symlink rejection on the destination dir before writing.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
} from "fs";
import { join, dirname, resolve, isAbsolute } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

export interface InitOptions {
  force?: boolean;
  target?: string;
  allowAnyTarget?: boolean;
}

export interface InitResult {
  kind: "installed" | "skipped" | "error";
  targetPath: string;
  reason?: string;
}

/**
 * Resolve the packaged SKILL.md path. In an installed npm package, this
 * file sits at `<pkg-root>/skills/skillcam-distill/SKILL.md`; in the source
 * tree, same location. We walk up from the compiled `dist/cli-init.js`
 * location to find the package root (where `package.json` lives).
 */
function findPackagedSkill(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In published package: <pkg>/dist/cli-init.js → walk up to <pkg>.
  // In source: <pkg>/src/cli-init.ts (when run via tsx) → same walk works.
  let dir = here;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "skills", "skillcam-distill", "SKILL.md"))) {
      return join(dir, "skills", "skillcam-distill", "SKILL.md");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate packaged skills/skillcam-distill/SKILL.md. Is the package installed correctly?"
  );
}

/**
 * Default install path: `~/.claude/skills/skillcam-distill/`.
 */
function defaultTarget(): string {
  return join(homedir(), ".claude", "skills", "skillcam-distill");
}

/**
 * Validate a user-supplied target. Must be inside `~/.claude/skills/`
 * unless `allowAnyTarget` is set. Rejects symlinked parent dirs.
 */
function validateTarget(target: string, allowAny: boolean): string {
  const resolved = isAbsolute(target) ? resolve(target) : resolve(process.cwd(), target);

  if (!allowAny) {
    const skillsRoot = resolve(join(homedir(), ".claude", "skills"));
    if (!resolved.startsWith(skillsRoot + "/") && resolved !== skillsRoot) {
      throw new Error(
        `Refusing target outside ~/.claude/skills/: ${resolved}\n` +
        `Pass --allow-any-target to override (not recommended).`
      );
    }
  }

  // Reject symlinked parent dirs. We have to separate the lstat call from
  // the throw — otherwise the catch swallows the intentional throw.
  const parent = dirname(resolved);
  let parentIsSymlink = false;
  if (existsSync(parent)) {
    try {
      parentIsSymlink = lstatSync(parent).isSymbolicLink();
    } catch {
      // lstat failed — parent exists per existsSync but can't be stat'd;
      // let mkdir surface a real errno later.
    }
  }
  if (parentIsSymlink) {
    throw new Error(`Parent dir is a symlink, refusing: ${parent}`);
  }

  return resolved;
}

export function runInit(opts: InitOptions): InitResult {
  const sourcePath = findPackagedSkill();
  const targetDir = opts.target
    ? validateTarget(opts.target, opts.allowAnyTarget ?? false)
    : defaultTarget();
  const targetFile = join(targetDir, "SKILL.md");

  if (existsSync(targetFile) && !opts.force) {
    return {
      kind: "skipped",
      targetPath: targetFile,
      reason: `already installed — pass --force to overwrite`,
    };
  }

  // Reject if targetFile is a symlink (we would follow it on write).
  if (existsSync(targetFile)) {
    try {
      const st = lstatSync(targetFile);
      if (st.isSymbolicLink()) {
        return {
          kind: "error",
          targetPath: targetFile,
          reason: "existing file is a symlink; refusing to overwrite",
        };
      }
    } catch {
      // fall through
    }
  }

  mkdirSync(targetDir, { recursive: true });
  const content = readFileSync(sourcePath, "utf-8");
  writeFileSync(targetFile, content, { encoding: "utf-8" });

  return { kind: "installed", targetPath: targetFile };
}
