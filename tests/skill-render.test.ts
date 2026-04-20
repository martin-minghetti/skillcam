import { describe, it, expect } from "vitest";
import {
  parseDistillPayload,
  renderSkillMarkdown,
  DISTILL_PROMPT_VERSION,
  ALLOWED_TAGS,
} from "../src/skill-render.js";

// v0.4.3 I2 — description must be normalized to a single line. The dedup
// extractor reads only the first physical line of `description:` in the
// frontmatter, and the YAML format itself is ambiguous if a value
// contains a raw newline without a block-scalar marker. The renderer is
// the right place to enforce this — no `description:` value with embedded
// newlines should ever hit disk.
describe("renderSkillMarkdown — single-line description (v0.4.3 I2)", () => {
  function basePayload() {
    return {
      name: "x",
      description: "PLACEHOLDER",
      when_to_use: "when",
      steps: ["s1"],
      example: "ex",
      key_decisions: ["d1"],
      tags: ["testing"],
      confidence: "high" as const,
      why_this_worked: "why",
    };
  }
  const ctx = {
    sessionId: "sess",
    agent: "claude-code",
    createdISO: "2026-04-20",
  };

  it("collapses embedded \\n in description to a single space", () => {
    const md = renderSkillMarkdown(
      { ...basePayload(), description: "first line\nsecond line" },
      ctx
    );
    const descLine = md.split("\n").find((l) => l.startsWith("description:"));
    expect(descLine).toBe("description: first line second line");
  });

  it("collapses \\r\\n and \\r the same way", () => {
    const md = renderSkillMarkdown(
      { ...basePayload(), description: "first\r\nsecond\rthird" },
      ctx
    );
    const descLine = md.split("\n").find((l) => l.startsWith("description:"));
    expect(descLine).toBe("description: first second third");
  });

  it("strips ANSI escape bytes — the [31m literal that follows is plain ASCII and stays", () => {
    const md = renderSkillMarkdown(
      { ...basePayload(), description: "ok\x1b[31mevil\x1b[0m" },
      ctx
    );
    const descLine = md.split("\n").find((l) => l.startsWith("description:"));
    // The crucial guarantee: no \x1b byte survives. The bracketed remainder
    // is plain ASCII and renders as visible text in any terminal.
    expect(descLine).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(descLine).toContain("evil");
  });

  it("collapses runs of whitespace to a single space", () => {
    const md = renderSkillMarkdown(
      { ...basePayload(), description: "lots   of    spaces\n   and\ttabs" },
      ctx
    );
    const descLine = md.split("\n").find((l) => l.startsWith("description:"));
    expect(descLine).toBe("description: lots of spaces and tabs");
  });

  it("leaves single-line descriptions untouched (no spurious changes)", () => {
    const md = renderSkillMarkdown(
      { ...basePayload(), description: "Fix failing tests after a rename" },
      ctx
    );
    const descLine = md.split("\n").find((l) => l.startsWith("description:"));
    expect(descLine).toBe("description: Fix failing tests after a rename");
  });
});

// Audit #5 N1 — parseDistillPayload validated description with .trim() only,
// pre-normalize. A control-byte-only string survives trim (e.g. "\u001b   "
// trims to "\u001b", non-empty), passes the "required field" check, and
// then renderSkillMarkdown normalizes it to "". Result: description: blank
// on disk, dedup downstream skips this skill, schema contract broken.
// Validation must run AFTER normalize.
describe("parseDistillPayload — description must be non-empty post-normalize (audit #5 N1)", () => {
  it("rejects a description that's all control bytes (would normalize to empty)", () => {
    const raw = JSON.stringify({
      name: "x",
      description: "\u001b   \u0007",
      when_to_use: "when",
      steps: ["s"],
      example: "ex",
      key_decisions: ["d"],
      tags: ["testing"],
      confidence: "high",
      why_this_worked: "why",
    });
    expect(() => parseDistillPayload(raw, "fb")).toThrow(/description/i);
  });

  it("rejects a description that's all whitespace + controls", () => {
    const raw = JSON.stringify({
      name: "x",
      description: "\n\t\r  \u0080",
      when_to_use: "when",
      steps: ["s"],
      example: "ex",
      key_decisions: ["d"],
      tags: ["testing"],
      confidence: "high",
      why_this_worked: "why",
    });
    expect(() => parseDistillPayload(raw, "fb")).toThrow(/description/i);
  });

  it("accepts a description with a control byte in the middle (normalizes to a real string)", () => {
    const raw = JSON.stringify({
      name: "x",
      description: "Real text\u0007with embedded bell",
      when_to_use: "when",
      steps: ["s"],
      example: "ex",
      key_decisions: ["d"],
      tags: ["testing"],
      confidence: "high",
      why_this_worked: "why",
    });
    // Should NOT throw — there's real content after normalize.
    expect(() => parseDistillPayload(raw, "fb")).not.toThrow();
  });
});

