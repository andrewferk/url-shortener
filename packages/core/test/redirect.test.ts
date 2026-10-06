import { describe, expect, it } from "vitest";
import { decideRedirect } from "@url-shortener/core";

describe("decideRedirect", () => {
  it("answers 404 while no Link exists", () => {
    expect(decideRedirect()).toEqual({ status: 404 });
  });
});
