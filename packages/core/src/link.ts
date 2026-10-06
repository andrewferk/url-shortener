import { type DeletedBy, type LinksValue, targetUrlSha256 } from "./encoding.ts";
import type { CreatorId, LinkId } from "./link-id.ts";

/**
 * A Link as its shard holds it (ADR 0008). Its fields never change after
 * creation; the only change is to become a Deleted link, which erases its
 * Target URL (ADR 0019).
 */
export interface Link extends LinkId {
  /** The empty string once the Link is deleted (ADR 0019). */
  readonly targetUrl: string;
  readonly creatorId: CreatorId;
  /** Whether the Creator chose the Short code. A 7-character alias looks like a generated code. */
  readonly customAlias: boolean;
  /** Epoch ms. */
  readonly createdAt: number;
  /** Epoch ms. Absent when the Link has no Expiry. */
  readonly expiresAt?: number;
  /** Stored, never logged (ADR 0009). Absent for an unkeyed create. */
  readonly idempotencyKey?: string;
  /** Absent while the Link isn't deleted. */
  readonly deletion?: Deletion;
}

export interface Deletion {
  /** Epoch ms. */
  readonly at: number;
  readonly by: DeletedBy;
  /** The erased Target URL's hash; `null` when it is unknown, as on a row rebuilt from `LINKS` (ADR 0019). */
  readonly targetUrlSha256: string | null;
}

export type LinkState = "live" | "expired" | "deleted";

/**
 * Whether a Link redirects at `now`. A Link goes Gone at its Expiry exactly
 * (ADR 0006), and a deletion outranks an Expiry.
 */
export function linkState(value: LinksValue, now: number): LinkState {
  if (value.state === "deleted") return "deleted";
  if (value.expiresAt !== undefined && now >= value.expiresAt) return "expired";
  return "live";
}

/** The Link's value in `LINKS`: a tombstone once deleted, which drops the Target URL and Expiry (ADR 0008). */
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

/** A void record's line: the Link, and the `deleted_at` of the one delete it voids (ADR 0028). */
export interface VoidRecord extends LinkId {
  readonly deletedAt: number;
}

/**
 * Merges every record the change log holds for one Link: the deleted one
 * wins, unless that delete is voided, in which case it counts as absent
 * (ADRs 0008, 0019, 0028). A Link's fields never change, so the merge needs no
 * ordering. `null` when nothing is left, every record being a voided delete.
 */
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

/** Who deletes: a Creator, only its own Links, or the Operator, any Link (ADR 0005). */
export type Deleter = { readonly kind: "creator"; readonly creatorId: CreatorId } | { readonly kind: "operator" };

export type DeleteResult =
  | { readonly deleted: true; readonly link: Link }
  | { readonly deleted: false; readonly reason: "not_found" | "already_deleted" };

/**
 * Deletes a Link: records when and by whom, erases the Target URL and keeps
 * only its hash (ADR 0019). Another Creator's Link reads as not found, so a
 * Creator learns nothing about Links it doesn't own. A `LinkRegistry` adapter
 * applies this inside its own atomic read-and-write.
 */
export async function applyDelete(link: Link | null, deleter: Deleter, at: number): Promise<DeleteResult> {
  if (link === null) return { deleted: false, reason: "not_found" };
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
