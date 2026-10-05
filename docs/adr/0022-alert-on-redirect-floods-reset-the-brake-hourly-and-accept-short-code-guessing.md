---
status: accepted
---

> Amended by [ADR 0030](./0030-budget-an-ordinary-month-alert-on-request-floods-and-request-spend-and-make-every-outcome-eligible-unless-excluded.md): the alert is renamed "Request flood" and also counts requests to `api.` and `status.`; a "Request spend" alert catches spend below the threshold. The brake's bound is a count with about 6 minutes of overshoot in every hour, and "$13 a month at most" is withdrawn. `colo-hit` is eligible for both Objectives.

# Alert on Redirect floods, reset the cost brake hourly, limit IPv6 misses by /48, and accept Short code guessing

[ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md) limits what an attack can cost in Durable Object calls. It does not cap Worker requests and KV reads, which cost $0.80 per 1M and are the larger bill: 1,000 req/s sustained is about $69 a day. The only signal for that is a spend email the next day, and OpenTofu can't even create it. Three more of its claims don't hold. The shard-fallback limit doesn't bound guessing, because a guess that hits a real Link gets its 302 whatever the limiter says. One IPv6 /48 holds 65,536 limiter keys, enough to trip the brake in under two minutes. And once tripped, the brake stays on until midnight UTC, so about $2.85 of traffic buys a day of 503s for new Links.

So the Status Worker emails the Operator when Redirect volume stays above a threshold. The brake's window shrinks from a day to an hour. IPv6 misses are limited by /48 as well as by /64. Guessing at the edge ceiling's rate is accepted and stated honestly: a Short code is not a secret. Unknown Short codes stop counting toward the latency Objective.

