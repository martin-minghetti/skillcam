import { describe, it, expect } from "vitest";
import {
  scanAndRedact,
  scanAndRedactTruncate,
  normalizeForScan,
} from "../src/secret-scan.js";
import { buildDistillPrompt } from "../src/distiller-prompt.js";
import type { ParsedSession } from "../src/parsers/types.js";

// All secret fixtures are split with string concatenation so GitHub Push
// Protection and other scanners do not flag the test file itself. Same
// pattern already used in tests/secret-scan.test.ts and tests/template-scan.test.ts.
const openaiProjectKeyRaw =
  "sk-proj" + "-" + "abcd1234efgh5678ijkl9012mnop3456";
const anthropicKeyRaw =
  "sk-ant" + "-api03-" + "abc123def456ghi789jkl0mnopqrstuv";

describe("Sprint 2 — scanner bypass hardening (audit C2)", () => {
  describe("B1 — truncation before scan", () => {
    it("detects a secret that would be cut off by the 500-char truncate", () => {
      // The old code path did `m.content.slice(0, 500)` *before* the scanner
      // ran, leaving only the first 13 chars of a 33-char key in the prompt.
      const padded = "A".repeat(495) + openaiProjectKeyRaw;
      const { matches } = scanAndRedactTruncate(padded, 500, "msg[0]");
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.type === "openai-project-key")).toBe(true);
    });

    it("buildDistillPrompt collects matches from per-message content", () => {
      const session: ParsedSession = {
        sessionId: "bypass-b1",
        agent: "claude-code",
        project: "/tmp/x",
        branch: "main",
        startedAt: "2026-04-17T00:00:00Z",
        endedAt: "2026-04-17T00:00:01Z",
        messages: [
          {
            role: "user",
            content: "A".repeat(495) + openaiProjectKeyRaw,
            timestamp: "2026-04-17T00:00:00Z",
            toolCalls: [],
            tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
        totalTokens: { input: 0, output: 0 },
        totalToolCalls: 0,
        filesModified: [],
        summary: { userMessages: 1, assistantMessages: 0, toolCalls: 0, uniqueTools: [] },
      };
      const { matches, prompt } = buildDistillPrompt(session);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.type === "openai-project-key")).toBe(true);
      // Prompt no longer contains the raw key anywhere (it has been redacted
      // before truncation).
      expect(prompt).not.toContain(openaiProjectKeyRaw);
    });

    it("buildDistillPrompt scans tool-call inputs before truncating", () => {
      // Push the secret past the first 200 chars of the serialized JSON so
      // the old `slice(0, 200)` would have missed it.
      const padding = "A".repeat(300);
      const session: ParsedSession = {
        sessionId: "bypass-b1-tc",
        agent: "claude-code",
        project: "/tmp/x",
        branch: "main",
        startedAt: "2026-04-17T00:00:00Z",
        endedAt: "2026-04-17T00:00:01Z",
        messages: [
          {
            role: "assistant",
            content: "ok",
            timestamp: "2026-04-17T00:00:00Z",
            toolCalls: [
              {
                name: "Bash",
                input: { command: `echo ${padding} ${anthropicKeyRaw}` },
                output: "",
                timestamp: "2026-04-17T00:00:00Z",
              },
            ],
            tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
        totalTokens: { input: 0, output: 0 },
        totalToolCalls: 1,
        filesModified: [],
        summary: {
          userMessages: 0,
          assistantMessages: 1,
          toolCalls: 1,
          uniqueTools: ["Bash"],
        },
      };
      const { matches, prompt } = buildDistillPrompt(session);
      expect(matches.some((m) => m.type === "anthropic-api-key")).toBe(true);
      expect(prompt).not.toContain(anthropicKeyRaw);
    });
  });

  describe("B2 — Unicode NFKC (fullwidth)", () => {
    it("detects a fullwidth-Unicode equivalent of an OpenAI project key", () => {
      // Audit payload: `ｓｋ－ｐｒｏｊ－` (fullwidth) + ASCII tail. NFKC
      // normalizes the fullwidth chars back to ASCII `sk-proj-`.
      const payload =
        "token=" +
        "\uFF53\uFF4B\uFF0D\uFF50\uFF52\uFF4F\uFF4A\uFF0D" +
        "\uFF41\uFF42\uFF43\uFF44" + // fullwidth a b c d
        "1234efgh5678ijkl9012mnop3456";
      const { matches } = scanAndRedact(payload);
      expect(matches.some((m) => m.type === "openai-project-key")).toBe(true);
    });

    it("normalizeForScan round-trips fullwidth to ASCII", () => {
      expect(
        normalizeForScan("\uFF53\uFF4B\uFF0D\uFF50\uFF52\uFF4F\uFF4A")
      ).toBe("sk-proj");
    });
  });

  describe("B3 — zero-width character insertion", () => {
    it("detects a key split by U+200B zero-width space", () => {
      const payload = "sk-proj-\u200Babcd1234efgh5678ijkl9012mnop3456";
      const { matches } = scanAndRedact(payload);
      expect(matches.some((m) => m.type === "openai-project-key")).toBe(true);
    });

    it("detects keys split by other zero-width chars (ZWJ, ZWNJ, BOM, soft-hyphen)", () => {
      const parts = ["sk-ant-api03", "abc123def456ghi789jkl0mnopqrstuv"];
      const separators = ["\u200C", "\u200D", "\uFEFF", "\u00AD"];
      for (const sep of separators) {
        const payload = parts.join(sep);
        const { matches } = scanAndRedact(payload);
        expect(
          matches.some((m) => m.type === "anthropic-api-key"),
          `failed for separator U+${sep.charCodeAt(0).toString(16).padStart(4, "0")}`
        ).toBe(true);
      }
    });
  });

  describe("B4 — URL-encoded secrets", () => {
    it("detects a percent-encoded Anthropic key", () => {
      const encoded = anthropicKeyRaw
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("");
      const { matches } = scanAndRedact(`Authorization: ${encoded}`);
      expect(matches.some((m) => m.type === "anthropic-api-key")).toBe(true);
    });

    it("gracefully handles malformed percent-encoded input", () => {
      // Dangling `%` would throw in decodeURIComponent — normalizeForScan
      // must swallow the error and keep going.
      const payload = "legit text with a dangling %ZZ sequence and sk-proj-abcd1234efgh5678ijkl9012mnop3456";
      const { matches } = scanAndRedact(payload);
      // A real secret still in the stream should still be detected.
      expect(matches.some((m) => m.type === "openai-project-key")).toBe(true);
    });
  });

  describe("B5 — Unicode escape sequences", () => {
    it("detects a key expressed as \\uXXXX sequences (as found in JSON)", () => {
      const encoded = anthropicKeyRaw
        .split("")
        .map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
        .join("");
      const { matches } = scanAndRedact(`{"auth": "${encoded}"}`);
      expect(matches.some((m) => m.type === "anthropic-api-key")).toBe(true);
    });
  });

  describe("S1 — homoglyphs + combining diacritics", () => {
    it("detects a Cyrillic-homoglyph Anthropic key (`ѕк-ant-…`)", () => {
      // First two chars are Cyrillic ѕ (U+0455) and к (U+043A). Rest is ASCII
      // so the full anthropic regex still has 20+ ASCII chars to match.
      const payload =
        "Authorization: \u0455\u043A" +
        "-ant-api03-abc123def456ghi789jkl0mnopqrstuv";
      const { matches } = scanAndRedact(payload);
      expect(matches.some((m) => m.type === "anthropic-api-key")).toBe(true);
    });

    it("detects a Greek-homoglyph OpenAI project key", () => {
      // Greek ο (U+03BF) replaces ASCII o. After map, it's `sk-proj-…`.
      const payload =
        "token=sk-pr\u03BFj-abcd1234efgh5678ijkl9012mnop3456";
      const { matches } = scanAndRedact(payload);
      expect(matches.some((m) => m.type === "openai-project-key")).toBe(true);
    });

    it("detects a key with combining diacritics splitting every char", () => {
      // Each ASCII char followed by a combining acute accent (U+0301). NFD
      // decomposes, we strip \p{M}, back to plain ASCII.
      const parts = "sk-ant-api03-abc123def456ghi789jkl0mnopqrstuv";
      const payload = parts.split("").join("\u0301") + "\u0301";
      const { matches } = scanAndRedact(payload);
      expect(matches.some((m) => m.type === "anthropic-api-key")).toBe(true);
    });

    it("preserves legitimate multilingual text when no secret present", () => {
      const payload = "café résumé naïve — no secrets here";
      const { matches, redacted } = scanAndRedact(payload);
      expect(matches.length).toBe(0);
      // When there are zero matches we return the original text verbatim.
      expect(redacted).toBe(payload);
    });
  });

  describe("bonus — base64-encoded secrets", () => {
    it("detects an Anthropic key smuggled as base64", () => {
      const b64 = Buffer.from(anthropicKeyRaw).toString("base64");
      const { matches } = scanAndRedact(`config=${b64}`);
      expect(
        matches.some((m) => m.type === "base64-encoded-anthropic-api-key")
      ).toBe(true);
    });

    it("does not flag random short base64 blobs", () => {
      // 40 chars but decoded is pure random binary → low printable ratio →
      // skipped. Use random bytes to avoid accidental pattern hits.
      const random = Buffer.alloc(40);
      for (let i = 0; i < random.length; i++) random[i] = (i * 37) & 0xff;
      const b64 = random.toString("base64");
      const { matches } = scanAndRedact(`cache_key=${b64}`);
      expect(
        matches.filter((m) => m.type.startsWith("base64-encoded-")).length
      ).toBe(0);
    });

    describe("S3 — recursive base64 decode", () => {
      it("detects a double-base64 encoded anthropic key", () => {
        const once = Buffer.from(anthropicKeyRaw).toString("base64");
        const twice = Buffer.from(once).toString("base64");
        const { matches } = scanAndRedact(`blob=${twice}`);
        expect(
          matches.some((m) =>
            m.type.startsWith("base64-encoded-anthropic-api-key")
          )
        ).toBe(true);
      });

      it("detects a triple-base64 encoded openai project key", () => {
        const once = Buffer.from(openaiProjectKeyRaw).toString("base64");
        const twice = Buffer.from(once).toString("base64");
        const thrice = Buffer.from(twice).toString("base64");
        const { matches } = scanAndRedact(`x=${thrice}`);
        expect(
          matches.some((m) =>
            m.type.startsWith("base64-encoded-openai-project-key")
          )
        ).toBe(true);
      });

      it("stops at depth 3 without exploding on deep base64 chains", () => {
        // 6 layers of base64 around a key — only the first 3 should be
        // attempted. No match for the inner key (that's fine), but also no
        // crash / timeout.
        let payload: string = anthropicKeyRaw;
        for (let i = 0; i < 6; i++) {
          payload = Buffer.from(payload).toString("base64");
        }
        const start = Date.now();
        const { matches } = scanAndRedact(`y=${payload}`);
        expect(Date.now() - start).toBeLessThan(200);
        // The inner anthropic key is 6 levels deep — beyond MAX_DEPTH.
        expect(
          matches.every(
            (m) => !m.type.includes("anthropic-api-key") || m.type.startsWith("base64-encoded-")
          )
        ).toBe(true);
      });
    });
  });
});
