import type { Link } from "./link.ts";
import type { EpochMs } from "./link-id.ts";
import type { AuthenticatedCreator, Clock, LinkRegistry, ShortCodeGenerator } from "./ports.ts";
import { validateCustomAlias } from "./short-code.ts";

export interface CreateLinkRequest {
  readonly creator: AuthenticatedCreator;
  readonly targetUrl: string;
  readonly customAlias?: string;
  readonly expiresAt?: EpochMs;
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

const MAX_DRAWS = 8;

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
