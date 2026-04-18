import { describe, it, expect } from "vitest";
import { sanitizeSkillName, isInsideDirectory } from "../src/path-safety.js";
import { resolve, join, sep } from "path";

describe("sanitizeSkillName (C1)", () => {
  it("keeps alphanumeric, dashes and underscores untouched", () => {
    expect(sanitizeSkillName("my-cool_skill-42", "fallback")).toBe(
      "my-cool_skill-42"
    );
  });

  it("replaces path-traversal characters with dashes", () => {
    // The key regression: an LLM-controlled `name: ../../evil` must not
    // produce a filename that escapes the output directory.
    const raw = "../../evil";
    const cleaned = sanitizeSkillName(raw, "fallback");
    expect(cleaned).not.toContain("/");
    expect(cleaned).not.toContain("..");
    // Every non-alphanumeric char becomes "-", so six chars (../../) → dashes,
    // then the leading-dash strip removes them, leaving just "evil".
    expect(cleaned).toBe("evil");
  });

  it("replaces slashes and dots inside the string", () => {
    // `foo/../bar.md` has 4 non-alphanumeric chars: / . . /  .
    // Each becomes "-", giving foo----bar-md.
    const cleaned = sanitizeSkillName("foo/../bar.md", "fallback");
    expect(cleaned).toBe("foo----bar-md");
    expect(cleaned).not.toContain("/");
    expect(cleaned).not.toContain(".");
  });

  it("clamps to 100 chars", () => {
    const raw = "a".repeat(500);
    const cleaned = sanitizeSkillName(raw, "fallback");
    expect(cleaned.length).toBe(100);
  });

  it("falls back when sanitization leaves empty string", () => {
    expect(sanitizeSkillName("", "fallback-id")).toBe("fallback-id");
    expect(sanitizeSkillName("///", "fallback-id")).toBe("fallback-id");
    expect(sanitizeSkillName("...", "fallback-id")).toBe("fallback-id");
  });

  it("refuses leading dots so result is never a dotfile", () => {
    const cleaned = sanitizeSkillName(".zshrc", "fallback");
    expect(cleaned.startsWith(".")).toBe(false);
  });
});

describe("isInsideDirectory (C1)", () => {
  it("accepts a direct child", () => {
    const dir = resolve("./skills");
    const file = join(dir, "foo.md");
    expect(isInsideDirectory(file, dir)).toBe(true);
  });

  it("rejects a sibling after path traversal", () => {
    const dir = resolve("./skills");
    // Traversal that escapes the output dir
    const file = resolve(dir, "..", "..", "etc", "evil.md");
    expect(isInsideDirectory(file, dir)).toBe(false);
  });

  it("accepts a nested child", () => {
    const dir = resolve("./skills");
    const file = join(dir, "nested", "deep.md");
    expect(isInsideDirectory(file, dir)).toBe(true);
  });

  it("distinguishes /foo-bar from /foo", () => {
    // Prefix check must not pass "/foo-bar" as inside "/foo"
    expect(
      isInsideDirectory(resolve("/tmp/foo-bar/x"), resolve("/tmp/foo"))
    ).toBe(false);
  });
});

describe("C1 end-to-end scenario", () => {
  it("LLM-controlled `name: ../../etc/evil` cannot escape output dir", () => {
    const fallback = "fallback";
    const malicious = "../../etc/evil";
    const clean = sanitizeSkillName(malicious, fallback);
    const outDir = resolve("./skills");
    const finalPath = join(outDir, `${clean}.md`);
    expect(isInsideDirectory(finalPath, outDir)).toBe(true);
    // And the cleaned name is not the raw malicious string
    expect(clean).not.toBe(malicious);
  });
});
