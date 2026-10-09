import { describe, expect, it } from "vitest";
import {
  InMemoryCreatorAuthenticator,
  InMemoryLinkStore,
  InMemoryRedirectRecorder,
  type Link,
  type RedirectEvent,
} from "@url-shortener/core";

const created = Date.UTC(2026, 9, 6);
const deletedAt = created + 86_400_000;
const id = { namespace: "default", shortCode: "Ab3xYz9" };
const link: Link = {
  ...id,
  targetUrl: "https://example.com/",
  creatorId: "cr_4fK9pQ2xZ7",
  customAlias: false,
  createdAt: created,
};

describe("InMemoryLinkStore", { tags: ["adr-0002"] }, () => {
  it("answers a failed claim with the Link already holding the Short code", async () => {
    const store = new InMemoryLinkStore();
    await store.claim(link);

    expect(await store.claim({ ...link, targetUrl: "https://example.com/other" })).toEqual({ claimed: false, existing: link });
  });

  it("keeps a delete, so the Link reads as deleted", async () => {
    const store = new InMemoryLinkStore();
    await store.claim(link);

    expect(await store.delete(id, { kind: "creator", creatorId: "cr_4fK9pQ2xZ7" }, deletedAt)).toMatchObject({ deleted: true });
    expect(await store.read(id)).toEqual({
      state: "deleted",
      creatorId: "cr_4fK9pQ2xZ7",
      createdAt: created,
      deletedAt,
      deletedBy: "creator",
    });
  });

  it("leaves a Link live when its delete is refused", async () => {
    const store = new InMemoryLinkStore();
    await store.claim(link);

    expect(await store.delete(id, { kind: "creator", creatorId: "cr_Zb81QmT4wX" }, deletedAt)).toEqual({
      deleted: false,
      reason: "not_found",
    });
    expect(await store.read(id)).toMatchObject({ state: "live" });
  });

  it("never reissues a Deleted link's Short code", async () => {
    const store = new InMemoryLinkStore();
    await store.claim(link);
    await store.delete(id, { kind: "operator" }, deletedAt);

    expect(await store.claim(link)).toMatchObject({ claimed: false });
  });
});

describe("InMemoryRedirectRecorder", () => {
  it("keeps every Redirect event in order", () => {
    const recorder = new InMemoryRedirectRecorder();
    const hit: RedirectEvent = {
      namespace: "default",
      shortCode: "Ab3xYz9",
      source: "visitor",
      outcome: "kv-hit",
      status: 302,
      durationMs: 3,
    };
    const malformed: RedirectEvent = {
      namespace: null,
      shortCode: "robots.txt",
      source: "visitor",
      outcome: "malformed",
      status: 404,
      durationMs: 0,
    };

    recorder.record(hit);
    recorder.record(malformed);

    expect(recorder.events).toEqual([hit, malformed]);
  });
});

describe("InMemoryCreatorAuthenticator", () => {
  const creator = { id: "cr_4fK9pQ2xZ7", namespace: "default" };
  const authenticator = new InMemoryCreatorAuthenticator({ "lk_k1_secret": creator });

  it("authenticates a known credential as its Creator", async () => {
    expect(await authenticator.authenticate("lk_k1_secret")).toEqual(creator);
  });

  it("answers null for an unknown credential", async () => {
    expect(await authenticator.authenticate("lk_k1_wrong")).toBeNull();
  });
});
