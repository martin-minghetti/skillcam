import { describe, it, expect } from "vitest";
import {
  parseDistillPayload,
  renderSkillMarkdown,
  DISTILL_PROMPT_VERSION,
  ALLOWED_TAGS,
} from "../src/skill-render.js";

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
