import { describe, expect, it } from "vitest";
import { applyDelete, type Link } from "@url-shortener/core";

const created = Date.UTC(2026, 9, 6);
const deletedAt = created + 86_400_000;
const link: Link = {
  namespace: "default",
  shortCode: "Ab3xYz9",
  targetUrl: "https://example.com/",
  creatorId: "cr_4fK9pQ2xZ7",
  customAlias: false,
  createdAt: created,
};
const deleted: Link = { ...link, targetUrl: "", deletion: { at: deletedAt, by: "operator", targetUrlSha256: null } };

describe("applyDelete", { tags: ["adr-0005", "adr-0019"] }, () => {
  it("lets a Creator delete its own Link, erasing the Target URL and keeping its hash", async () => {
    expect(await applyDelete(link, { kind: "creator", creatorId: "cr_4fK9pQ2xZ7" }, deletedAt)).toEqual({
      deleted: true,
      link: {
        ...link,
        targetUrl: "",
        deletion: {
          at: deletedAt,
          by: "creator",
          targetUrlSha256: "0f115db062b7c0dd030b16878c99dea5c354b49dc37b38eb8846179c7783e9d7",
        },
      },
    });
  });

  it("lets the Operator take down any Link", async () => {
    expect(await applyDelete(link, { kind: "operator" }, deletedAt)).toMatchObject({
      deleted: true,
      link: { targetUrl: "", deletion: { by: "operator" } },
    });
  });

  it("treats another Creator's Link as not found", async () => {
    expect(await applyDelete(link, { kind: "creator", creatorId: "cr_Zb81QmT4wX" }, deletedAt)).toEqual({
      deleted: false,
      reason: "not_found",
    });
  });

  it("treats another Creator's Deleted link as not found, not as already deleted", async () => {
    expect(await applyDelete(deleted, { kind: "creator", creatorId: "cr_Zb81QmT4wX" }, deletedAt + 1)).toEqual({
      deleted: false,
      reason: "not_found",
    });
  });

  it("deletes a Link only once", async () => {
    expect(await applyDelete(deleted, { kind: "operator" }, deletedAt + 1)).toEqual({
      deleted: false,
      reason: "already_deleted",
    });
  });

  it("reports a Link that doesn't exist as not found", async () => {
    expect(await applyDelete(null, { kind: "operator" }, deletedAt)).toEqual({ deleted: false, reason: "not_found" });
  });
});
