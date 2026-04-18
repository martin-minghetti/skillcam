import { describe, it, expect } from "vitest";
import { scanAndRedact } from "../src/secret-scan.js";

// Fixtures are split with string concatenation so GitHub push protection
// (and similar secret scanners) do not flag the test file itself.
const anthropicKey = "sk-ant" + "-api03-" + "abc123def456ghi789jkl0mnopqrstuv";
const openaiProjectKey = "sk-proj" + "-" + "abcd1234efgh5678ijkl9012mnop3456";
const githubPat = "ghp" + "_" + "abcdefghijklmnopqrstuvwxyz0123456789";
const awsAccessKey = "AKIA" + "IOSFODNN" + "7EXAMPLE";
const stripeLiveKey = "sk" + "_live_" + "abc123def456ghi789jkl0mn";
const jwt =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  "." +
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0" +
  "." +
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("scanAndRedact", () => {
  it("returns no matches for clean text", () => {
    const { matches, redacted } = scanAndRedact("Just a regular conversation with no secrets.");
    expect(matches).toHaveLength(0);
    expect(redacted).toBe("Just a regular conversation with no secrets.");
  });

  it("detects an Anthropic API key", () => {
    const { matches, redacted } = scanAndRedact(`export ANTHROPIC_API_KEY=${anthropicKey}`);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("anthropic-api-key");
    expect(redacted).not.toContain(anthropicKey);
    expect(redacted).toContain("[REDACTED:");
  });

  it("detects an OpenAI project key", () => {
    const { matches } = scanAndRedact(`key = ${openaiProjectKey}`);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.type === "openai-project-key")).toBe(true);
  });

  it("detects a GitHub PAT", () => {
    const { matches, redacted } = scanAndRedact(`token: ${githubPat}`);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("github-pat");
    expect(redacted).not.toContain(githubPat);
  });

  it("detects an AWS access key", () => {
    const { matches } = scanAndRedact(`AWS_ACCESS_KEY=${awsAccessKey}`);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("aws-access-key");
  });

  it("detects a Stripe live key", () => {
    const { matches } = scanAndRedact(`STRIPE_SECRET=${stripeLiveKey}`);
    expect(matches.some((m) => m.type === "stripe-live-key")).toBe(true);
  });

  it("detects a JWT", () => {
    const { matches, redacted } = scanAndRedact(`Authorization: Bearer ${jwt}`);
    expect(matches.some((m) => m.type === "jwt")).toBe(true);
    expect(redacted).toContain("[REDACTED:");
  });

  it("detects a PEM private key marker", () => {
    const { matches } = scanAndRedact(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC..."
    );
    expect(matches.some((m) => m.type === "pem-private-key")).toBe(true);
  });

  it("detects multiple secrets of different types", () => {
    const input = [
      `ANTHROPIC_API_KEY=${anthropicKey}`,
      `GITHUB_TOKEN=${githubPat}`,
      `AWS_KEY=${awsAccessKey}`,
    ].join("\n");
    const { matches, redacted } = scanAndRedact(input);
    const types = new Set(matches.map((m) => m.type));
    expect(types.has("anthropic-api-key")).toBe(true);
    expect(types.has("github-pat")).toBe(true);
    expect(types.has("aws-access-key")).toBe(true);
    expect(redacted.split("[REDACTED:").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("redacts while preserving surrounding context", () => {
    const { redacted } = scanAndRedact(`before ${anthropicKey} after`);
    expect(redacted).toMatch(/^before \[REDACTED:.+\] after$/);
  });

  it("records location in each match", () => {
    const { matches } = scanAndRedact(awsAccessKey, "test-location");
    expect(matches[0].location).toBe("test-location");
  });
});
