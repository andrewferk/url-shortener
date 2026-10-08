import type { LinksValue } from "./encoding.ts";
import type { DeleteResult, Deleter, Link } from "./link.ts";
import type { CreatorId, EpochMs, LinkId, NamespaceId } from "./link-id.ts";

export interface LinkReader {
  read(id: LinkId): Promise<LinksValue | null>;
}

/**
 * The only guard on Short code uniqueness: a claim inserts only if no Link,
 * live, Expired or Deleted, already holds that `(Namespace, Short code)`.
 */
export interface LinkRegistry {
  claim(link: Link): Promise<ClaimResult>;
  delete(id: LinkId, deleter: Deleter, at: number): Promise<DeleteResult>;
}

export type ClaimResult = { readonly claimed: true } | { readonly claimed: false; readonly existing: Link };

export interface ShortCodeGenerator {
  generate(): string;
}

export interface Clock {
  now(): EpochMs;
}

export interface NamespaceResolver {
  resolve(hostname: string): Promise<NamespaceId | null>;
}

export interface RedirectRecorder {
  record(event: RedirectEvent): void;
}

export interface RedirectEvent {
  /** `null` when the hostname maps to no Namespace. */
  readonly namespace: NamespaceId | null;
  readonly shortCode: string;
  readonly source: "visitor" | "probe";
  readonly outcome: RedirectOutcome;
  readonly status: number;
  readonly durationMs: number;
}

export type RedirectOutcome =
  | "colo-hit"
  | "kv-hit"
  | "shard-fallback"
  | "not-found"
  | "gone"
  | "malformed"
  | "rate-limited"
  | "shed"
  | "error";

export interface CreatorAuthenticator {
  /** Every failure is the same `null`, so the Link API can answer one uniform 401. */
  authenticate(credential: string): Promise<AuthenticatedCreator | null>;
}

export interface AuthenticatedCreator {
  readonly id: CreatorId;
  readonly namespace: NamespaceId;
}
