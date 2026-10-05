---
status: accepted
---

# Budget an ordinary month, alert on Request floods and Request spend, and make every outcome eligible unless excluded

The 2026-10-04 audit found three gaps in what the budget rule and the two request-based Objectives cover. Each was checked against the ADR text and holds:

- **`colo-hit` is in neither Objective.** [ADR 0006](./0006-redirect-caching-kv-values-colo-cache-no-store.md) made it the common 302. [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md) and [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md) list the outcomes that count, and neither list was updated.
- **The budget claims a worst month it can't keep.** The PRD's "about $18" is Workers Paid plus the cost brake's ceiling. It leaves out the Worker requests and KV reads an attacker must send to hold the brake there. And "about $13 a month at most" for shard lookups was worked out for a daily brake; under ADR 0022's hourly window the count can overshoot late in every hour.
- **Floods at `api.` and `status.` are invisible.** ADR 0022's flood alert counts Redirect events only. Requests to the Link API and the Status page are billed Worker requests too. So is a flood just under the alert's threshold, which costs about $200 a month and never fires it.

So the budget rule promises an ordinary month and says plainly that a month under attack has no cap. The flood alert counts every billed request and is renamed. A second, slower alert catches spend below the flood threshold. And the Objectives name the outcomes they leave out, so a new outcome counts until someone decides otherwise.

Decided in [Settle the audit's cost and Objective gaps](https://github.com/andrewferk/url-shortener/issues/80).

## Decision

### The budget rule is about an ordinary month

- **≤ $20 a month, the domain included, in a month with no attack.** At list prices:

  | When | Workers Paid | Left for the domain inside $20 |
  |---|---|---|
  | Until the preview account split ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)) | $5, one account | $15 a month |
  | After it, so from launch | $10, two accounts | $10 a month, about $120 a year |

- **A month under attack has no cap.** Nothing on the Free zone plan can stop a request that passes the edge ceiling from being billed ([ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)). The spec states the price, the alerts and the levers, and promises no figure:

  | What an attacker sends | Cost per 1M |
  |---|---|
  | A Redirect request for a live Link, or one the cost brake sheds | $0.80 (Worker request and KV read) |
  | A Redirect request that misses KV and reaches a shard | $0.95 ($0.80 plus the shard lookup) |
  | A request to `status.`, or to `api.` with a malformed or rate-limited key | $0.30 (Worker request) |
  | A request to `api.` that reads `AUTH` | $0.80 |

