// These encodings are permanent: changing one once data exists means moving
// every Link.
import type { CreatorId, EpochMs, LinkId, NamespaceId } from "./link-id.ts";
import { BASE62_ALPHABET, GENERATED_LENGTH } from "./short-code.ts";

export function fold(shortCode: string): string {
  // Not `toLowerCase`: Unicode case mapping would move some non-ASCII strings onto an ASCII code's shard.
  return shortCode.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export async function shardNumber(namespace: NamespaceId, shortCode: string): Promise<number> {
  const digest = await sha256(`${namespace}:${fold(shortCode)}`);
  return digest[0] ?? 0;
}

export function shardObjectName(shard: number): string {
  return `shard-${String(shard)}`;
}

export function creatorObjectName(creatorId: CreatorId): string {
  return creatorId;
}

export async function linksKey(id: LinkId): Promise<string> {
  const shard = await shardNumber(id.namespace, id.shortCode);
  return `${shard.toString(16).padStart(2, "0")}:${id.namespace}:${id.shortCode}`;
}

export type LinksValue = LiveLinksValue | TombstoneLinksValue;

export interface LiveLinksValue {
  readonly state: "live";
  readonly targetUrl: string;
  readonly expiresAt?: EpochMs;
  readonly creatorId: CreatorId;
  readonly createdAt: EpochMs;
}

export interface TombstoneLinksValue {
  readonly state: "deleted";
  readonly creatorId: CreatorId;
  readonly createdAt: EpochMs;
  readonly deletedAt: EpochMs;
  readonly deletedBy: DeletedBy;
}

export type DeletedBy = "creator" | "operator";

export function encodeLinksValue(value: LinksValue): string {
  // Key order is part of the stored format, so these literals must not be reordered.
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

/** Throws on a value it can't read: that is a bug, never a 404. */
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

export async function keyedCandidate(creatorId: CreatorId, idempotencyKey: string, candidateIndex: number): Promise<string> {
  const digest = await sha256(`${creatorId}:${idempotencyKey}:${String(candidateIndex)}`);
  let value = new DataView(digest.buffer).getBigUint64(0) % CODE_SPACE;
  let shortCode = "";
  for (let i = 0; i < GENERATED_LENGTH; i++) {
    shortCode = BASE62_ALPHABET.charAt(Number(value % 62n)) + shortCode;
    value /= 62n;
  }
  return shortCode;
}

const CODE_SPACE = 62n ** BigInt(GENERATED_LENGTH);

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
