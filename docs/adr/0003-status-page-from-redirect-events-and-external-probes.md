---
status: accepted
---

> Amended by [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md): the SLO targets are decided (three rolling 30-day Objectives). Redirect events gain an `error` outcome, recorded by a catch-all handler. Every rollup bucket also stores additive counts for Error budgets. A second Synthetic Monitoring check alerts when the snapshot goes stale.
>
> Amended by [ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md): a Redirect event's index is `<Namespace ID>:<Short code>`, and it gains a `namespace` blob. The Status page stays deployment-wide.
>
> Amended by [ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md): the index is `<Namespace ID>:<source>:<outcome>` and the Short code becomes a blob; `sample_interval = N` (an integer) replaces `weight`; every count is `sum(sample_interval * _sample_interval)` and percentiles weight by `_sample_interval`; each bucket stores `rows_read` and `max_sample_interval`, judges "insufficient data" on rows and shows "estimated" when sampled; the rollup heals missing buckets itself, bounded per run.

# Feed the Status page from self-timed Redirect events and external Probes, served by a separate Status Worker

On the Free zone plan ([ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)), Cloudflare gives us no edge latency percentiles, no per-request edge log, and no health checks. So the Worker measures each Redirect itself and writes a Redirect event to Workers Analytics Engine. Uptime comes from Probes run by an external service. A separate Status Worker rolls both sources up into D1 every 5 minutes and serves precomputed snapshots. Because the page depends on the Worker seeing every Redirect, **every Redirect runs the Worker**: Redirects are never served from Workers Cache. The saving would be small anyway, since cache hits are still billed as Workers requests.

Decided in [How does the Status page get its metrics and where is it served?](https://github.com/andrewferk/url-shortener/issues/7), from the research in [How can each provider feed the Status page from CDN/edge data?](https://github.com/andrewferk/url-shortener/issues/3).

## Decision

- **Redirect latency** means server-side Redirect latency, and the page labels it that way. It is measured inside Cloudflare, from the Worker receiving the request until the response is ready, and excludes the Visitor's network. Worker timers only advance on I/O, so in practice it measures KV and shard time, which is what dominates a Redirect.
  - **Redirect events:** the domain core's Redirect decision emits one through a new port, `RedirectRecorder`. The Analytics Engine writer is an adapter behind it.
  - **Data point fields:**
    - index: the Short code
    - blobs: `outcome` (`kv-hit` / `shard-fallback` / `not-found` / `gone`), `source` (`visitor` / `probe`), `colo`
    - doubles: `duration_ms`, `weight`, `status`
  - **Percentiles:** p50/p90/p99 come from `quantileExactWeighted`, weighted by `weight`.
- **Volume** counts Visitor Redirects, broken down by outcome, and leaves out Probes. **Error rate** (the 5xx share of Visitor Redirects) is a separate series. It doesn't count toward uptime.
- **Uptime** comes from Probes run by Grafana Cloud Synthetic Monitoring.
  - Two locations follow the Canary link every minute. A minute counts as down when every location fails.
  - Probe Redirects run the real Redirect path, so their Redirect events count toward the latency percentiles. They're tagged `source=probe`, so they can be filtered out later.
  - **Probe round-trip latency** is measured from outside, including network, and is shown as its own series. It is never blended with server-side latency.
- **Canary link:** a Link with the Custom alias `canary` and no Expiry. An idempotent post-deploy step creates it through the normal Link creation API, as an operations Creator, in prod and in every preview environment. The Worker recognizes it only to tag its Redirect events as `probe`.
- **Hosting:** a separate Status Worker on the `status.` subdomain.
  - It serves a pre-rendered JSON snapshot per view from D1, cached through the Cache API for 60 seconds.
  - It never queries metrics on a page view.
  - It depends on neither KV nor the Durable Object shards, so it stays up through Redirect Worker bugs, bad deploys, and trouble on the Redirect path. A Cloudflare-wide outage takes it down too. The external Probes still record that outage, so it appears on the page afterwards.
- **Rollups:** a Cron Trigger on the Status Worker runs every 5 minutes.
  - Each run queries the Analytics Engine SQL API and the Grafana Cloud API, using tokens stored as Worker secrets.
  - It recomputes and upserts the last 3 buckets at every resolution, so late data and missed runs heal themselves.
  - Hourly and daily percentiles are computed from raw events, never merged from smaller buckets.
- **Windows and retention:**

  | View | Bucket |
  |---|---|
  | Last 24 hours | 5-minute |
  | Last 7 days | hourly |
  | Last 90 days | daily |

  There is also a 90-day daily uptime bar. 5-minute buckets are kept for 7 days, hourly buckets for 90 days, and daily buckets indefinitely.
- **Thin data:** a bucket with fewer than about 50 Redirect events shows "insufficient data" instead of percentiles. At today's traffic, the hourly view is the meaningful one.
- **Freshness:** the page shows "updated N minutes ago", and a stale banner when the snapshot is more than 15 minutes old. When the latest minutes are all down, it shows a "Redirects are failing" banner. There are no manual incident posts.
- **Sampling:** `redirect_event_sample_rate` is an IaC parameter, defaulting to 1.0. Each data point carries `weight = 1/rate`.

## Cost

**Today:** $0 extra.
- Analytics Engine writes, D1 and Cron Triggers all fit Workers Paid's included amounts.
- Two locations every minute is about 86k Probes a month, inside Grafana's free 100k executions.

**Peak:** one Analytics Engine write per Redirect at 30B/mo is about $7.5k/mo at list price, if Cloudflare starts billing for Analytics Engine as the pricing page warns. `redirect_event_sample_rate` is the lever.

## Considered options

- **Workers wall-time quantiles from the GraphQL API:** they mix Redirects with other traffic the Worker handles, can't be split by outcome, and the p90 field is unverified.
- **Serving Redirects from Workers Cache:** hits skip the Worker, so they'd be invisible to the page and to future click analytics. The saving is small, because hits are still billed as requests.
- **A Pro zone:** it adds edge time-to-first-byte percentiles that include cache hits, and Health Checks. But it offers p95 rather than the required p90, and its Health Checks probe from inside the platform they're checking. It would also push cost to $25–30/mo, over budget. Whether Pro is worth it for abuse protection belongs to [How are Redirects and Link creation protected from abuse?](https://github.com/andrewferk/url-shortener/issues/8).
- **Cron Trigger self-probes:** free, but they run on the platform they're checking, from locations we can't choose.
- **Snapshots in KV:** a KV incident would take down both the Redirects and the page reporting on them.
- **Status page as a route on the Redirect Worker:** a bad deploy would take down both.

## Consequences

- **Every Redirect is a Worker invocation plus a Redirect event.** Any later proposal to serve Redirects from Workers Cache has to give up the Status page's coverage and future click analytics.
- **The Redirect event is the seam for future click analytics.** That effort can add fields to it, such as country or referrer, but it needs its own long-term store, because Analytics Engine keeps only 3 months. It also has to choose a sample rate of 1.0 and pay for it.
- **Probe history lives in Grafana Cloud Free for 14 days.** If the rollup job is down longer than that, probe-based uptime for the gap is lost.
- **The page depends on a second vendor, Grafana Cloud,** for uptime. It is managed with the official `grafana/grafana` OpenTofu provider.
- **SLO targets** the page reports against are still undecided.
