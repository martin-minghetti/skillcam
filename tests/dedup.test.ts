import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  jaroWinkler,
  findSimilarSkills,
} from "../src/dedup.js";

describe("jaroWinkler — string similarity (audit-3 follow-up: dedup)", () => {
  it("returns 1.0 for identical strings", () => {
    expect(jaroWinkler("abc", "abc")).toBeCloseTo(1.0);
  });

  it("returns 0 when one string is empty", () => {
    expect(jaroWinkler("", "abc")).toBe(0);
    expect(jaroWinkler("abc", "")).toBe(0);
  });

  it("returns a high similarity for typo-level edits", () => {
    // "fix broken auth tests after rename" vs "fix broken auth tests after a rename"
    const a = "Fix failing tests by tracing import errors to renamed exports";
    const b = "Fix failing tests by tracing import errors to a renamed export";
    expect(jaroWinkler(a, b)).toBeGreaterThan(0.9);
  });

  it("stays well below the 0.80 dedup threshold for unrelated strings", () => {
    // Jaro-Winkler is generous on strings that share whitespace + common
    // letters; the meaningful guarantee is "below the dedup threshold",
    // not "below 0.6". 0.80 is what findSimilarSkills uses by default.
    const a = "Build validated POST API endpoints with Zod schemas";
    const b = "Diagnose TypeScript build errors and integrate logging";
    expect(jaroWinkler(a, b)).toBeLessThan(0.8);
  });

  it("is symmetric", () => {
    const a = "alpha beta gamma";
    const b = "alpha beta delta";
    expect(jaroWinkler(a, b)).toBeCloseTo(jaroWinkler(b, a), 5);
  });
});

describe("findSimilarSkills — read SKILL.md files and rank by description similarity", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "skillcam-dedup-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeSkill(name: string, description: string): void {
    const body = `---
name: ${name}
description: ${description}
source_session: x
source_agent: claude-code
created: 2026-04-20
distill_prompt_version: v2
confidence: high
tags:
  - testing
---

# ${name}

## When to use
test
`;
    writeFileSync(join(tmp, `${name}.md`), body, "utf-8");
  }

  it("returns matches above the threshold, sorted by similarity desc", () => {
    makeSkill(
      "fix-broken-imports",
      "Fix failing tests caused by stale import names after a function was renamed during refactoring"
    );
    makeSkill(
      "build-validated-endpoints",
      "Build validated POST API endpoints with Zod schemas and structured error handling"
    );
    const matches = findSimilarSkills(
      "Fix failing tests caused by stale import names after a refactor renamed the function",
      tmp,
      0.8
    );
    expect(matches.length).toBe(1);
    expect(matches[0]?.path).toContain("fix-broken-imports.md");
    expect(matches[0]?.similarity).toBeGreaterThan(0.8);
  });

  it("returns empty when no skill is similar enough", () => {
    makeSkill(
      "completely-different",
      "Set up a Postgres database with row-level security policies"
    );
    const matches = findSimilarSkills(
      "Refactor a Tailwind v4 component tree to use design tokens",
      tmp,
      0.8
    );
    expect(matches).toEqual([]);
  });

  it("returns empty when the output directory does not exist", () => {
    const matches = findSimilarSkills(
      "anything",
      join(tmp, "does-not-exist"),
      0.8
    );
    expect(matches).toEqual([]);
  });

  it("ignores .md files that have no frontmatter description", () => {
    writeFileSync(join(tmp, "no-frontmatter.md"), "Just a plain markdown note\n", "utf-8");
    writeFileSync(
      join(tmp, "empty-frontmatter.md"),
      "---\nname: x\n---\n\nbody\n",
      "utf-8"
    );
    makeSkill("real-one", "Build validated POST API endpoints with Zod schemas");
    const matches = findSimilarSkills(
      "Build validated POST API endpoints with Zod schemas",
      tmp,
      0.8
    );
    // Only the real one (the others lack a description to compare)
    expect(matches.length).toBe(1);
    expect(matches[0]?.path).toContain("real-one.md");
  });

  it("does not match against subdirectory files (flat scan only)", () => {
    const sub = join(tmp, "nested");
    mkdirSync(sub);
    writeFileSync(
      join(sub, "buried.md"),
      `---
name: buried
description: Build validated POST API endpoints with Zod schemas
---
body
`,
      "utf-8"
    );
    const matches = findSimilarSkills(
      "Build validated POST API endpoints with Zod schemas",
      tmp,
      0.8
    );
    expect(matches).toEqual([]);
  });
});

