import { describe, expect, it } from "vitest";
import {
  type AuthenticatedCreator,
  createLink,
  InMemoryLinkStore,
  ManualClock,
  SequenceShortCodeGenerator,
} from "@url-shortener/core";

const now = Date.UTC(2026, 9, 6, 12);
const creator: AuthenticatedCreator = { id: "cr_4fK9pQ2xZ7", namespace: "default" };

function setup(codes: string[] = ["Ab3xYz9"]) {
  const registry = new InMemoryLinkStore();
  const ports = { registry, generator: new SequenceShortCodeGenerator(codes), clock: new ManualClock(now) };
  return { registry, ports };
}

describe("createLink", { tags: ["adr-0002", "adr-0014"] }, () => {
  it("creates a Link with a generated Short code in the Creator's Namespace", async () => {
    const { registry, ports } = setup();

    const result = await createLink({ creator, targetUrl: "https://example.com/launch" }, ports);

    expect(result).toEqual({
      created: true,
      link: {
        namespace: "default",
        shortCode: "Ab3xYz9",
        targetUrl: "https://example.com/launch",
        creatorId: "cr_4fK9pQ2xZ7",
        customAlias: false,
        createdAt: now,
      },
    });
    expect(await registry.read({ namespace: "default", shortCode: "Ab3xYz9" })).toEqual({
      state: "live",
      targetUrl: "https://example.com/launch",
      creatorId: "cr_4fK9pQ2xZ7",
      createdAt: now,
    });
  });

  it("carries the Expiry", async () => {
    const { ports } = setup();

    const result = await createLink({ creator, targetUrl: "https://example.com/", expiresAt: now + 3_600_000 }, ports);

    expect(result).toMatchObject({ created: true, link: { expiresAt: now + 3_600_000 } });
  });

  it("draws again when a generated Short code is already claimed", async () => {
    const { ports } = setup(["Ab3xYz9", "Ab3xYz9", "0001sW2"]);
    await createLink({ creator, targetUrl: "https://example.com/first" }, ports);

    const result = await createLink({ creator, targetUrl: "https://example.com/second" }, ports);

    expect(result).toMatchObject({ created: true, link: { shortCode: "0001sW2" } });
  });

  it("gives up after 8 draws that are all claimed", async () => {
    const { ports } = setup(Array.from({ length: 9 }, () => "Ab3xYz9"));
    await createLink({ creator, targetUrl: "https://example.com/first" }, ports);

    expect(await createLink({ creator, targetUrl: "https://example.com/second" }, ports)).toEqual({
      created: false,
      reason: "unavailable",
    });
  });

  describe("with a Custom alias", { tags: ["adr-0018"] }, () => {
    it("creates a Link with the alias exactly as sent", async () => {
      const { ports } = setup();

      const result = await createLink({ creator, targetUrl: "https://example.com/", customAlias: "Launch-2026" }, ports);

      expect(result).toMatchObject({ created: true, link: { shortCode: "Launch-2026", customAlias: true } });
    });

    it("refuses an alias already claimed", async () => {
      const { ports } = setup();
      await createLink({ creator, targetUrl: "https://example.com/", customAlias: "launch" }, ports);

      expect(await createLink({ creator, targetUrl: "https://example.com/", customAlias: "launch" }, ports)).toEqual({
        created: false,
        reason: "alias_taken",
      });
    });

    it("refuses the alias of a Deleted link, which is never reissued", async () => {
      const { registry, ports } = setup();
      await createLink({ creator, targetUrl: "https://example.com/", customAlias: "launch" }, ports);
      await registry.delete({ namespace: "default", shortCode: "launch" }, { kind: "creator", creatorId: creator.id }, now);

      expect(await createLink({ creator, targetUrl: "https://example.com/", customAlias: "launch" }, ports)).toEqual({
        created: false,
        reason: "alias_taken",
      });
    });

    it("treats a case variant as a different alias", async () => {
      const { ports } = setup();
      await createLink({ creator, targetUrl: "https://example.com/", customAlias: "Sale" }, ports);

      const result = await createLink({ creator, targetUrl: "https://example.com/", customAlias: "sale" }, ports);

      expect(result).toMatchObject({ created: true, link: { shortCode: "sale" } });
    });

    it("lets the same alias exist in another Namespace", async () => {
      const { ports } = setup();
      await createLink({ creator, targetUrl: "https://example.com/", customAlias: "launch" }, ports);
      const other: AuthenticatedCreator = { id: "cr_Zb81QmT4wX", namespace: "ns_Q7f3kPz9Lm" };

      const result = await createLink({ creator: other, targetUrl: "https://example.com/", customAlias: "launch" }, ports);

      expect(result).toMatchObject({ created: true, link: { namespace: "ns_Q7f3kPz9Lm", shortCode: "launch" } });
    });

    it.each([
      ["ab", "length"],
      ["robots.txt", "characters"],
      ["launch+", "characters"],
      ["Status", "reserved"],
    ])("refuses %s for its %s", async (customAlias, problem) => {
      const { ports } = setup();

      expect(await createLink({ creator, targetUrl: "https://example.com/", customAlias }, ports)).toEqual({
        created: false,
        reason: "invalid_alias",
        problem,
      });
    });
  });
});
