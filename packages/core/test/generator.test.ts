import { describe, expect, it } from "vitest";
import { BASE62_ALPHABET, RandomShortCodeGenerator } from "@url-shortener/core";

describe("RandomShortCodeGenerator", () => {
  const generator = new RandomShortCodeGenerator();
  const draws = Array.from({ length: 2000 }, () => generator.generate());

  it("draws 7 base62 characters", () => {
    for (const shortCode of draws) expect(shortCode).toMatch(/^[0-9A-Za-z]{7}$/);
  });

  it("draws every base62 character", () => {
    const seen = new Set(draws.join(""));
    expect(Array.from(BASE62_ALPHABET).filter((character) => !seen.has(character))).toEqual([]);
  });

  it("doesn't repeat itself", () => {
    expect(new Set(draws).size).toBe(draws.length);
  });
});