Decided in [How are request floods, Short code guessing and a deliberately tripped brake bounded?](https://github.com/andrewferk/url-shortener/issues/53), from the research in [What does a Redirect flood cost and count against: KV read billing, `cacheTtl`, IPv6 rate limiting, blocked requests?](https://github.com/andrewferk/url-shortener/issues/43).

## Decision

### The Request flood alert

- **The Status Worker sends a "Request flood" alert** (named "Redirect flood" until [ADR 0030](./0030-budget-an-ordinary-month-alert-on-request-floods-and-request-spend-and-make-every-outcome-eligible-unless-excluded.md)) from its 5-minute rollup, in prod, beside [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)'s alerts and through the same email path and D1 alert state.
- **It counts every Redirect event,** of every source and outcome, including `malformed` and `rate-limited`. Each one is a billed Worker request, so the count is the cost signal. Since ADR 0030 it also counts requests to `api.` and `status.`, from a second dataset of request events. Counts follow [ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md): `sum(sample_interval * _sample_interval)`.
- **It fires** when two consecutive 5-minute buckets each exceed the threshold, and resolves when two consecutive buckets fall below it. One email each way.

  | Variable | Default |
  |---|---|
  | `flood_alert_requests_per_second` | 100 |

  At the default that is 30,000 requests a bucket, a pace of about 8.6M requests and $7 a day.
- **The email states** the observed rate and what a day at that rate costs at this ADR's list prices ($0.80 per 1M). It names the runbook's levers and carries no links.
- **It is an alert only.** Nothing is blocked or shed automatically. The Operator chooses a lever from ADR 0004's list.
- **Requests blocked at the edge stay invisible** to it. They are also free.
- **The spend alert leaves OpenTofu.** No API or provider resource exists for a budget alert. Cloudflare's automatic $10 alert is the backstop, and the operator docs make setting a lower one a manual step.

### Guessing is accepted

- **ADR 0004's claim is corrected.** The shard-fallback limit is checked only after a KV miss, so it bounds shard cost, not guessing. The guess rate is the edge ceiling: about 2.6M a day per IP per data center.

  | Deployment size | What one IP finds |
  |---|---|
  | about 10k Links | one live Link per 350M random guesses, so about one every 135 days |
  | 1B Links | about 740 live Links a day |
  | Custom aliases | a 1M-word dictionary takes about 9 hours |

- **A Short code is not a secret.** "Not enumerable" in [ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md) means not sequential: knowing one Short code tells you nothing about the next. It never meant unguessable at scale. The API docs tell Creators that a Target URL must not rely on its Short code staying unknown.
- **No 429 before the KV read.** A real Visitor behind a busy NAT keeps getting Redirects while someone on the same IP guesses, as the PRD's user story 4 requires.
- **The Operator pays for the attacker's guesses,** $0.80 per 1M. The flood alert is what notices.

### The edge ceiling and IPv6

- **The edge ceiling stays at 300 requests per 10 s per IP.**
- **IPv6 misses pass two limiters.** On a KV miss from an IPv6 address the Worker checks both, and either one answers the 429:

  | Key | Limit |
  |---|---|
  | the /64 prefix (as before) | 30 per 60 s |
  | the /48 prefix | 120 per 60 s |

  One /48 now gets 120 misses a minute per location, not about 2M. IPv4 is unchanged.
- **A `doctor` check** reports how the edge rule counts IPv6 (per address or per /64). Cloudflare doesn't document it, and nothing here depends on the answer.

### The cost brake resets hourly

- **The threshold is 125,000 shard lookups per UTC hour,** not 3M per UTC day. The count it aims at is the same 3M a day. That is not a bound on the bill (ADR 0030).
- **The flag is `brake:<utc-hour>`** in `FLAGS`, and it stops applying at the top of the hour. The Cron Trigger sums the current UTC hour.
- **The brake still counts only lookups that reached a shard** (`shard-fallback`, `not-found`). Worker requests and KV reads belong to the flood alert, which has no automatic action because no action on Free can stop them.
- **No sampling margin and no earlier trip.** The count is correct in expectation (ADR 0020). A trip can be late by one Cron interval and the flag cache, about 6 minutes, and 1M extra shard lookups cost about $0.15. Under the hourly window that lateness recurs every hour: at 1,000 misses a second it is about 260M extra lookups and $39 a month (ADR 0030).
- **The flag is cached in the isolate's memory for 60 s.** The KV-miss path never pays a second KV read for it, which could otherwise raise a miss from $0.80 to $1.30 per 1M.
- **Force shedding** is unchanged: the Worker variable from [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md) is ORed with the flag.
- **The "cost brake engaged" alert** still sends once per UTC day, on the first `shed` event.
- **What an attacker can still do:** about 70 IPv4 addresses, or about 18 IPv6 /48s, in one location hold the brake on for as long as they keep sending. That is accepted. The damage is that a Link under about 60 s old answers 503 until KV has it, and the emergency block is the answer to a sustained attack.

### The Status page

- **The `shed` slice stays public.** An attacker already sees the brake in the responses: an unknown Short code answers 503 where it answered 404. Hiding the slice would hide the brake only from Visitors and Creators, who are owed the explanation. [ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md) keeps the audit digest private because it reveals what an attacker can't otherwise see; this doesn't.
- **`not-found` leaves the latency Objective.** Its eligible outcomes are now `colo-hit`, `kv-hit`, `shard-fallback`, `gone` and `error` (`colo-hit` was missing from this list until ADR 0030). A 404 for a Short code nobody created is not a Redirect we owe 200 ms on, and it is the one slow outcome anyone can produce at will.
- **`not-found` stays eligible for the error-rate Objective,** so the two Objectives have different eligible sets. Each rollup bucket stores an eligible count for each.
- **`shard-fallback` stays eligible for latency.** It happens only for a real Link under about 60 s old, so only a Creator can produce it.
- **Volume skew is accepted.** One IP can dominate the volume graph. The graph shows real volume, split by outcome.

## Cost

**Today:** $0 extra. One more rate limiter binding and one more alert condition in a rollup that already runs.

**Under attack,** at list prices, CPU excluded:

| Attack | Cost to the Operator | Bound |
|---|---|---|
| One IP at the edge ceiling | $2.07 a day per data center | the edge ceiling |
| 1,000 req/s from many IPs | $69 a day | none on Free; the flood alert emails within about 10 to 15 minutes |
| 10,000 req/s from many IPs | $691 a day | the same |
| Shard lookups | $0.15 per 1M, on top of the $0.80 | the brake, as a count: 125,000 an hour plus the overshoot (ADR 0030) |

## Considered options

- **Answering 429 before the KV read once an IP is over the miss limit.** It cuts a flood to $0.30 per 1M and bounds guessing at 30 a minute. It also blocks every real Visitor who shares that IP, which user story 4 rules out, and a many-IP attacker loses nothing.
- **A lower edge ceiling.** It saves at most $2 a day per IP, does nothing against many IPs, and squeezes carrier-grade NAT.
- **Keying the limiter on the /48 alone.** A mobile carrier can put many subscribers' /64s in one /48. Two limits keep the per-/64 behaviour and add a ceiling above it.
- **Having the flood alert set the brake or a block.** The brake doesn't reduce Worker requests or KV reads, and an automatic block needs a rule that tells an attack from a popular Link. The Operator decides.
- **Counting 429s and all requests in the brake.** The brake's only action is to stop shard calls, so it would shed new Links without saving the cost it counted.
- **Keeping the daily window.** A single burst costs the rest of the UTC day.
- **A sliding window or an early-reset rule for the brake.** More state for the same bound. A sustained attacker holds any window shut.
- **A safety margin on the brake's count.** The overshoot is a small share of the flood's own bill (ADR 0030), and a margin would only trip the brake earlier on honest traffic.
- **Removing the `shed` slice from the Status page.** It hides nothing the responses don't show.
- **Dropping `not-found` from both Objectives.** A crash on an unknown Short code is still an `error`, and a flood of fast 404s can't spend the error budget.
- **Weighting eligibility per IP.** Redirect events carry no IP, and adding one would put personal data in Analytics Engine.

## Consequences

- **Amends ADR 0004:** the guessing claim; the second IPv6 limiter; the brake's hourly window, flag key and in-memory cache; the spend alert as a manual step; the flood figures in its cost section.
- **Amends ADR 0011:** the "Redirect flood" alert; the latency Objective's eligible set; two eligible counts per bucket.
- **Amends ADR 0017:** `shard-fallback` stays eligible for latency; `not-found` does not.
- **ADR 0003 is unchanged.** Every outcome keeps its slice of volume.
- **A flood is noticed in about 10 to 15 minutes, not the next day,** but still only by email, and only while the Status Worker runs. Grafana's "Status page stale" rule covers a Status Worker that has stopped.
- **A popular Link can fire the flood alert.** That is intended: the Operator's bill grows either way, and the threshold is an input.
- **The latency Objective no longer measures unknown Short codes,** so a slow shard shows there only through new Links. The percentile graphs still include every outcome.
- **Still undocumented, and now `doctor` checks or spikes:** how the edge rule counts IPv6, and whether a KV read served from the `cacheTtl` cache is billed.
