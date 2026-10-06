// In-memory adapters for every port, so the core runs under plain Node with
// nothing else (ADR 0001). They hold the same rules the Cloudflare adapters
// do, without the durability.
import type { LinksValue } from "./encoding.ts";
import { applyDelete, type DeleteResult, type Deleter, type Link, type LinkId, type NamespaceId, toLinksValue } from "./link.ts";
import type {
  AuthenticatedCreator,
  ClaimResult,
  Clock,
  CreatorAuthenticator,
  LinkReader,
  LinkRegistry,
  NamespaceResolver,
  RedirectEvent,
  RedirectRecorder,
  ShortCodeGenerator,
} from "./ports.ts";

/**
 * One store behind both `LinkRegistry` and `LinkReader`, like a shard
 * answering a KV miss. A Link's row is kept for good once claimed, deleted or
 * not, so a Short code is never reissued (ADR 0002).
 */
export class InMemoryLinkStore implements LinkRegistry, LinkReader {
  readonly #links = new Map<string, Link>();

  claim(link: Link): Promise<ClaimResult> {
    const existing = this.#links.get(storeKey(link));
    if (existing !== undefined) return Promise.resolve({ claimed: false, existing });
    this.#links.set(storeKey(link), link);
    return Promise.resolve({ claimed: true });
  }

  async delete(id: LinkId, deleter: Deleter, at: number): Promise<DeleteResult> {
    const result = await applyDelete(this.#links.get(storeKey(id)) ?? null, deleter, at);
    if (result.deleted) this.#links.set(storeKey(id), result.link);
    return result;
  }

  read(id: LinkId): Promise<LinksValue | null> {
    const link = this.#links.get(storeKey(id));
    return Promise.resolve(link === undefined ? null : toLinksValue(link));
  }
}

// The store's own map key, not a `LINKS` key. Neither a Namespace ID nor a
// Short code contains `:` (ADR 0014), so it is unambiguous.
function storeKey(id: LinkId): string {
  return `${id.namespace}:${id.shortCode}`;
}

/** Proposes the given Short codes in order, and throws once they run out. */
export class SequenceShortCodeGenerator implements ShortCodeGenerator {
  readonly #codes: string[];

  constructor(codes: Iterable<string>) {
    this.#codes = [...codes];
  }

  generate(): string {
    const next = this.#codes.shift();
    if (next === undefined) throw new Error("SequenceShortCodeGenerator ran out of Short codes");
    return next;
  }
}

/** A Clock that moves only when told to. */
export class ManualClock implements Clock {
  #now: number;

  constructor(now: number) {
    this.#now = now;
  }

  now(): number {
    return this.#now;
  }

  set(now: number): void {
    this.#now = now;
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

/** Keeps every Redirect event it is given, in order. */
export class InMemoryRedirectRecorder implements RedirectRecorder {
  readonly events: RedirectEvent[] = [];

  record(event: RedirectEvent): void {
    this.events.push(event);
  }
}

/** Authenticates from a fixed table of credentials. Anything not in it is `null`. */
export class InMemoryCreatorAuthenticator implements CreatorAuthenticator {
  readonly #creators: ReadonlyMap<string, AuthenticatedCreator>;

  constructor(creators: Readonly<Record<string, AuthenticatedCreator>>) {
    this.#creators = new Map(Object.entries(creators));
  }

  authenticate(credential: string): Promise<AuthenticatedCreator | null> {
    return Promise.resolve(this.#creators.get(credential) ?? null);
  }
}

/** Maps each Short domain to its Namespace from a fixed table, as a Deployment's config does (ADR 0014). */
export class StaticNamespaceResolver implements NamespaceResolver {
  readonly #namespaces: ReadonlyMap<string, NamespaceId>;

  constructor(namespaces: Readonly<Record<string, NamespaceId>>) {
    this.#namespaces = new Map(Object.entries(namespaces).map(([hostname, namespace]) => [hostname.toLowerCase(), namespace]));
  }

  resolve(hostname: string): Promise<NamespaceId | null> {
    return Promise.resolve(this.#namespaces.get(hostname.toLowerCase()) ?? null);
  }
}
