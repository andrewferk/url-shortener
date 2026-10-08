import type { LinksValue } from "./encoding.ts";
import { applyDelete, type DeleteResult, type Deleter, type Link, toLinksValue } from "./link.ts";
import type { LinkId, NamespaceId } from "./link-id.ts";
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

// Neither a Namespace ID nor a Short code contains `:`, so this key is unambiguous.
function storeKey(id: LinkId): string {
  return `${id.namespace}:${id.shortCode}`;
}

/** Throws once the given Short codes run out. */
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

export class InMemoryRedirectRecorder implements RedirectRecorder {
  readonly events: RedirectEvent[] = [];

  record(event: RedirectEvent): void {
    this.events.push(event);
  }
}

export class InMemoryCreatorAuthenticator implements CreatorAuthenticator {
  readonly #creators: ReadonlyMap<string, AuthenticatedCreator>;

  constructor(creators: Readonly<Record<string, AuthenticatedCreator>>) {
    this.#creators = new Map(Object.entries(creators));
  }

  authenticate(credential: string): Promise<AuthenticatedCreator | null> {
    return Promise.resolve(this.#creators.get(credential) ?? null);
  }
}

export class StaticNamespaceResolver implements NamespaceResolver {
  readonly #namespaces: ReadonlyMap<string, NamespaceId>;

  constructor(namespaces: Readonly<Record<string, NamespaceId>>) {
    this.#namespaces = new Map(Object.entries(namespaces).map(([hostname, namespace]) => [hostname.toLowerCase(), namespace]));
  }

  resolve(hostname: string): Promise<NamespaceId | null> {
    return Promise.resolve(this.#namespaces.get(hostname.toLowerCase()) ?? null);
  }
}
