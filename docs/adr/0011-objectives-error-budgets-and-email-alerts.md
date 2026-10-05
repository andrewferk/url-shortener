---
status: accepted
---

> Amended by [ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md): after each rollup, the Status Worker in prod also polls Audit Logs v2 and emails a digest of destructive changes. It sends an "audit watch blind" alert when every poll for an hour has failed. The blind alert uses this ADR's alert state in D1.
>
> Amended by [ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md): `shard-fallback` stays eligible for the latency Objective, which now depends on where the Operator placed the shards. `not-found` stayed eligible too, until ADR 0022 (below) took it out.
>
> Amended by [ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md): the additive counts are `sum(sample_interval * _sample_interval)`; Probe-minutes the rollup can no longer observe (healed buckets past Grafana's 14 days) leave the uptime denominator and are shown as unobserved.
>
> Amended by [ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md): the Grafana alerts are rules we own on `probe_success`: "Redirects down" (no location succeeded over three Probe frequencies, at least two reporting), "Status page stale" (neither of two locations succeeded for 20 minutes) and a new "Probes blind". The per-check `ProbeFailedExecutionsTooHigh` alert is dropped. A fire drill proves the rule before launch. Executions are about 75.9k of 100k.
>
> Amended by [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md): the Status Worker also sends a "Redirect flood" alert when Redirect volume of every outcome exceeds `flood_alert_requests_per_second` (default 100) for two consecutive buckets. `not-found` leaves the latency Objective's eligible set and stays in the error-rate one, so each bucket stores an eligible count per Objective.
>
> Amended by [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md): the Status Worker also sends "Creator at daily cap", once per Creator per UTC day, and "Creator over ceiling: suspended".
>
> Amended by [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md): the Status Worker sends four more emails: off-account copy stale, Short domain expiring, registrar lock removed, and domain check blind.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): Cloudflare does record Worker errors below Enterprise (Workers Logs and Issues), with no email destination, so this ADR's alerts stay. `send_email` uses the current Email Service API. The alert address is an alias.

> Amended by [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md): `links-data` emails the Operator its integrity findings itself, through its own `send_email` binding. A fourth Grafana rule we own, "Integrity checks stale or failing", joins ADR 0021's three, fed by a heartbeat `links-data` pushes after each hourly run.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): two rules that lived only in the PRD are stated here: an alert sends its email before it writes alert state, and no email a Worker sends the Operator carries a link. The executions table, the Grafana alert rules, the execution headroom and the latency Objective's eligible outcomes follow ADRs 0021 and 0022.

> Amended by [ADR 0029](./0029-list-rulesets-and-routes-hourly-move-the-off-account-heartbeat-to-grafana-and-take-email-routing-off-the-production-token.md): Email Routing and the Operator's destination address move from `infra/zone` to a hand-applied configuration, and the `production` token holds no Email Routing permission. "Off-account copy stale" is a fifth Grafana rule we own, not a Status Worker email.

# Report three rolling 30-day Objectives from additive rollup counts, and alert the Operator by email from both Grafana and the Status Worker

[ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md) defined what the Status page measures but left open what it reports against. The service now has three **Objectives**, each over a rolling 30 days: uptime from Probe-minutes, and Redirect latency and error rate from Redirect events. The two request-based Objectives are ratios, not percentiles, so each has an **Error budget** that can be counted. The rollups store additive counts, and 30-day figures are summed from D1. Alerts go to the Operator by email, with no paging. Grafana sends the ones that must work while Cloudflare is down, and the Status Worker sends the ones that need Analytics Engine data.

