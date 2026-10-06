import { describe, expect, it } from "vitest";
import { isPossibleShortCode, validateCustomAlias } from "@url-shortener/core";

describe("validateCustomAlias", () => {
  it.each(["abc", "Sale", "launch-2026_q4", "Ab3xYz9", "a".repeat(32), "__-", "0001sW2"])("accepts %s", (alias) => {
    expect(validateCustomAlias(alias)).toEqual({ valid: true });
  });

  it.each(["", "ab", "a".repeat(33)])("refuses %j for its length", (alias) => {
    expect(validateCustomAlias(alias)).toEqual({ valid: false, reason: "length" });
  });

  // `.`, `/` and `+` are permanently excluded: future routes depend on it (ADR 0002).
  it.each(["robots.txt", "a/b/c", "launch+", ".well-known", "sale!", "café", "with space", "100%25"])(
    "refuses %s for its characters",
    (alias) => {
      expect(validateCustomAlias(alias)).toEqual({ valid: false, reason: "characters" });
    },
  );

  // The reserved list is rejected case-insensitively (ADRs 0002, 0018).
  it.each(["api", "status", "admin", "health", "login", "www", "API", "Status", "wWw"])("refuses %s as reserved", (alias) => {
    expect(validateCustomAlias(alias)).toEqual({ valid: false, reason: "reserved" });
  });

  it("accepts a reserved word inside a longer alias", () => {
    expect(validateCustomAlias("api-docs")).toEqual({ valid: true });
  });
});

describe("isPossibleShortCode", () => {
  // A path passes only if it is 7 base62 characters, or a valid, unreserved
  // Custom alias (ADR 0004).
  it.each(["Ab3xYz9", "0000000", "zzzzzzz", "Sale", "launch-2026_q4", "a".repeat(32)])("passes %s", (candidate) => {
    expect(isPossibleShortCode(candidate)).toBe(true);
  });

  it.each(["", "ab", "a".repeat(33), "Ab3x.z9", "Ab3/xz9", "Ab3xYz9+", "favicon.ico", "api", "STATUS", "%41b3xYz9"])(
    "refuses %j",
    (candidate) => {
      expect(isPossibleShortCode(candidate)).toBe(false);
    },
  );
});
