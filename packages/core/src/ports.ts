// The core's ports (ADRs 0001, 0005, 0014). The Workers implement them as
// adapters over Cloudflare; `in-memory.ts` implements them for tests and for
// embedders who bring nothing else.
import type { LinksValue } from "./encoding.ts";
import type { DeleteResult, Deleter, Link } from "./link.ts";
import type { CreatorId, LinkId, NamespaceId } from "./link-id.ts";

/** Reads a Link for a Redirect, in the shape `LINKS` holds (ADR 0008). */
export interface LinkReader {
  read(id: LinkId): Promise<LinksValue | null>;
}

/**
 * The atomic claim, and delete. The only place Short code uniqueness is
 * guaranteed (ADRs 0001, 0002): a claim inserts only if no Link, live,
 * Expired or Deleted, already holds that `(Namespace, Short code)`.
 */
export interface LinkRegistry {
  claim(link: Link): Promise<ClaimResult>;
  delete(id: LinkId, deleter: Deleter, at: number): Promise<DeleteResult>;
}

/** On a failed claim, the Link that already holds the Short code. */
export type ClaimResult = { readonly claimed: true } | { readonly claimed: false; readonly existing: Link };

/** Proposes candidate Short codes. A candidate is only claimed through `LinkRegistry`. */
export interface ShortCodeGenerator {
  generate(): string;
}

/** The current time, as epoch milliseconds. */
export interface Clock {
  now(): number;
}

/** Maps a request's hostname to the Namespace its Short domain serves (ADR 0014). */
export interface NamespaceResolver {
  resolve(hostname: string): Promise<NamespaceId | null>;
}

/** Records one Redirect event (ADRs 0003, 0006, 0020). */
export interface RedirectRecorder {
  record(event: RedirectEvent): void;
}

export interface RedirectEvent {
  /** `null` when the hostname maps to no Namespace. */
  readonly namespace: NamespaceId | null;
  /** The requested path's Short code, as requested. */
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

/**
 * Turns a credential (an API key, or a GitHub OIDC token for CI) into the
 * Creator it authenticates, or `null`. Every failure is the same `null`, so
 * the Link API can answer one uniform 401 (ADR 0005).
 */
export interface CreatorAuthenticator {
  authenticate(credential: string): Promise<AuthenticatedCreator | null>;
}

/** A Creator is bound to exactly one Namespace when it is admitted (ADR 0014). */
export interface AuthenticatedCreator {
  readonly id: CreatorId;
  readonly namespace: NamespaceId;
}
