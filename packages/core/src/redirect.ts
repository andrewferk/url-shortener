// A placeholder: until a Link can exist, every Redirect is a 404.
export interface RedirectDecision {
  readonly status: 404;
}

export function decideRedirect(): RedirectDecision {
  return { status: 404 };
}