- **The "worst month" figure is withdrawn.** Holding the brake at its ceiling for a month takes 90M misses. Those cost about $13.50 in shard lookups and $72 in Worker requests and KV reads ($64 after Workers Paid's included 10M of each), so that month is about $82 to $90, not $18.
- **The PRD's Solution says about $10 a month plus the domain once launched,** and about $5 before the split.

### What the cost brake promises

- **Its name stays.** Its job is stated as it is: it keeps a flood off the shards and limits the shard share of the bill. It was never a bound on the bill.
- **The bound is a count, not a dollar figure.** At most 125,000 shard lookups in a UTC hour, plus whatever arrives before a trip takes effect. A trip can be late by one Cron interval (5 minutes) and the 60 s in-memory flag cache, so about 6 minutes, and under the hourly window that recurs every hour.

  | Miss rate, from many IPs | Extra shard lookups a month | Extra cost |
  |---|---|---|
  | 1,000 req/s | about 260M | about $39 |
  | 10,000 req/s | about 2.6B | about $390 |

- **"About $13 a month at most" is withdrawn.** What holds: a shard lookup adds $0.15 to a request that already costs $0.80 per 1M, so the shard share adds at most 19% to a flood's bill, and about 2% to a sustained one.
- **The Cron interval stays at 5 minutes.**

### The Request flood alert counts every billed request

- **ADR 0022's "Redirect flood" alert is renamed "Request flood".** It counts every request that reaches a Worker on any of the deployment's hostnames: Redirect events of every source and outcome, as before, plus requests to `api.` and `status.`.
- **Request events.** The `redirect` Worker, for the Link API, and the `status` Worker each write one data point per request to a second Analytics Engine dataset, `request_events`.
  - Index: `<hostname>:<status class>`, for example `api:4xx` or `status:2xx`. About ten values.
  - It carries no IP, path, Creator ID or key ID.
  - It is counted as [ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md) counts Redirect events, `sum(sample_interval * _sample_interval)`, and is unsampled by default.
  - A Redirect never writes one. It already writes a Redirect event.
  - Previews write them too. The alerts stay in prod.
- **Each rollup bucket stores one more additive count,** the requests counted from both datasets.
- **The threshold is unchanged:** `flood_alert_requests_per_second`, default 100, now on the sum. The firing and resolving rule is ADR 0022's.
- **The email prices the rate at $0.80 per 1M,** as before. For `api.` and `status.` requests that is an upper bound.

### The Request spend alert

- **The Status Worker sends a "Request spend" alert** when the requests counted over the trailing 24 hours, priced at $0.80 per 1M, pass an input:

  | Variable | Default |
  |---|---|
  | `spend_alert_dollars_per_day` | 1 |

  At the default that is 1.25M requests in 24 hours, a pace of about $30 a month.
- **It is evaluated at the end of each 5-minute rollup,** from the hourly buckets topped up with the current hour's 5-minute buckets. It sends one email when it starts and one when it resolves, in prod only, with ADR 0011's alert state and email rules.
- **One price for every request.** It is an upper bound, and it ignores Workers Paid's included 10M requests a month. An Operator whose honest traffic passes $1 a day raises the input.
- **Cloudflare's own budget alert stays** as the by-hand backstop (ADR 0004). It is the only signal that reads the real bill.

### Every outcome is eligible unless excluded

- **Eligible Redirects are Visitor Redirects (`source=visitor`) of every outcome except those an Objective excludes:**

  | Objective | Excluded outcomes |
  |---|---|
  | Redirect latency | `malformed`, `rate-limited`, `shed`, `not-found` |
  | Error rate | `malformed`, `rate-limited`, `shed` |

  The reasons are ADR 0011's and ADR 0022's, unchanged.
- **`colo-hit` is eligible for both.** It is a Visitor Redirect answered from a lookup, and by ADR 0006's assumption it is about 90% of them at peak.
- **One table in the domain core classifies every outcome for each Objective,** typed so that adding an outcome without classifying it fails the build.
- **If ADR 0006's spike drops the per-colo cache,** `colo-hit` disappears and this rule needs no change.

## Cost

**Today:** $0 extra. Request events fit Analytics Engine's included data points, and the new alert is one more condition in a rollup that already runs.

**Under attack:** a flood at `api.` or `status.` writes one data point per request. If Cloudflare starts billing Analytics Engine as its pricing page warns ([ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md)), that adds $0.25 per 1M to requests that cost $0.30 to $0.80.

## Considered options

- **Promising a month under attack too.** It needs an automatic stop, such as the flood alert setting a block or Under Attack mode. ADR 0022 rejected that: nothing can tell an attack from a popular Link, and the Operator decides.
- **Keeping "about $18" with the missing costs added.** A worst month of about $90 is not a worst month either. An attacker who sends more pays nothing more for it.
- **A 1-minute Cron for the brake.** It cuts the overshoot to about 2 minutes an hour for five times the Analytics Engine queries. The overshoot is a small share of a bill that has no cap anyway.
- **Accepting floods at `api.` and `status.` as a gap.** They are cheaper per request and pass the same per-IP ceiling. But 1,000 req/s at `status.` is about $26 a day, noticed a day late.
- **Reading Cloudflare's invocation counts from the GraphQL Analytics API.** No writes, and it would cover every Worker. It needs a new read permission on the Status Worker and rests on behaviour nobody has measured.
- **Writing `api.` and `status.` requests as Redirect events.** A Redirect event is the record of one Redirect. They would also land in the volume graph and the Objectives' queries.
- **Keeping the name "Redirect flood" with a wider definition.** A flood aimed only at `status.` would arrive as a "Redirect flood" email with no Redirects in it.
- **Per-path prices in the spend alert.** Closer to the bill, but four constants that drift with Cloudflare's price list. One upper-bound price errs toward an early email.
- **Renaming the cost brake.** It touches a dozen ADRs, the flag key and the alert for no change in behaviour.
- **Adding `colo-hit` to the two include lists.** It fixes this outcome and leaves the next one to fall through the same way.

## Consequences

- **Amends ADR 0003:** a second dataset, `request_events`, and one more additive count per bucket.
- **Amends ADR 0004:** the brake's bound is a count with a stated overshoot, and "$13 a month" is withdrawn; the cost section says a month under attack has no cap.
- **Amends ADR 0006:** `colo-hit` is eligible for both Objectives.
- **Amends ADR 0007:** `infra/env` takes `spend_alert_dollars_per_day`; the `redirect` and `status` Workers bind the `request_events` dataset.
- **Amends ADR 0011:** eligibility is an exclude list; the flood alert is "Request flood"; the Status Worker also sends "Request spend".
- **Amends ADR 0013:** the renewal is budgeted against an ordinary month.
- **Amends ADR 0020:** `request_events` follows its counting rules.
- **Amends ADR 0022:** the alert's name and what it counts; the brake's bound; the latency Objective's eligible set.
- **The glossary** replaces Redirect flood with Request flood.
- **The latency Objective is easier to meet and harder to move.** With `colo-hit` counted, slow shard fallbacks are a smaller share of eligible Redirects, and the error budgets are about ten times larger in absolute terms at ADR 0006's assumed hit ratio.
- **A popular deployment fires "Request spend" on honest traffic.** That is intended: past $1 a day it is outside the budget rule, and the Operator raises the input.
- **A flood is still only noticed, never stopped.** The levers are ADR 0004's, pulled by the Operator.
