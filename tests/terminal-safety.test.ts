import { describe, it, expect } from "vitest";
import {
  sanitizeForTerminal,
  sanitizeListForTerminal,
} from "../src/terminal-safety.js";

describe("sanitizeForTerminal (A1)", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(sanitizeForTerminal("/Users/me/projects/foo")).toBe(
      "/Users/me/projects/foo"
    );
  });

  it("preserves printable Unicode", () => {
    expect(sanitizeForTerminal("café-naïve-résumé-日本語")).toBe(
      "café-naïve-résumé-日本語"
    );
  });

  it("strips ESC (\\x1b) — entry to all CSI/OSC/SS3 sequences", () => {
    expect(sanitizeForTerminal("/tmp\x1b[31mRED\x1b[0m")).toBe(
      "/tmp[31mRED[0m"
    );
  });

  it("strips clear-screen + cursor-home (full attack from audit)", () => {
    const attack = "/tmp\x1b[2J\x1b[H\x1b[31mFAKE_PROJECT";
    const out = sanitizeForTerminal(attack);
    expect(out).not.toContain("\x1b");
    expect(out).toBe("/tmp[2J[H[31mFAKE_PROJECT");
  });

  it("strips OSC sequence (terminal title set)", () => {
    expect(sanitizeForTerminal("name\x1b]0;HACKED\x07cont")).toBe(
      "name]0;HACKEDcont"
    );
  });

  it("strips newlines so single-line fields stay single-line", () => {
    expect(sanitizeForTerminal("line1\nline2\rline3")).toBe(
      "line1line2line3"
    );
  });

  it("strips tab and other C0 controls", () => {
    expect(sanitizeForTerminal("a\tb\x00c\x07d")).toBe("abcd");
  });

  it("strips DEL and C1 controls", () => {
    expect(sanitizeForTerminal("x\x7fy\x9bz")).toBe("xyz");
  });

  it("returns empty string for an all-control input", () => {
    expect(sanitizeForTerminal("\x1b\x1b\x1b\x00\n")).toBe("");
  });
});

describe("sanitizeListForTerminal (A1)", () => {
  it("sanitizes each item in a list", () => {
    expect(
      sanitizeListForTerminal(["clean", "dirty\x1b[Xevil", "tab\there"])
    ).toEqual(["clean", "dirty[Xevil", "tabhere"]);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeListForTerminal([])).toEqual([]);
  });
});
