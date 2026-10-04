---
status: accepted
---

> Amended by [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md): force shedding is a Worker variable ORed with the cost brake's KV flag, not a KV flag written by OpenTofu.
>
> Amended by [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md): the cost brake's flag and the per-Creator daily-cap flag live in their own `FLAGS` KV namespace, as dated keys `brake:<utc-date>` and `cap:<creatorId>:<utc-date>`. The daily count is derived from the Creator list's `created_at`.
>
> Amended by [ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md): the brake's daily count is `sum(sample_interval * _sample_interval)` over the `shard-fallback` and `not-found` index values, so it stays correct once Analytics Engine samples.
>
> Amended by [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md): the shard-fallback limit bounds shard cost, not guessing, which runs at the edge ceiling's rate and is accepted. IPv6 misses also pass a /48 limiter (120 per 60 s). The brake's window is one UTC hour (125,000 lookups, flag `brake:<utc-hour>`, cached in isolate memory). The Status Worker sends a "Redirect flood" alert, and the spend alert is a manual step, not an OpenTofu resource.
>
> Amended by [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md): a per-Creator daily ceiling (`creator_daily_link_ceiling`, default 600) sits above the daily cap. Past it, the Creator's object takes down every further Link of that UTC day as it arrives and suspends the Creator. The Status Worker sends a "Creator at daily cap" email.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): the spend alert is a manual step, because OpenTofu can't own one, with Cloudflare's automatic $10 alert as the backstop. Failed authentication checks the key's shape before the KV read, and consults the limiter first once an IP is over it. IP-keyed limits are cited as a deliberate deviation from Cloudflare's advice. "A Workflow for the cost brake" joins the considered options, rejected.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the two guessing claims in the body follow ADR 0022.

# Protect against abuse with one edge flood ceiling, Worker-side limits on the shard fallback and on Creators, and a daily cost brake

On the Free zone plan ([ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)), Cloudflare gives us:

- one rate limiting rule, which counts per IP over 10 s and can't tell a 404 from a 302;
- unmetered DDoS mitigation;
- no spend cap: budget alerts are informational and fire the next day.

Every Worker request, KV read and Durable Object call is billed. The costly abuse is a flood of well-formed but unknown Short codes, because each one misses KV and falls back to its shard. So we block coarse floods at the edge, where blocked requests are never billed. The finer limits go inside the Worker, on exactly the expensive paths: the shard fallback and Link creation. A daily brake stops the shard fallback before an attack can blow the budget.

In priority order, we protect Redirect availability, then cost, then against Creator misuse, then against Short code guessing.

