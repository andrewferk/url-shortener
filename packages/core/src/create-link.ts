import type { Link } from "./link.ts";
import type { AuthenticatedCreator, Clock, LinkRegistry, ShortCodeGenerator } from "./ports.ts";
import { validateCustomAlias } from "./short-code.ts";

export interface CreateLinkRequest {
  readonly creator: AuthenticatedCreator;
  readonly targetUrl: string;
  readonly customAlias?: string;
  /** Epoch ms. */
  readonly expiresAt?: number;
}

export interface CreateLinkPorts {
  readonly registry: LinkRegistry;
  readonly generator: ShortCodeGenerator;
  readonly clock: Clock;
}

export type CreateLinkResult =
  | { readonly created: true; readonly link: Link }
  | { readonly created: false; readonly reason: "invalid_alias"; readonly problem: "length" | "characters" | "reserved" }
  | { readonly created: false; readonly reason: "alias_taken" | "unavailable" };

/** How many generated Short codes a create draws before giving up (ADR 0002's small, bounded retry budget). */
const MAX_DRAWS = 8;

/**
 * Creates a Link in the Creator's Namespace (ADR 0014), claiming its Short
 * code through the registry, the only guard on uniqueness (ADR 0002). A
 * generated Short code that is already claimed is drawn again; a Custom alias
 * that is claimed, by a live, Expired or Deleted link, is taken for good.
 */
export async function createLink(request: CreateLinkRequest, ports: CreateLinkPorts): Promise<CreateLinkResult> {
  const link = (shortCode: string, customAlias: boolean): Link => ({
    namespace: request.creator.namespace,
    shortCode,
    targetUrl: request.targetUrl,
    creatorId: request.creator.id,
    customAlias,
    createdAt: ports.clock.now(),
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
  });

  if (request.customAlias !== undefined) {
    const validation = validateCustomAlias(request.customAlias);
    if (!validation.valid) return { created: false, reason: "invalid_alias", problem: validation.reason };
    const aliased = link(request.customAlias, true);
    const claim = await ports.registry.claim(aliased);
    return claim.claimed ? { created: true, link: aliased } : { created: false, reason: "alias_taken" };
  }

  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    const generated = link(ports.generator.generate(), false);
    if ((await ports.registry.claim(generated)).claimed) return { created: true, link: generated };
  }
  return { created: false, reason: "unavailable" };
}
