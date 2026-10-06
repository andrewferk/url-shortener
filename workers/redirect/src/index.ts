import { decideRedirect } from "@url-shortener/core";

export default {
  fetch(): Response {
    const decision = decideRedirect();
    return new Response(null, {
      status: decision.status,
      headers: { "Cache-Control": "no-store" },
    });
  },
} satisfies ExportedHandler;
