import { describe, it, expect } from "vitest";
import { isNewer } from "../src/update-check.js";

describe("isNewer", () => {
  it("reports newer patch version", () => {
    expect(isNewer("0.2.1", "0.2.0")).toBe(true);
  });

  it("reports newer minor version", () => {
    expect(isNewer("0.3.0", "0.2.9")).toBe(true);
  });

  it("reports newer major version", () => {
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  });

  it("returns false for equal versions", () => {
    expect(isNewer("0.2.1", "0.2.1")).toBe(false);
  });

  it("returns false when latest is older", () => {
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
  });

  it("ignores pre-release suffixes on the numeric triple", () => {
    expect(isNewer("0.3.0-beta.1", "0.2.0")).toBe(true);
  });

  it("returns false on malformed versions", () => {
    expect(isNewer("not-a-version", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", "garbage")).toBe(false);
  });
});
