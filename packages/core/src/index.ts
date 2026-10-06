// The public surface of @url-shortener/core. The Workers import only what is
// exported here, through the package's `exports` map (ADR 0015).
export { decideRedirect, type RedirectDecision } from "./redirect.ts";