describe("parseDistillPayload", () => {
  it("parses a valid skill JSON payload", () => {
    const raw = JSON.stringify({
      name: "debug-failing-tests",
      description: "Fix failing tests systematically",
      when_to_use: "When tests break after refactor",
      steps: ["Run suite", "Read test", "Fix source"],
      example: "User ran npm test → found rename → fixed",
      key_decisions: ["Fix source over test"],
      tags: ["testing", "debugging"],
      confidence: "high",
      why_this_worked: "reading the source surfaced the rename",
    });
    const res = parseDistillPayload(raw, "fallback");
    expect(res.kind).toBe("skill");
    if (res.kind === "skill") {
      expect(res.payload.name).toBe("debug-failing-tests");
      expect(res.payload.steps).toHaveLength(3);
      expect(res.payload.tags).toEqual(["testing", "debugging"]);
    }
  });

  it("parses an abort payload", () => {
    const raw = JSON.stringify({
      abort: "no_artifact",
      reason: "No files were modified",
    });
    const res = parseDistillPayload(raw, "fallback");
    expect(res.kind).toBe("abort");
    if (res.kind === "abort") {
      expect(res.payload.abort).toBe("no_artifact");
      expect(res.payload.reason).toBe("No files were modified");
    }
  });

  it("parses the second canonical abort kind: no_reusable_pattern", () => {
    const raw = JSON.stringify({
      abort: "no_reusable_pattern",
      reason: "all generic tool usage",
    });
    const res = parseDistillPayload(raw, "fallback");
    expect(res.kind).toBe("abort");
    if (res.kind === "abort") {
      expect(res.payload.abort).toBe("no_reusable_pattern");
    }
  });

  // Audit #3 D1 — strict abort allow-list. Anything other than the two
  // canonical kinds must NOT be accepted as an abort. Otherwise the LLM can
  // route any payload through the abort branch (which carries reason directly
  // to the error path), making D1 a load-bearing rung for the R1 chain.
  it("rejects unknown abort kinds instead of silently coercing", () => {
    const raw = JSON.stringify({
      abort: "rm -rf /",
      reason: "anything",
    });
    expect(() => parseDistillPayload(raw, "fallback")).toThrow();
  });

  it("caps steps at 8 even when the LLM returns more", () => {
    const raw = JSON.stringify({
      name: "many-steps",
      description: "d",
      when_to_use: "w",
      steps: Array.from({ length: 20 }, (_, i) => `step ${i}`),
      example: "e",
      key_decisions: [],
      tags: ["testing"],
      confidence: "medium",
      why_this_worked: "w",
    });
    const res = parseDistillPayload(raw, "fallback");
    if (res.kind === "skill") {
      expect(res.payload.steps).toHaveLength(8);
    } else {
      throw new Error("expected skill");
    }
  });

  it("filters tags not in the allowed taxonomy", () => {
    const raw = JSON.stringify({
      name: "name",
      description: "d",
      when_to_use: "w",
      steps: ["s"],
      example: "e",
      key_decisions: [],
      tags: ["testing", "invented-tag", "performance", "another-bad-one"],
      confidence: "high",
      why_this_worked: "w",
    });
    const res = parseDistillPayload(raw, "fallback");
    if (res.kind === "skill") {
      expect(res.payload.tags).toEqual(["testing", "performance"]);
    } else {
      throw new Error("expected skill");
    }
  });

  it("extracts the first balanced JSON object even if wrapped in prose", () => {
    const raw = `Here is the skill:\n\n{"name":"x","description":"d","when_to_use":"w","steps":["s"],"example":"e","key_decisions":[],"tags":["testing"],"confidence":"low","why_this_worked":"w"}\n\nHope that helps.`;
    const res = parseDistillPayload(raw, "fallback");
    expect(res.kind).toBe("skill");
  });

  it("coerces invalid confidence to 'low'", () => {
    const raw = JSON.stringify({
      name: "name",
      description: "d",
      when_to_use: "w",
      steps: ["s"],
      example: "e",
      key_decisions: [],
      tags: ["testing"],
      confidence: "super-high-amazing",
      why_this_worked: "w",
    });
    const res = parseDistillPayload(raw, "fallback");
    if (res.kind === "skill") {
      expect(res.payload.confidence).toBe("low");
    } else {
      throw new Error("expected skill");
    }
  });

  it("throws when required fields are missing", () => {
    const raw = JSON.stringify({
      name: "name",
      description: "d",
    });
    expect(() => parseDistillPayload(raw, "fallback")).toThrow();
  });

  it("handles adversarial dash-heavy input in linear time (ReDoS guard)", () => {
    // Regression for CodeQL js/polynomial-redos on the kebab validator.
    // A 10k-char dash-padded payload must complete in under 100ms on any
    // sane machine. The pre-fix regex took seconds to reject this.
    const hostile = "a" + "-".repeat(10000) + "!b";
    const raw = JSON.stringify({
      name: hostile,
      description: "d",
      when_to_use: "w",
      steps: ["s"],
      example: "e",
      key_decisions: [],
      tags: ["testing"],
      confidence: "low",
      why_this_worked: "w",
    });
    const start = Date.now();
    const res = parseDistillPayload(raw, "fallback-safe");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    if (res.kind === "skill") {
      expect(res.payload.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(res.payload.name.length).toBeLessThanOrEqual(64);
    } else {
      throw new Error("expected skill");
    }
  });

  it("sanitizes a bad kebab name to the fallback", () => {
    const raw = JSON.stringify({
      name: "Skill With CAPS & spaces!!",
      description: "d",
      when_to_use: "w",
      steps: ["s"],
      example: "e",
      key_decisions: [],
      tags: ["testing"],
      confidence: "medium",
      why_this_worked: "w",
    });
    const res = parseDistillPayload(raw, "fallback-name");
    if (res.kind === "skill") {
      expect(res.payload.name).toMatch(/^[a-z][a-z0-9-]*$/);
    } else {
      throw new Error("expected skill");
    }
  });

  it("does not get confused by braces inside JSON string values", () => {
    const raw = JSON.stringify({
      name: "x",
      description: "d",
      when_to_use: "run when you see {something: 'tricky'}",
      steps: ["s"],
      example: "e",
      key_decisions: [],
      tags: ["testing"],
      confidence: "low",
      why_this_worked: "w",
    });
    const res = parseDistillPayload(raw, "fallback");
    expect(res.kind).toBe("skill");
  });
});

describe("renderSkillMarkdown", () => {
  it("includes all canonical frontmatter fields", () => {
    const md = renderSkillMarkdown(
      {
        name: "debug-failing-tests",
        description: "Fix failing tests",
        when_to_use: "When tests break",
        steps: ["Run suite"],
        example: "ran npm test",
        key_decisions: ["Fix source over test"],
        tags: ["testing"],
        confidence: "high",
        why_this_worked: "reading the source",
      },
      {
        sessionId: "abc123",
        agent: "claude-code",
        createdISO: "2026-04-19",
      }
    );
    expect(md).toContain("name: debug-failing-tests");
    expect(md).toContain("source_session: abc123");
    expect(md).toContain("source_agent: claude-code");
    expect(md).toContain("created: 2026-04-19");
    expect(md).toContain(`distill_prompt_version: ${DISTILL_PROMPT_VERSION}`);
    expect(md).toContain("confidence: high");
  });

  it("renders steps as a numbered list", () => {
    const md = renderSkillMarkdown(
      {
        name: "x",
        description: "d",
        when_to_use: "w",
        steps: ["first", "second", "third"],
        example: "e",
        key_decisions: [],
        tags: ["testing"],
        confidence: "medium",
        why_this_worked: "w",
      },
      {
        sessionId: "id",
        agent: "claude-code",
        createdISO: "2026-04-19",
      }
    );
    expect(md).toContain("1. first");
    expect(md).toContain("2. second");
    expect(md).toContain("3. third");
  });

  it("defaults tags to auto-extracted when none provided", () => {
    const md = renderSkillMarkdown(
      {
        name: "x",
        description: "d",
        when_to_use: "w",
        steps: ["s"],
        example: "e",
        key_decisions: [],
        tags: [],
        confidence: "low",
        why_this_worked: "w",
      },
      {
        sessionId: "id",
        agent: "claude-code",
        createdISO: "2026-04-19",
      }
    );
    expect(md).toContain("  - auto-extracted");
  });
});

describe("ALLOWED_TAGS taxonomy", () => {
  it("is non-empty and all lowercase kebab", () => {
    expect(ALLOWED_TAGS.length).toBeGreaterThan(5);
    for (const t of ALLOWED_TAGS) {
      expect(t).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    }
  });
});
