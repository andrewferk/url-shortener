import { describe, expect, it } from "vitest";
import {
  decideRedirect,
  InMemoryLinkStore,
  type Link,
  ManualClock,
  StaticNamespaceResolver,
} from "@url-shortener/core";

const created = Date.UTC(2026, 9, 6);

function setup() {
  const links = new InMemoryLinkStore();
  const clock = new ManualClock(created);
  const namespaces = new StaticNamespaceResolver({ "short.test": "default", "acme.test": "ns_Q7f3kPz9Lm" });
  const redirect = (url: string) => {
    const { hostname, pathname } = new URL(url);
    return decideRedirect({ hostname, path: pathname }, { namespaces, links, clock });
  };
  return { links, clock, redirect };
}

function link(overrides: Partial<Link> = {}): Link {
  return {
    namespace: "default",
    shortCode: "Ab3xYz9",
    targetUrl: "https://example.com/launch",
    creatorId: "cr_4fK9pQ2xZ7",
    customAlias: false,
    createdAt: created,
    ...overrides,
  };
}

describe("decideRedirect", { tags: ["adr-0001", "adr-0014", "adr-0018"] }, () => {
  it("answers 302 to the Target URL for a live Link", async () => {
    const { links, redirect } = setup();
    await links.claim(link());

    expect(await redirect("https://short.test/Ab3xYz9")).toEqual({
      status: 302,
      location: "https://example.com/launch",
    });
  });

  it("answers 404 when no Link has the Short code", async () => {
    const { redirect } = setup();

    expect(await redirect("https://short.test/Ab3xYz9")).toEqual({ status: 404, reason: "not-found" });
  });

  it("matches the Short code case-sensitively", async () => {
    const { links, redirect } = setup();
    await links.claim(link({ shortCode: "Sale", customAlias: true }));

    expect(await redirect("https://short.test/sale")).toEqual({ status: 404, reason: "not-found" });
  });

  it("looks the Short code up only in the Short domain's Namespace", async () => {
    const { links, redirect } = setup();
    await links.claim(link({ namespace: "ns_Q7f3kPz9Lm", targetUrl: "https://example.com/acme" }));

    expect(await redirect("https://short.test/Ab3xYz9")).toEqual({ status: 404, reason: "not-found" });
    expect(await redirect("https://acme.test/Ab3xYz9")).toEqual({ status: 302, location: "https://example.com/acme" });
  });

  describe("the malformed shape check", { tags: ["adr-0004"] }, () => {
    const neverRead = {
      read: () => Promise.reject(new Error("a malformed request must never reach storage")),
    };
    const decide = (hostname: string, path: string) =>
      decideRedirect(
        { hostname, path },
        { namespaces: new StaticNamespaceResolver({ "short.test": "default" }), links: neverRead, clock: new ManualClock(created) },
      );

    it("answers 404 before any lookup for a hostname mapped to no Namespace", async () => {
      expect(await decide("elsewhere.test", "/Ab3xYz9")).toEqual({ status: 404, reason: "malformed" });
    });

    it.each(["/", "/ab", `/${"a".repeat(33)}`, "/Ab3xYz9/", "/a/b", "/robots.txt", "/Ab3xYz9+", "/caf%C3%A9", "/api", "/Admin"])(
      "answers 404 before any lookup for the path %s",
      async (path) => {
        expect(await decide("short.test", path)).toEqual({ status: 404, reason: "malformed" });
      },
    );
  });

  describe("Expiry, evaluated through the Clock", { tags: ["adr-0006"] }, () => {
    const expiresAt = created + 60_000;

    it("redirects until the Expiry", async () => {
      const { links, clock, redirect } = setup();
      await links.claim(link({ expiresAt }));
      clock.set(expiresAt - 1);

      expect(await redirect("https://short.test/Ab3xYz9")).toEqual({ status: 302, location: "https://example.com/launch" });
    });

    it("answers 410 Gone from the Expiry exactly", async () => {
      const { links, clock, redirect } = setup();
      await links.claim(link({ expiresAt }));
      clock.set(expiresAt);

      expect(await redirect("https://short.test/Ab3xYz9")).toEqual({ status: 410, reason: "expired" });
    });
  });

  it("answers 410 Gone for a Deleted link", async () => {
    const { links, redirect } = setup();
    await links.claim(link());
    await links.delete({ namespace: "default", shortCode: "Ab3xYz9" }, { kind: "creator", creatorId: "cr_4fK9pQ2xZ7" }, created + 1);

    expect(await redirect("https://short.test/Ab3xYz9")).toEqual({ status: 410, reason: "deleted" });
  });

  it("answers a Link both Expired and Deleted as deleted", async () => {
    const { links, clock, redirect } = setup();
    await links.claim(link({ expiresAt: created + 60_000 }));
    await links.delete({ namespace: "default", shortCode: "Ab3xYz9" }, { kind: "operator" }, created + 1);
    clock.advance(120_000);

    expect(await redirect("https://short.test/Ab3xYz9")).toEqual({ status: 410, reason: "deleted" });
  });
});
