import { type Clock, decideRedirect, type LinkReader, StaticNamespaceResolver } from "@url-shortener/core";

// No Short domain is configured and `LINKS` is not read yet, so no hostname
// maps to a Namespace, no Link exists, and every Redirect is a 404.
const namespaces = new StaticNamespaceResolver({});
const links: LinkReader = { read: async () => null };
const clock: Clock = { now: () => Date.now() };

export default {
  async fetch(request): Promise<Response> {
    const { hostname, pathname } = new URL(request.url);
    const decision = await decideRedirect({ hostname, path: pathname }, { namespaces, links, clock });
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (decision.status === 302) headers.set("Location", decision.location);
    return new Response(null, { status: decision.status, headers });
  },
} satisfies ExportedHandler;
