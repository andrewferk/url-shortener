import { type Clock, decideRedirect, type LinkReader, StaticNamespaceResolver } from "@url-shortener/core";

// Until slice 1.3 renders the Short domains from deployment config and reads
// `LINKS`, no hostname maps to a Namespace and no Link exists, so every
// Redirect is a 404.
const namespaces = new StaticNamespaceResolver({});
const links: LinkReader = { read: () => Promise.resolve(null) };
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
