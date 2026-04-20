import { describe, it, expect } from "vitest";
import { summarizeToolCall, anonymizePath } from "../src/tool-summary.js";
import { homedir } from "os";

const projectRoot = "/Users/dev/Projects/app";

describe("anonymizePath", () => {
  it("returns project-relative when path is inside the project", () => {
    expect(anonymizePath("/Users/dev/Projects/app/src/foo.ts", projectRoot)).toBe("src/foo.ts");
  });

  it("returns ~/ prefix for paths inside home but outside project", () => {
    const home = homedir();
    expect(anonymizePath(`${home}/Desktop/x.md`, projectRoot)).toBe(`~/Desktop/x.md`);
  });

  it("returns basename for paths outside home and outside project", () => {
    expect(anonymizePath("/etc/passwd", projectRoot)).toBe("passwd");
  });

  it("returns project-relative form when a relative path resolves inside the project", () => {
    // "src/foo.ts" resolves to <projectRoot>/src/foo.ts which is inside the
    // project — the relative form is the safe thing to expose to the LLM.
    expect(anonymizePath("src/foo.ts", projectRoot)).toBe("src/foo.ts");
  });

  // Audit #3 A1 — relative paths that escape the project root previously
  // passed through verbatim, leaking out-of-project structure (and possibly
  // usernames or client names) into the prompt.
  it("collapses an escaping relative path to basename (no traversal leaks)", () => {
    expect(anonymizePath("../../../client-prod/.env", projectRoot)).toBe(".env");
  });

  it("collapses a deeply escaping relative path to basename", () => {
    expect(
      anonymizePath("../../infra/terraform.tfvars", projectRoot)
    ).toBe("terraform.tfvars");
  });

  it("returns basename when the relative path has no project root to resolve against", () => {
    expect(anonymizePath("../foo/bar.ts", "")).toBe("bar.ts");
  });

  it("leaves empty / non-string inputs alone", () => {
    expect(anonymizePath("", projectRoot)).toBe("");
  });
});

describe("summarizeToolCall — tool-specific semantic stripping", () => {
  it("Read → 'Read <rel-path>' with no JSON dump", () => {
    const out = summarizeToolCall(
      {
        name: "Read",
        input: { file_path: "/Users/dev/Projects/app/src/auth.ts" },
        output: "",
        timestamp: "",
      },
      projectRoot
    );
    expect(out).toBe("Read src/auth.ts");
  });

  it("Bash → 'Bash: <cmd> (<desc>)' without serialized JSON", () => {
    const out = summarizeToolCall(
      {
        name: "Bash",
        input: { command: "npm test", description: "Run test suite" },
        output: "",
        timestamp: "",
      },
      projectRoot
    );
    expect(out).toBe("Bash: npm test (Run test suite)");
  });

  it("Edit → 'Edit <rel-path>: <old> → <new>' truncated at boundary", () => {
    const out = summarizeToolCall(
      {
        name: "Edit",
        input: {
          file_path: "/Users/dev/Projects/app/src/auth.ts",
          old_string: "const x = 1",
          new_string: "const x = 2",
        },
        output: "",
        timestamp: "",
      },
      projectRoot
    );
    expect(out).toBe('Edit src/auth.ts: "const x = 1" → "const x = 2"');
  });

  it("Grep → 'Grep pattern=X in=<rel-path>'", () => {
    const out = summarizeToolCall(
      {
        name: "Grep",
        input: { pattern: "TODO", path: "/Users/dev/Projects/app/src" },
        output: "",
        timestamp: "",
      },
      projectRoot
    );
    expect(out).toBe("Grep pattern=TODO in=src");
  });

  it("Write → includes byte count and short preview", () => {
    const out = summarizeToolCall(
      {
        name: "Write",
        input: {
          file_path: "/Users/dev/Projects/app/foo.ts",
          content: "line one\nline two\nline three",
        },
        output: "",
        timestamp: "",
      },
      projectRoot
    );
    expect(out).toMatch(/^Write foo\.ts \(\d+b\):/);
    expect(out).toContain("line one");
  });

  it("Unknown tool → name + first string field, not JSON dump", () => {
    const out = summarizeToolCall(
      {
        name: "SomeCustomTool",
        input: { customField: "hello world", numField: 42 },
        output: "",
        timestamp: "",
      },
      projectRoot
    );
    expect(out).toBe("SomeCustomTool customField=hello world");
  });

  it("never includes absolute /Users/ paths in output", () => {
    const out = summarizeToolCall(
      {
        name: "Read",
        input: { file_path: "/Users/dev/Projects/app/src/auth.ts" },
        output: "",
        timestamp: "",
      },
      projectRoot
    );
    expect(out).not.toContain("/Users/");
  });
});
