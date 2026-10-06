// A placeholder for the Redirect decision, which slice 1.2 replaces with 302,
// 404 and 410 Gone. Until then no Link exists, so every Redirect is a 404.
export interface RedirectDecision {
  readonly status: 404;
}

export function decideRedirect(): RedirectDecision {
  return { status: 404 };
}
