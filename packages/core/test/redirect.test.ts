import { describe, expect, it } from "vitest";
import { decideRedirect } from "@url-shortener/core";

describe("decideRedirect", { tags: ["adr-0001"] }, () => {
  it("answers 404 while no Link exists", () => {
    expect(decideRedirect()).toEqual({ status: 404 });
  });
});
