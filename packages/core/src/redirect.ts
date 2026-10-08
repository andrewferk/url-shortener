import { linkState } from "./link.ts";
import type { Clock, LinkReader, NamespaceResolver } from "./ports.ts";
import { isPossibleShortCode } from "./short-code.ts";

export interface RedirectRequest {
  readonly hostname: string;
  /** The URL's path, with its leading `/`. */
  readonly path: string;
}

export interface RedirectPorts {
  readonly namespaces: NamespaceResolver;
  readonly links: LinkReader;
  readonly clock: Clock;
}

export type RedirectDecision =
  | { readonly status: 302; readonly location: string }
  | { readonly status: 404; readonly reason: "malformed" | "not-found" }
  | { readonly status: 410; readonly reason: "expired" | "deleted" };

export async function decideRedirect(request: RedirectRequest, ports: RedirectPorts): Promise<RedirectDecision> {
  const shortCode = request.path.startsWith("/") ? request.path.slice(1) : "";
  if (!isPossibleShortCode(shortCode)) return { status: 404, reason: "malformed" };
  const namespace = await ports.namespaces.resolve(request.hostname);
  if (namespace === null) return { status: 404, reason: "malformed" };
  const value = await ports.links.read({ namespace, shortCode });
  if (value === null) return { status: 404, reason: "not-found" };
  if (value.state === "deleted") return { status: 410, reason: "deleted" };
  if (linkState(value, ports.clock.now()) === "expired") return { status: 410, reason: "expired" };
  return { status: 302, location: value.targetUrl };
}