Decided in [What SLOs does the Status page report against?](https://github.com/andrewferk/url-shortener/issues/18).

## Decision

- **Scope:** only Redirects have Objectives, and only in prod. The Link API and the Status page itself have none. A preview's page shows the section as "not measured in this environment". The section and every alert below follow `probes_enabled` ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)).
- **The Objectives,** each over a rolling 30 days:

  | Objective | Good events | Target | Error budget per 30 days |
  |---|---|---|---|
  | Uptime | Probe-minutes that aren't down (ADR 0003: a minute is down when every location fails) | 99.9% | 43.2 minutes |
  | Redirect latency | eligible Redirects with `duration_ms` ≤ 200 | 99% | 1% of eligible Redirects |
  | Error rate | eligible Redirects that don't answer 5xx | 99.9% | 0.1% of eligible Redirects |

- **Eligible Redirects** are Visitor Redirects (`source=visitor`) that performed a lookup: outcomes `kv-hit`, `shard-fallback`, `not-found`, `gone` and `error`. For the latency Objective alone, `not-found` is not eligible ([ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md)). These are left out of both the numerator and the denominator:
  - Probes, which are uptime's job. They stay in ADR 0003's percentile charts.
  - `malformed` and `rate-limited` ([ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)), which answer instantly and would pad the good count during a flood.
  - `shed`, the cost brake's 503. It is deliberate load-shedding, mostly aimed at guessers, and it gets its own alert. If it counted, anyone flooding unknown Short codes could spend the error budget.
- **Latency is server-side.** Probe round-trip latency includes Grafana's own network and a fresh DNS, TCP and TLS handshake on every run, so it stays a separate series with no Objective. On the server side a KV hit takes single-digit milliseconds, so in practice the latency budget is spent by shard fallbacks and cold KV reads.
- **A new `error` outcome.** The Redirect Worker's top-level handler catches anything thrown and records a Redirect event with outcome `error`. It then answers 500 with `no-store`. Without this handler, an uncaught exception shows the Visitor Cloudflare's 1101 page and writes no event, so crashes would be invisible to the error rate.
- **Computing the figures:**
  - Every rollup bucket at every resolution also stores additive weighted counts: eligible, fast (≤ threshold) and non-5xx Redirects, plus Probe-minutes and down Probe-minutes.
  - The 30-day figures are sums over the hourly buckets, topped up with the current hour's 5-minute buckets. They never re-query 30 days of Analytics Engine data.
  - Uptime has to come from D1 anyway, because Grafana keeps Probe history for only 14 days.
  - Percentiles are still computed from raw events, as ADR 0003 requires.
- **Parameters:** these are IaC variables, rendered into the Status Worker's config as ADR 0007 describes.

  | Variable | Default |
  |---|---|
  | `objective_uptime_target` | 0.999 |
  | `objective_latency_threshold_ms` | 200 |
  | `objective_latency_target` | 0.99 |
  | `objective_error_target` | 0.999 |
  | `objective_min_eligible` | 1000 |
  | `fast_burn_rate` | 14.4 |
  | `fast_burn_min_bad` | 10 |

- **On the page:** an **Objectives** section at the top, with one row per Objective. Each row shows:
  - the target;
  - 30-day attainment;
  - the Error budget remaining, as a percentage and in natural units (minutes for uptime, Redirects for the other two);
  - a state: *healthy* above 25% remaining, *low* from 25% down to 0, *exhausted* at 0 or below.

  A request-based Objective with fewer than `objective_min_eligible` eligible Redirects in the window shows "insufficient data". Below 1,000, a single failed Redirect spends the whole 0.1% budget. The page calls them Objectives, not an SLA: they are targets the service reports against, not a contract.
- **Alerts** go only to the Operator, by email, and never page anyone. The alert address is an alias, not a personal mailbox, because it is committed in a public ops repo ([ADR 0015](./0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md)).
  - **From Grafana,** which keeps working through a Cloudflare-wide outage:
    - **Redirects down:** a rule we own on `probe_success` ([ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md)). It fires when, over three Probe frequencies (6 minutes at the default), no location's Canary link check succeeded and at least two locations reported. It replaces the per-check `ProbeFailedExecutionsTooHigh` alert first decided here.
    - **Status page stale:** a second Synthetic Monitoring HTTP check fetches the prod Status page snapshot and asserts it isn't stale (ADR 0003's 15-minute rule). It runs every 10 minutes from two locations, and the rule fires when neither succeeded over 20 minutes and at least one reported. This covers the Status Worker's own alerts falling silent.
    - **Probes blind:** fewer than two locations reported on the Canary link check in 10 minutes, or none reported on the Status page check in 30 minutes.
    - All three use one email contact point for the Operator, and the notification policy routes on a label the rules carry.
  - **From the Status Worker,** evaluated at the end of each 5-minute rollup:
    - **Fast burn,** for each request-based Objective. It fires when the 1-hour burn rate is ≥ `fast_burn_rate` **and** the 5-minute burn rate is ≥ `fast_burn_rate` **and** at least `fast_burn_min_bad` bad Redirects happened in that hour. The floor stops a single failure at low traffic from firing it. At 14.4×, an hour at that rate spends 2% of the 30-day budget.
    - **Budget exhausted,** for any of the three Objectives, when its remaining Error budget reaches 0.
    - **Cost brake engaged:** on the first `shed` event of each UTC day. Until now this was visible only as a slice of volume and in a spend alert that arrives the next day.
    - There is no slow-burn alert. The page shows slow burn.
    - It sends through the `send_email` binding, now part of Cloudflare Email Service, with the structured `send({ to, from, subject, text })` call. The raw-message `EmailMessage` API is labelled legacy and isn't used. The binding's `destination_address` restricts it to the Operator's verified address, and sending to a verified address is free on every plan.
    - Alert state lives in D1. Each condition sends one email when it starts firing and one when it resolves. The cost-brake alert sends once per UTC day.
    - **An alert sends its email first and writes its alert state second,** so a failed run can duplicate an alert and never loses one.
    - **No email a Worker sends the Operator carries a link.** The alert address is an alias committed in a public ops repo, so an alert with a link is a phishing template ([ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md)). An email names its runbook or dashboard page in words. Where it must name a Short URL or an object key, as ADR 0026's findings do, that is an identifier to look up, not a link to follow.
