// Every permanent encoding the service writes. Each function here is pinned by
// test vectors and never changes once data exists (ADR 0008): changing one
// means moving every Link.
import type { CreatorId, LinkId, NamespaceId } from "./link.ts";
import { BASE62_ALPHABET, GENERATED_LENGTH } from "./short-code.ts";

/** Lowercases ASCII letters, the only case a Short code can have (ADR 0018). */
export function fold(shortCode: string): string {
  return shortCode.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * The shard a Link lives on, 0–255: the first byte of SHA-256 over the UTF-8
 * bytes of `<Namespace ID>:<fold(Short code)>` (ADRs 0008, 0014, 0018). Every
 * case variant of a Short code lands on the same shard.
 */
export async function shardNumber(namespace: NamespaceId, shortCode: string): Promise<number> {
  const digest = await sha256(`${namespace}:${fold(shortCode)}`);
  return digest[0] ?? 0;
}

/** Shard n's Durable Object name, with n in decimal (ADR 0008). */
export function shardObjectName(shard: number): string {
  return `shard-${String(shard)}`;
}

/** A Creator's Durable Object name: its Creator ID (ADR 0008). */
export function creatorObjectName(creatorId: CreatorId): string {
  return creatorId;
}

/**
 * A Link's key in `LINKS`: `<shard as 2 lowercase hex digits>:<Namespace ID>:<Short code>`,
 * with the exact, case-sensitive Short code (ADRs 0008, 0014, 0018).
 */
export async function linksKey(id: LinkId): Promise<string> {
  const shard = await shardNumber(id.namespace, id.shortCode);
  return `${shard.toString(16).padStart(2, "0")}:${id.namespace}:${id.shortCode}`;
}

/**
 * What `LINKS` holds for one Link: everything a Redirect needs, plus the
 * Creator and creation time that make KV a second copy (ADR 0008). The shard
 * answers a KV miss with the same shape.
 */
export type LinksValue = LiveLinksValue | TombstoneLinksValue;

export interface LiveLinksValue {
  readonly state: "live";
  readonly targetUrl: string;
  /** Epoch ms. Absent when the Link has no Expiry. */
  readonly expiresAt?: number;
  readonly creatorId: CreatorId;
  readonly createdAt: number;
}

/** A Deleted link's value: no Target URL and no Expiry (ADRs 0008, 0028). */
export interface TombstoneLinksValue {
  readonly state: "deleted";
  readonly creatorId: CreatorId;
  readonly createdAt: number;
  readonly deletedAt: number;
  readonly deletedBy: DeletedBy;
}

/** A Creator's own delete, or the Operator's Takedown. */
export type DeletedBy = "creator" | "operator";

/**
 * The `v:1` JSON stored in `LINKS`. Key order is part of the format:
 * live `{"v":1,"t":…,"e":…,"c":…,"ts":…}`, with `e` left out when there is no
 * Expiry, and tombstone `{"v":1,"d":1,"c":…,"ts":…,"dt":…,"by":…}`.
 */
export function encodeLinksValue(value: LinksValue): string {
  if (value.state === "deleted") {
    return JSON.stringify({
      v: 1,
      d: 1,
      c: value.creatorId,
      ts: value.createdAt,
      dt: value.deletedAt,
      by: value.deletedBy,
    });
  }
  return JSON.stringify({
    v: 1,
    t: value.targetUrl,
    ...(value.expiresAt === undefined ? {} : { e: value.expiresAt }),
    c: value.creatorId,
    ts: value.createdAt,
  });
}

/**
 * Reads a `LINKS` value already parsed from JSON (KV's `type: "json"`). It
 * reads every `v` ever written, which today is only `v:1`, and throws on
 * anything else: a value this code can't read is a bug, never a 404.
 */
export function decodeLinksValue(json: unknown): LinksValue {
  if (!isRecord(json) || json["v"] !== 1) throw new Error("Unreadable LINKS value: unknown version");
  const creatorId = json["c"];
  const createdAt = json["ts"];
  if (typeof creatorId !== "string" || typeof createdAt !== "number") {
    throw new Error("Unreadable LINKS value: missing Creator or creation time");
  }
  if (json["d"] === 1) {
    const deletedAt = json["dt"];
    const deletedBy = json["by"];
    if (typeof deletedAt !== "number" || (deletedBy !== "creator" && deletedBy !== "operator")) {
      throw new Error("Unreadable LINKS value: tombstone without deletion time or deleter");
    }
    return { state: "deleted", creatorId, createdAt, deletedAt, deletedBy };
  }
  const targetUrl = json["t"];
  const expiresAt = json["e"];
  if (typeof targetUrl !== "string") throw new Error("Unreadable LINKS value: missing Target URL");
  if (expiresAt !== undefined && typeof expiresAt !== "number") {
    throw new Error("Unreadable LINKS value: Expiry is not a number");
  }
  return {
    state: "live",
    targetUrl,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    creatorId,
    createdAt,
  };
}

/**
 * Candidate n (0, 1, 2, …) for a keyed create's generated Short code
 * (ADR 0009): SHA-256 over the UTF-8 bytes of `<Creator ID>:<key>:<n>`, with n
 * in decimal; the first 8 bytes read as a big-endian unsigned integer, reduced
 * mod 62^7, and base62-encoded, zero-padded to 7 characters.
 */
export async function keyedCandidate(creatorId: CreatorId, idempotencyKey: string, n: number): Promise<string> {
  const digest = await sha256(`${creatorId}:${idempotencyKey}:${String(n)}`);
  let value = new DataView(digest.buffer).getBigUint64(0) % CODE_SPACE;
  let shortCode = "";
  for (let i = 0; i < GENERATED_LENGTH; i++) {
    shortCode = BASE62_ALPHABET.charAt(Number(value % 62n)) + shortCode;
    value /= 62n;
  }
  return shortCode;
}

const CODE_SPACE = 62n ** BigInt(GENERATED_LENGTH);

/**
 * The value of `target_url_sha256`: lowercase hex SHA-256 over the UTF-8 bytes
 * of the stored, normalized Target URL (ADR 0019).
 */
export async function targetUrlSha256(targetUrl: string): Promise<string> {
  const digest = await sha256(targetUrl);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
