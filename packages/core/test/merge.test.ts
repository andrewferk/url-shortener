import { describe, expect, it } from "vitest";
import { type Link, mergeLinkRecords, type VoidRecord } from "@url-shortener/core";

const created = Date.UTC(2026, 9, 6);
const live: Link = {
  namespace: "default",
  shortCode: "Ab3xYz9",
  targetUrl: "https://example.com/",
  creatorId: "cr_4fK9pQ2xZ7",
  customAlias: false,
  createdAt: created,
};

function deletedAt(at: number, by: "creator" | "operator" = "creator"): Link {
  return {
    ...live,
    targetUrl: "",
    deletion: { at, by, targetUrlSha256: "0f115db062b7c0dd030b16878c99dea5c354b49dc37b38eb8846179c7783e9d7" },
  };
}

function voids(at: number): VoidRecord {
  return { namespace: "default", shortCode: "Ab3xYz9", deletedAt: at };
}

describe("mergeLinkRecords", { tags: ["adr-0008", "adr-0019", "adr-0028"] }, () => {
  it("keeps the live record when there is nothing else", () => {
    expect(mergeLinkRecords([live, live], [])).toEqual(live);
  });

  it("lets the deleted one win, in any order", () => {
    const deleted = deletedAt(created + 1);

    expect(mergeLinkRecords([live, deleted], [])).toEqual(deleted);
    expect(mergeLinkRecords([deleted, live], [])).toEqual(deleted);
  });

  it("treats a voided delete as absent", () => {
    expect(mergeLinkRecords([live, deletedAt(created + 1)], [voids(created + 1)])).toEqual(live);
  });

  it("lets a later, real delete win over a voided one", () => {
    const later = deletedAt(created + 2, "operator");

    expect(mergeLinkRecords([deletedAt(created + 1), live, later], [voids(created + 1)])).toEqual(later);
  });

  it("ignores a void record that names another Link", () => {
    const deleted = deletedAt(created + 1);

    expect(mergeLinkRecords([live, deleted], [{ ...voids(created + 1), shortCode: "ab3xyz9" }])).toEqual(deleted);
  });

  it("answers null when every record is a voided delete", () => {
    expect(mergeLinkRecords([deletedAt(created + 1)], [voids(created + 1)])).toBeNull();
  });

  it("refuses records of more than one Link", () => {
    expect(() => mergeLinkRecords([live, { ...live, namespace: "ns_Q7f3kPz9Lm" }], [])).toThrow();
  });
});
