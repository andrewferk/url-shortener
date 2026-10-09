import { describe, expect, it } from "vitest";
import { isPossibleShortCode, validateCustomAlias } from "@url-shortener/core";

describe("validateCustomAlias", { tags: ["adr-0002", "adr-0018"] }, () => {
  it.each(["abc", "Sale", "launch-2026_q4", "Ab3xYz9", "a".repeat(32), "__-", "0001sW2"])("accepts %s", (alias) => {
    expect(validateCustomAlias(alias)).toEqual({ valid: true });
  });

  it.each(["", "ab", "a".repeat(33)])("refuses %j for its length", (alias) => {
    expect(validateCustomAlias(alias)).toEqual({ valid: false, reason: "length" });
  });

  it.each(["robots.txt", "a/b/c", "launch+", ".well-known", "sale!", "café", "with space", "100%25"])(
    "refuses %s: only letters, digits, `-` and `_` are allowed",
    (alias) => {
      expect(validateCustomAlias(alias)).toEqual({ valid: false, reason: "characters" });
    },
  );

  it.each(["api", "status", "admin", "health", "login", "www", "API", "Status", "wWw"])("refuses the reserved word %s, in any case", (alias) => {
    expect(validateCustomAlias(alias)).toEqual({ valid: false, reason: "reserved" });
  });

  it("accepts a reserved word inside a longer alias", () => {
    expect(validateCustomAlias("api-docs")).toEqual({ valid: true });
  });
});

describe("isPossibleShortCode", { tags: ["adr-0004"] }, () => {
  it.each(["Ab3xYz9", "0000000", "zzzzzzz", "Sale", "launch-2026_q4", "a".repeat(32)])("passes %s", (candidate) => {
    expect(isPossibleShortCode(candidate)).toBe(true);
  });

  it.each(["", "ab", "a".repeat(33), "Ab3x.z9", "Ab3/xz9", "Ab3xYz9+", "favicon.ico", "api", "STATUS", "%41b3xYz9"])(
    "refuses %j, which is neither 7 base62 characters nor a valid Custom alias",
    (candidate) => {
      expect(isPossibleShortCode(candidate)).toBe(false);
    },
  );
});
