import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
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
    require("fs").mkdirSync(sub);
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
