---
status: accepted
---

# Index Redirect events by Namespace, source and outcome, weight every query by `_sample_interval`, and let the rollup heal its own gaps

[ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md) weights every Redirect event query by the design's own `weight` column, and [ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md) indexes each event by `<Namespace ID>:<Short code>`. Cloudflare's docs say otherwise on both: Analytics Engine samples at write time per index value and again at read time, so every count must multiply by `_sample_interval`, and reading across many index values "will result in low-resolution data, possibly unusably low". As decided, the volume series, the Error-budget counts and the cost brake all undercount once sampling starts, and the brake's query reads across one index value per guessed Short code during exactly the flood it exists to catch. Separately, the rollup recomputes only the last 3 buckets, so a Status Worker outage longer than 15 minutes, 3 hours or 3 days leaves permanent holes, including in the 30-day Objective sums.

So the Redirect event's index becomes `<Namespace ID>:<source>:<outcome>`, which is what every query filters by. The client-side sample rate stays as the cost lever, but as an integer interval, and every query uses Cloudflare's documented forms. Each bucket records how sampled it was. And the rollup heals missing buckets on its own, so there is no backfill channel, no Workflow and no Operator step.

Decided in [How do Redirect event queries stay correct under sampling, and can the rollup be backfilled?](https://github.com/andrewferk/url-shortener/issues/51), from the research in [How does Analytics Engine sample, and which index keeps totals and per-Link counts accurate?](https://github.com/andrewferk/url-shortener/issues/41).

## Decision

### The data point

- **Index:** `<Namespace ID>:<source>:<outcome>`, for example `default:visitor:kv-hit`. About a dozen values per Namespace.
  - Every rollup and brake query sets its read set with `index1 IN (...)`, never with a blob filter alone, so a query reads only the values it needs.
  - Per-Namespace figures stay exact, as ADR 0014 intended for a future SaaS. A small Namespace is never sampled toward zero beside a busy one.
- **Blobs:** `namespace`, `source`, `outcome`, `colo` and, new, `short_code`. The first three repeat the index so filters read naturally and a second dataset can carry the same shape. Dimensions cost nothing.
- **Doubles:** `duration_ms`, `sample_interval`, `status`.
- **`sample_interval` replaces `weight`.** `redirect_event_sample_rate` is constrained to `1/N` for an integer N (1, 2, 5, 10, ...), and the event stores N. Every weight in every query is therefore an integer.

### The queries

Each stored row stands for `_sample_interval` written rows, each of which stands for `sample_interval` Redirects.

| Figure | Form |
|---|---|
| Any count: volume, each outcome slice, the brake's count, and the Error-budget counts (eligible, fast, non-5xx) | `sum(sample_interval * _sample_interval)` |
| Percentiles | `quantileExactWeighted(q)(duration_ms, _sample_interval)` |
| Rows actually read | `count()` |
| Resolution | `max(_sample_interval)` |

- **Percentiles weight by `_sample_interval` alone.** A weighted quantile is unchanged when every weight is multiplied by the same constant, and `sample_interval` is one value for the whole deployment, so it drops out. This keeps the quantile on the exact documented form; whether `quantileExactWeighted` accepts an expression or a fractional weight is undocumented, and nothing now depends on it.
  - The one edge: a deploy that changes `redirect_event_sample_rate` leaves the buckets spanning it with rows at two intervals, and their percentiles lean toward one side. The effect is transient and bounded to those buckets. Accepted.
- **Every bucket stores `rows_read` and `max_sample_interval`.**
  - ADR 0003's "insufficient data" rule (about 50 events) is judged on `rows_read`, the rows the percentile was computed from, not on the extrapolated count.
  - The page marks a bucket **estimated** when `max_sample_interval > 1`, so an extrapolation is never presented as a count.
  - `objective_min_eligible` stays on the extrapolated eligible count, because it is budget arithmetic.

### Per-Link analytics

- **Not from this dataset.** Once an index value is sampled, a low-traffic Link's events under it can be quantised or dropped, and the count of distinct Links is unreliable. Below the threshold per-Link queries on the `short_code` blob still work, which is enough for investigation.
- **The seam:** the `RedirectRecorder` port emits the full event; the adapter decides which datasets it goes to. The recorded route for a future click-analytics effort is a second Analytics Engine dataset indexed by `<Namespace ID>:<Short code>`, written as a second `writeDataPoint()` by the same adapter, which Cloudflare recommends over a compromise index. That effort may choose another store instead. It is not built now.

### The rollup heals its own gaps

- **Every run writes a row for every bucket it computes, even an empty one.** A missing row within retention is a gap.
- **Each run** recomputes the last 3 buckets per resolution as before, then heals one contiguous range of gaps per resolution, oldest first, as one query pair per range:

  | Resolution | Healed per run | Within |
  |---|---|---|
  | 5-minute | up to 1 hour | 7 days |
  | hourly | up to 24 hours | 90 days |
  | daily | up to 7 days | Analytics Engine's retention (3 months) |

  The two bounds are Status Worker variables, not deployment inputs. A 3-day outage closes its hourly holes in 3 runs, its daily hole in 1, and its 5-minute holes over about 6 hours.
- **The floor:** a `rollup_meta` row records `first_bucket_at` per resolution, written once by the first successful run and never moved. The heal floor is the later of that and the retention edge. A recreated D1 database writes the marker again on its first run, so it starts clean rather than trying to heal 90 days.
- **Probe-minutes past Grafana's 14 days are unobserved.** A healed bucket beyond that holds Redirect counts and no Probe-minutes. Unobserved minutes leave the uptime Objective's denominator: attainment is good minutes over observed minutes, and the Objectives row shows "N minutes unobserved" when any are missing from the window. The 90-day uptime bar already shows them as "no data".

### Checks

- **A spike in the Redirect events slice, before the rollup queries are final:** write at a known rate, run the exact rollup and brake query shapes, and compare `count()`, `sum(_sample_interval)` and the true count, reporting the largest `_sample_interval` seen. Cloudflare documents no threshold for either sampling stage; its one observation is about 100 data points per second per index value.
- **A `doctor` check** reads `max_sample_interval` from recent buckets and warns when it exceeds 1 at today's traffic, which would mean the index isn't doing its job.

## Cost

$0 extra. Healing adds a few Analytics Engine read queries per run, inside the 1M a month included on Workers Paid. Two integer columns per bucket and one `rollup_meta` row are negligible in D1.

## Considered options

- **Keeping `<Namespace ID>:<Short code>` as the index.** Per-Link counts stay exact, but every Status page and brake query reads across every Link, and a flood of guessed codes writes one new index value per guess. Cloudflare also says a near-unique index "will slow down most queries for aggregations and time series".
- **`<source>:<outcome>` alone.** Coarsest, but a small Namespace's figures could be sampled toward zero beside a busy one, which is the case Cloudflare's billing recipe warns about.
- **Keeping the fractional `weight`** and spiking whether `quantileExactWeighted` takes `weight * _sample_interval`. A spike on an undocumented behaviour, for a form that an integer interval makes unnecessary.
- **Dropping client-side sampling** and relying on Cloudflare's. Simplest, but writes are billed per `writeDataPoint()` call, not per stored row, so it gives up the only lever on the peak write bill.
- **No backfill.** Holes in the 30-day Objective sums after any outage over 3 hours, with Probe data lost for good after 14 days.
- **An Operator-started backfill from the CLI.** The CLI has no way to reach the Status Worker: no endpoint, and the `operator` token is scoped to `links-data`. It would need an authenticated route on `status.` or a request row in D1, and an Operator who is awake.
- **A backfill Workflow.** Resumable and paged, but it brings the Durable Objects dependency ADR 0003 kept the Status Worker free of, billed steps, and an undocumented question about the `production` token deploying Workflow definitions.
- **Counting unobserved Probe-minutes as down or as up.** Down punishes an outage of the reporting, not of the service; up flatters the figure.

## Consequences

- **Amends ADR 0003:** the index, the blobs and doubles, the weighting of every figure, the thin-data rule on `rows_read`, the "estimated" mark, and the healing rule. "Every data point carries `weight = 1/rate`" becomes "every data point carries `sample_interval = N`".
- **Amends ADR 0004:** the brake sums `sample_interval * _sample_interval` over the `shard-fallback` and `not-found` index values. Whether the brake needs a margin for sampling under a flood belongs to [How are request floods, Short code guessing and a deliberately tripped brake bounded?](https://github.com/andrewferk/url-shortener/issues/53).
- **Amends ADR 0011:** "additive weighted counts" are `sum(sample_interval * _sample_interval)`; unobserved Probe-minutes leave the uptime denominator; `objective_min_eligible` is unchanged.
- **Amends ADR 0014:** the index no longer carries the Short code. The `namespace` blob stays.
- **Per-Link analytics is given up from this dataset** and gets its own, through the same port.
- **A SaaS with thousands of Namespaces** makes the deployment-wide queries read thousands of index values again. The escape is the same double-write: a second dataset indexed `<source>:<outcome>` for the deployment-wide figures. Not needed for a self-hosted deployment.
- **A Status Worker outage is no longer permanent damage** within retention. Beyond 14 days, uptime for the gap is unobserved rather than lost; beyond 3 months, Redirect figures for the gap are lost.