- **Where it lives** ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)):
  - `infra/bootstrap`, applied by hand: Email Routing on the zone and the Operator's verified destination address ([ADR 0029](./0029-list-rulesets-and-routes-hourly-move-the-off-account-heartbeat-to-grafana-and-take-email-routing-off-the-production-token.md); `infra/zone` as first decided).
  - `infra/env`, when `probes_enabled`: the Grafana contact point, the notification policy, `grafana_synthetic_monitoring_check_alerts` on the Canary link check, and the Status page check.
  - Wrangler: the Status Worker's `send_email` binding.

## Cost

$0 extra.
- Grafana Cloud Free includes alerting, up to 500 rules, with email as a contact point.
- Email Routing is free.
- Synthetic Monitoring executions in a 31-day month, against Free's 100k:

  | Check | Executions |
  |---|---|
  | Probes, 3 locations every 2 minutes | 66,960 |
  | Status page check, 2 locations every 10 minutes | 8,928 |
  | **Total** | **about 75.9k** |

  These are [ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md)'s figures. As first decided, two locations every minute came to about 93.7k.

## Considered options

- **Percentile Objectives per window ("p99 ≤ 200 ms"):** the same test within one window, but percentiles don't add up across windows, so there's no Error budget to count.
- **A latency Objective on Probe round-trip:** it measures Grafana's network and a fresh handshake from two fixed locations, not what Visitors experience, and none of it is ours to fix.
- **Counting `shed` as errors:** an attacker flooding unknown Short codes would spend our budget. ADR 0004 already shows `shed` as its own slice.
- **A calendar-month window:** it resets on the 1st, so early in the month it means nothing.
- **99.5% or 99.95% uptime:** 99.5% (3 h 36 min) would survive most Cloudflare incidents but undersells "high availability". 99.95% (about 22 min) is below what one provider can deliver. A Cloudflare-wide incident spending a 99.9% budget is an honest picture of ADR 0001's single-provider ceiling.
- **Querying 30 days of Analytics Engine data on every rollup:** heavier queries for the same answer. Uptime would still need D1, because Grafana keeps only 14 days.
- **Grafana SLO:** it needs Prometheus-compatible series. Getting Analytics Engine data into Grafana means the community Altinity ClickHouse plugin, which may not install on Free.
- **Cloudflare Notifications:** there's no Worker error-rate or exception alert below Enterprise. That still holds for Notifications, but Cloudflare does record Worker errors on every plan. Workers Logs records uncaught exceptions when the Worker's `observability` setting is on. Issues, in open beta and enabled per Worker in its config, records uncaught exceptions, failed invocations, `5xx` responses and logged errors. Issues' automations go to webhooks, chat and incident tools, with no email destination, so this ADR's own alerts stay. Both are for investigation after an alert.
- **Telegram or Pushover instead of email:** both are native in Grafana, and a webhook call from the Worker. Telegram is free and Pushover is $5 one-time. They're the upgrade path if email proves too easy to ignore.
- **Paging:** there is one Operator and no on-call rotation.

## Consequences

- **A Cloudflare-wide incident spends the uptime budget.** The Objectives are reported, not promised. Such a breach shows on the page and needs no change.
- **The Status Worker's alerts go down with Cloudflare.** Grafana's Redirects-down alert covers the outage itself, and the stale-page check covers the Status Worker failing on its own.
- **Grafana's execution headroom is about 24k a month** ([ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md); it was about 6k as first decided). Probing every minute from three locations needs a paid plan.
- **Email Routing takes the zone's MX records,** so the short domain can receive mail only through Email Routing.
- **The `production` token holds no Email Routing permission.** As first decided it gained the zone's rules and the account's destination addresses for `infra/zone`. ADR 0029 moved Email Routing to a hand-applied configuration and took them away.
- **At today's traffic, the request-based Objectives show "insufficient data"** until the window holds 1,000 eligible Redirects. Uptime is meaningful from day one.
- **Budget math is additive.** A future Objective must be a ratio of countable events, or it needs its own rollup column.