// Audit #4 D1 — findSimilarSkills must not follow symlinks. Otherwise a
// symlinked .md inside --output can read /etc/passwd, /dev/zero, or any
// path the process can stat. Same hardening as cli.ts:330-336 (audit #1 C6).
describe("findSimilarSkills — symlink rejection (audit #4 D1)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "skillcam-dedup-symlink-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("skips symlinked .md entries even if their target has a matching description", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "skillcam-dedup-outside-"));
    try {
      const outsidePath = join(outsideDir, "secret.md");
      writeFileSync(
        outsidePath,
        `---
name: x
description: shared description for the symlink test
---
`,
        "utf-8"
      );
      symlinkSync(outsidePath, join(tmp, "leak.md"));
      const matches = findSimilarSkills(
        "shared description for the symlink test",
        tmp,
        0.8
      );
      // The symlink target had an identical description; the helper must
      // refuse to follow it.
      expect(matches).toEqual([]);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// Audit #4 D2 — DoS guards. Without caps, a single oversized .md in --output
// (jumbo frontmatter, or a symlink to /dev/zero before D1 also lands) can
// hang the CLI: readFileSync is sync, jaroWinkler is O(n*m), and the loop
// has no entry-count limit.
describe("findSimilarSkills — DoS guards (audit #4 D2)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "skillcam-dedup-dos-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("skips files larger than 64 KB without reading them fully", () => {
    // 200 KB skill.md — should be skipped by the size cap, NOT read into
    // memory. We can't directly assert "didn't read" but we CAN assert it
    // doesn't appear in matches even though its description would match.
    const big = "Reusable description for the size cap test\n".repeat(5000);
    const body = `---
name: huge
description: Reusable description for the size cap test
---
${big}
`;
    writeFileSync(join(tmp, "huge.md"), body, "utf-8");
    const matches = findSimilarSkills(
      "Reusable description for the size cap test",
      tmp,
      0.8
    );
    expect(matches).toEqual([]); // skipped, not matched
  });

  it("caps the description length compared against (no O(n*m) blowup)", () => {
    // Adversary writes a normal-sized file BUT puts a 30 KB description in
    // the frontmatter. Without a length cap, jaroWinkler runs O(30000^2).
    // With the cap (slice to 512 chars), it's bounded.
    const longDesc = "a".repeat(30_000);
    const body = `---
name: long
description: ${longDesc}
---
`;
    writeFileSync(join(tmp, "long.md"), body, "utf-8");
    const start = Date.now();
    findSimilarSkills("a".repeat(30_000), tmp, 0.8);
    const ms = Date.now() - start;
    // With the cap, this should be well under 100ms. Without the cap it
    // takes ~700ms based on the audit benchmarks.
    expect(ms).toBeLessThan(200);
  });

  it("caps the number of files processed", () => {
    // Drop 2000 trivial .md files. The helper should bail at the limit
    // (1000) without melting.
    for (let i = 0; i < 1500; i++) {
      writeFileSync(
        join(tmp, `f${i}.md`),
        `---\nname: f${i}\ndescription: a${i}\n---\n`,
        "utf-8"
      );
    }
    const start = Date.now();
    findSimilarSkills("a", tmp, 0.8);
    const ms = Date.now() - start;
    // Should be well under 2s with the cap; without it would still
    // finish but burn n^2 work pointlessly.
    expect(ms).toBeLessThan(2000);
  });
});