Decided in [How are Redirects and Link creation protected from abuse?](https://github.com/andrewferk/url-shortener/issues/8).

## Decision

- **Edge flood ceiling:** the zone's single rate limiting rule matches every path on every hostname of the zone.
  - It allows **300 requests per 10 s per IP**, counted per data center.
  - Over that, the IP is blocked for 10 s with Cloudflare's own 429 page, which has no custom body and no `Retry-After` on Free.
- **Malformed Short codes never reach storage.** The domain core answers 404 immediately when a path can't be a Short code. A path passes only if it is 7 base62 characters, or a valid, unreserved Custom alias (3–32 characters of `[A-Za-z0-9_-]`).
  - This check costs no KV read and no shard call.
- **Shard-fallback limit:** on every KV miss, the Worker checks a Workers rate limiter binding before calling the shard.
  - The key is the client IP: the full address for IPv4, the /64 prefix for IPv6.
  - The limit is **30 per 60 s**. Over it, the Worker answers **429 with `Retry-After: 60`** and never calls the shard.
  - Real Visitors almost never miss KV, because only Links under about 60 s old do. The limit bounds shard cost, not guessing: it is checked only after a KV miss, so a guess that hits a live Link never reaches it. The guess rate is the edge ceiling's, about 2.6M a day per IP per data center, which at 1B Links finds about 740 live Links a day ([ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md)).
- **Daily cost brake:** a Cron Trigger on the Redirect Worker runs every 5 minutes.
  - It sums today's weighted Redirect events that reached a shard (`shard-fallback`, `not-found`) from Analytics Engine.
  - Above **3M per UTC day**, it sets a KV flag that stays set until midnight UTC.
  - While the flag is set, a KV miss answers **503 with `Retry-After`** instead of calling the shard. We never claim a Link doesn't exist when we didn't check.
  - The Worker reads the flag only on the KV-miss path, cached for 60 s.
  - 3M a day sustained for a month is about $13 of Durable Object requests, inside the budget's headroom. The threshold is an IaC variable.
- **Creator limits:** both numbers are IaC variables.
  - **Burst:** `creator_burst_per_minute` = 60, enforced by a Workers rate limiter keyed by Creator. Over it, the API answers 429 with `Retry-After`.
  - **Daily cap:** `creator_daily_link_cap` = **300**, a global circuit breaker per Creator.
    - The Creator's Durable Object counts today's new Links as they arrive through the shard's outbox. Those arrivals are keyed by Short code, so a retried outbox write doesn't double-count.
    - At the cap, the object writes a per-Creator KV flag that stays until midnight UTC. The create path reads that flag and answers 429 with `Retry-After` set to midnight UTC.
    - The cap is soft: outbox and KV lag let a Creator overshoot it by up to a few minutes' worth of creates.
    - The Creator's Durable Object stays a pure projection, off the create request path.
- **Unauthenticated API calls:** a Workers rate limiter keyed by client IP (IPv6 /64) allows **10 failed authentications per 60 s**, then answers 429. This applies whatever authentication mechanism is chosen.
  - **A credential that can't be valid costs no KV read.** The Worker checks the shape of the key (`lk_<keyId>_<secret>`, [ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)) before it reads `AUTH`, and a malformed one counts as a failed authentication.
  - **Once an IP is over the limit, the limiter is consulted before the lookup,** so further attempts from it answer 429 without a KV read. Under the limit, the lookup comes first and only a failure is counted.
- **No challenges anywhere:**
  - **Bot Fight Mode is off**, because it can't be skipped on Free and it challenges link previewers and API clients.
  - **Under Attack mode is off.**
  - **The HTTP DDoS managed ruleset stays at Cloudflare's defaults.**
  - All three are set explicitly in OpenTofu.
- **No default blocks:** no country, ASN or IP range is blocked at launch.
- **Manual levers,** in order of preference:
  1. **Emergency block:** one reserved WAF custom rule that blocks by IP list, country or ASN. It is driven by OpenTofu variables that are empty by default, and it changes by PR. A dashboard edit is allowed in an emergency, but it must be back-ported, or the next `tofu apply` reverts it.
  2. **Force shedding:** an OpenTofu variable that sets the cost brake's flag regardless of the count.
  3. **Under Attack mode:** a last resort, because it breaks link previewers and API clients.

  A runbook in the repo maps symptoms to levers.
- **Redirect events:** the outcomes from [ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md) gain three new values:

  | Outcome | Meaning |
  |---|---|
  | `malformed` | Rejected by the shape check; no lookup |
  | `rate-limited` | The shard-fallback limit's 429 |
  | `shed` | The cost brake's 503 |

  The Status page shows each one as its own slice of volume. Requests blocked at the edge never reach the Worker, so they stay invisible to the Status page.
- **Spend alert:** a Cloudflare budget alert, set by hand in the dashboard as a step of the first prod deploy's checklist. OpenTofu can't own it: no API endpoint or provider resource for a budget alert is documented. Cloudflare also creates a $10 account-level budget alert by default on pay-as-you-go accounts that have none, which is the backstop. Either fires the day after the threshold is reached, so it's a notification, not a brake.

## Cost

**Today:** $0 extra. The rate limiter bindings, the Cron Trigger and the KV flags fit Workers Paid's included amounts.

**Under attack:**
- The edge ceiling costs nothing, because blocked requests aren't billed.
- What gets past it is billed as Worker requests and KV reads, about $0.80 per extra 1M. Nothing on Free can cap that.
- The brake caps only the Durable Object part.
- The budget alert, [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md)'s flood alert and the manual levers cover the rest.

## Considered options

- **A Pro zone** ($20–25/mo, over budget). It adds a second rate limiting rule scoped by hostname, longer windows and block durations, a custom 429 body, and Super Bot Fight Mode with skip rules. It still can't count 404s at the edge, which needs Business, so the shard-fallback limit would stay in the Worker. The gain was too small for the price.
- **Counting 404s after the shard answers.** Every counted miss would already have cost a Durable Object call. Gating the fallback itself limits the expensive step.
- **Challenging Visitors** (managed challenge, Bot Fight Mode, Under Attack mode by default). Many Visitors aren't browsers: link previewers, email scanners, `curl`. A plain 429 at least tells them what happened.
- **Rate limiting every Redirect per IP tightly.** Carrier-grade NAT and corporate egress put thousands of real Visitors behind one IP. Only misses get a tight limit.
- **Answering 404 while the cost brake is on.** A Link created less than a minute ago would falsely look nonexistent. 503 is honest and shows as errors on the Status page.
- **Burst limit alone for Creators.** Rate limiter counts are kept separately in each Cloudflare location. A stolen credential used from many locations could create about 18k Links a minute, costing about $130 a day plus permanent junk Links. The daily cap is the only global limit.
- **A synchronous quota check in the Creator's Durable Object before each claim.** Exact, but it puts that object on the create path, with extra latency and a fail-open-or-closed choice. The soft cap from the outbox avoids both.
- **Capping by the number of bursts per day.** Counting minutes of activity lets a distributed attacker fit everything into one minute. Counting trips of the burst limit never fires against an attacker who stays just under it in every location. Counting Links bounds the damage directly.
- **A Workflow for the cost brake's count,** in place of the Cron Trigger. Rejected for the same reasons as for the rollup (ADR 0003): Workflows depend on Durable Objects, the very thing the brake protects, and a run that fails is simply repeated five minutes later.
- **A global request counter in a Durable Object for the cost brake.** Exact, but it adds a billed call to every fallback, doubling the cost it protects against.

## Consequences

- **ADR 0001's promise weakens under attack.** ADR 0001 says a new Link "never answers not-found to its first Visitors". While the brake is on, a Link under about 60 s old answers 503 until KV has it. It still never answers 404.
- **Only the edge sees floods that are blocked there.** The Status page's volume excludes them, and on Free there's no per-request edge log.
- **The limits are approximate.** Both the edge rule and the rate limiter bindings count per location, and the daily cap lags by minutes. They bound damage; they are not an accounting system.
- **The one rate limiting rule is used up.** Any other edge rate limit, for example for a preview environment on the same zone, has to share it or move into the Worker.
- **Keying limits on the client IP goes against Cloudflare's advice,** knowingly. The rate limiting binding's docs say "It is not recommended to use IP addresses or locations (regions or countries), since these can be shared by many users in many valid cases." The shard-fallback and failed-authentication limits are keyed on the IP anyway, because a Visitor is anonymous and no better key exists. Only misses and failed logins are limited, which keeps the shared-IP cost small.
- **Custom aliases are guessable by design.** Only the edge ceiling slows guessing them: a 1M-word dictionary takes about 9 hours ([ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md)).
