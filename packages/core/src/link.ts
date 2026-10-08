import { type DeletedBy, type LinksValue, targetUrlSha256 } from "./encoding.ts";
import type { CreatorId, EpochMs, LinkId } from "./link-id.ts";

export interface Link extends LinkId {
  /** The empty string once the Link is deleted. */
  readonly targetUrl: string;
  readonly creatorId: CreatorId;
  /** A 7-character alias looks like a generated code, so only this flag tells them apart. */
  readonly customAlias: boolean;
  readonly createdAt: EpochMs;
  readonly expiresAt?: EpochMs;
  /** Stored, never logged. */
  readonly idempotencyKey?: string;
  readonly deletion?: Deletion;
}

export interface Deletion {
  readonly at: EpochMs;
  readonly by: DeletedBy;
  /** `null` when the hash is unknown, as on a row rebuilt from `LINKS`. */
  readonly targetUrlSha256: string | null;
}

export type LinkState = "live" | "expired" | "deleted";

export function linkState(value: LinksValue, now: number): LinkState {
  if (value.state === "deleted") return "deleted";
  if (value.expiresAt !== undefined && now >= value.expiresAt) return "expired";
  return "live";
}

export function toLinksValue(link: Link): LinksValue {
  if (link.deletion !== undefined) {
    return {
      state: "deleted",
      creatorId: link.creatorId,
      createdAt: link.createdAt,
      deletedAt: link.deletion.at,
      deletedBy: link.deletion.by,
    };
  }
  return {
    state: "live",
    targetUrl: link.targetUrl,
    ...(link.expiresAt === undefined ? {} : { expiresAt: link.expiresAt }),
    creatorId: link.creatorId,
    createdAt: link.createdAt,
  };
}

export interface VoidRecord extends LinkId {
  /** The `at` of the one deletion this record voids. */
  readonly deletedAt: number;
}

export function mergeLinkRecords(records: readonly Link[], voids: readonly VoidRecord[]): Link | null {
  const [first] = records;
  if (first === undefined) return null;
  if (records.some((record) => record.namespace !== first.namespace || record.shortCode !== first.shortCode)) {
    throw new Error("mergeLinkRecords takes the records of one Link");
  }
  const voided = new Set(
    voids
      .filter((record) => record.namespace === first.namespace && record.shortCode === first.shortCode)
      .map((record) => record.deletedAt),
  );
  let merged: Link | null = null;
  for (const record of records) {
    if (record.deletion !== undefined && voided.has(record.deletion.at)) continue;
    if (merged === null || outranks(record, merged)) merged = record;
  }
  return merged;
}

// A delete outranks a live record; of two deletes, the later wins, so the
// result doesn't depend on the order records arrive in.
function outranks(record: Link, current: Link): boolean {
  if (record.deletion === undefined) return false;
  return current.deletion === undefined || record.deletion.at > current.deletion.at;
}

export type Deleter = { readonly kind: "creator"; readonly creatorId: CreatorId } | { readonly kind: "operator" };

export type DeleteResult =
  | { readonly deleted: true; readonly link: Link }
  | { readonly deleted: false; readonly reason: "not_found" | "already_deleted" };

export async function applyDelete(link: Link | null, deleter: Deleter, at: number): Promise<DeleteResult> {
  if (link === null) return { deleted: false, reason: "not_found" };
  // Not "forbidden": a Creator learns nothing about Links it doesn't own.
  if (deleter.kind === "creator" && deleter.creatorId !== link.creatorId) return { deleted: false, reason: "not_found" };
  if (link.deletion !== undefined) return { deleted: false, reason: "already_deleted" };
  return {
    deleted: true,
    link: {
      ...link,
      targetUrl: "",
      deletion: { at, by: deleter.kind, targetUrlSha256: await targetUrlSha256(link.targetUrl) },
    },
  };
}
