import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("redirect", { tags: ["adr-0001", "adr-0006"] }, () => {
  it("answers 404 while no Link exists", async () => {
    const response = await exports.default.fetch("https://short.test/abc1234");

    expect(response.status).toBe(404);
  });

  it("never lets a Redirect be cached", async () => {
    const response = await exports.default.fetch("https://short.test/abc1234");

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
