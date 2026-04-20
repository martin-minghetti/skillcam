import { readdirSync, readFileSync, statSync, lstatSync } from "fs";
import { join } from "path";

// Audit #4 D2 — DoS guards. Without these, a single oversized .md or a
// large dir of trivial .md files can hang the CLI. The thresholds are
// generous for legit content (skill descriptions are <140 chars; flat
// `./skills/` dirs in the wild have <100 entries) and tight enough that
// O(n*m) work is bounded.
const MAX_SKILL_FILE_SIZE = 64 * 1024;          // 64 KB per file
const MAX_DESCRIPTION_LEN = 512;                // chars compared in jaroWinkler
const MAX_FILES_SCANNED = 1000;                 // entries processed per call

/**
 * v0.4.3 I3 — strict parser for the `--dedup-threshold` CLI flag.
 *
 * Previously cli.ts used `parseFloat(input)` which silently accepts:
 *   - "0.8junk" → 0.8 (trailing garbage swallowed)
 *   - "abc"     → NaN (treated by the CLI as "skip dedup", no warning)
 *   - "2"       → 2   (out of range, no match possible)
 *   - "-1"      → -1  (out of range, every skill matches)
 *
 * Now: `Number(input)` (rejects partial trailers), explicit NaN/Infinity
 * check, hard `[0, 1]` range. Throws with a descriptive message so the
 * CLI can surface it instead of skipping the check silently.
 */
export function parseDedupThreshold(input: string): number {
  if (input.length === 0) {
    throw new Error("dedup-threshold: empty value (expected a number in [0, 1])");
  }
  // Audit #5 C1 — never reflect the raw input into the Error.message.
  // The CLI forwards Error.message to console.error; a hostile value with
  // ANSI escapes or control bytes would otherwise execute as terminal
  // commands when printed. Generic message instead.
  const n = Number(input);
  if (!Number.isFinite(n)) {
    throw new Error(
      "dedup-threshold: not a finite number (expected a number in [0, 1])"
    );
  }
  if (n < 0 || n > 1) {
    throw new Error(
      `dedup-threshold: ${n} is out of range (expected a number in [0, 1])`
    );
  }
  return n;
}

/**
 * v0.4.1 — Pre-write dedup against an output directory of existing skills.
 *
 * The judge tells us a session is "distillable", but two productive
 * sessions on the same problem will produce two near-identical skills.
 * Without a check, the user's `./skills/` slowly fills with overlapping
 * patterns under different names. This module computes Jaro-Winkler
 * similarity between the new skill's `description` and every existing
 * skill's `description` in the output directory, and surfaces matches
 * above a threshold so the CLI can decide what to do.
 *
 * Why Jaro-Winkler and not Levenshtein:
 *   - Better behavior on short strings (skill descriptions are 1-2 lines).
 *   - Boosts matches that share a common prefix, which is exactly the
 *     shape near-duplicates take ("Fix failing tests by ..." vs "Fix
 *     failing tests because ...").
 *   - O(n*m), no external dependency.
 */

/**
 * Jaro distance — counts character matches within a sliding window plus
 * transpositions. Returns a value in [0, 1].
 */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - matchDistance);
    const hi = Math.min(b.length - 1, i + matchDistance);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const t = transpositions / 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

/**
 * Jaro-Winkler — Jaro plus a prefix bonus (max 4 chars, scale 0.1).
 * Case-insensitive: both inputs are lowercased before comparison.
 */
export function jaroWinkler(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  const j = jaro(aLow, bLow);
  if (j < 0.7) return j;

  let prefix = 0;
  const max = Math.min(4, aLow.length, bLow.length);
  for (let i = 0; i < max; i++) {
    if (aLow[i] !== bLow[i]) break;
    prefix++;
  }
  return j + 0.1 * prefix * (1 - j);
}

export interface SimilarSkill {
  path: string;
  description: string;
  similarity: number;
}

/**
 * Extract `description` from a SKILL.md frontmatter block. Returns null if
 * the file has no frontmatter or no description field. Forgiving: any
 * leading/trailing whitespace, quoted values, etc.
 */
function extractDescription(text: string): string | null {
  // Frontmatter lives between two --- lines at the very start of the file.
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  // Match `description: <value>` line. Value may be quoted; we trim quotes
  // at the boundaries only.
  for (const line of block.split("\n")) {
    const m = line.match(/^description:\s*(.+?)\s*$/);
    if (!m || !m[1]) continue;
    let v = m[1];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v.length > 0 ? v : null;
  }
  return null;
}

/**
 * Scan `outputDir` (flat, non-recursive) for `.md` files, compare each
 * one's frontmatter `description` to `newDescription` via Jaro-Winkler,
 * and return matches at or above `threshold`, sorted by similarity desc.
 *
 * Tolerant of:
 *  - Missing directory (returns []).
 *  - Files without frontmatter or without a description field (skipped).
 *  - Empty descriptions (skipped).
 *
 * Does NOT recurse into subdirectories — keeps the check fast and the
 * mental model simple.
 */
export function findSimilarSkills(
  newDescription: string,
  outputDir: string,
  threshold = 0.8
): SimilarSkill[] {
  if (!newDescription) return [];
  let entries: string[];
  try {
    entries = readdirSync(outputDir);
  } catch {
    return [];
  }

  // Audit #4 D2 — cap entries scanned. Bail early once we hit the limit.
  const limited = entries.length > MAX_FILES_SCANNED
    ? entries.slice(0, MAX_FILES_SCANNED)
    : entries;
  // Audit #4 D2 — cap the description we compare against so jaroWinkler
  // (O(n*m)) stays bounded regardless of input size.
  const newDescBounded =
    newDescription.length > MAX_DESCRIPTION_LEN
      ? newDescription.slice(0, MAX_DESCRIPTION_LEN)
      : newDescription;

  const matches: SimilarSkill[] = [];
  for (const name of limited) {
    if (!name.endsWith(".md")) continue;
    const full = join(outputDir, name);

    // Audit #4 D1 — refuse to follow symlinks. lstat reports the symlink
    // itself, not its target. Otherwise a symlinked .md inside outputDir
    // could read /etc/passwd, /dev/zero, or any path the process can stat.
    let ls;
    try {
      ls = lstatSync(full);
    } catch {
      continue;
    }
    if (ls.isSymbolicLink()) continue;
    if (!ls.isFile()) continue;

    // Audit #4 D2 — size cap. statSync on a non-symlink is the file itself
    // here (we already rejected symlinks above). 64 KB is generous for a
    // legit SKILL.md and tight enough to prevent OOM on hostile content.
    if (ls.size > MAX_SKILL_FILE_SIZE) continue;

    let text: string;
    try {
      text = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const desc = extractDescription(text);
    if (!desc) continue;

    const descBounded = desc.length > MAX_DESCRIPTION_LEN
      ? desc.slice(0, MAX_DESCRIPTION_LEN)
      : desc;
    const sim = jaroWinkler(newDescBounded, descBounded);
    if (sim >= threshold) {
      matches.push({ path: full, description: desc, similarity: sim });
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}
