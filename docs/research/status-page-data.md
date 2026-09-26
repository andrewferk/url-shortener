# Research: feeding the Status page from CDN/edge data, per provider

Ticket: [#3](https://github.com/andrewferk/url-shortener/issues/3), a child of [#1](https://github.com/andrewferk/url-shortener/issues/1). Researched 2026-09-26 against official docs and pricing pages. Prices are list prices in USD (US regions).

**Scope.** This file is facts and trade-offs only. The design is decided in "How does the Status page get its metrics and where is it served?".

**What the Status page needs:**
- uptime/downtime
- Redirect latency p50/p90/p99 over time
- request volume over time

Per-Link click analytics is out of scope for now, but must stay possible later.

Items marked **UNVERIFIED** could not be confirmed in a primary source and should be tested before anything depends on them.

---

## TL;DR

| | Cloudflare | AWS (CloudFront) | GCP (ALB + Cloud CDN) | Composable (Fly.io + CDN + 3rd party) |
|---|---|---|---|---|
| **Built-in request volume, cache hits included** | Yes. Zone analytics, and Workers metrics via GraphQL | Yes. `Requests` metric (free) | Yes. `https/request_count` (free; sampled, rate not adjustable) | Only from the CDN's stats. Fly sees only cache misses |
| **Built-in latency percentiles, cache hits included** | Edge TTFB P50/P95/P99 only on **Pro+** (no P90). On Free: Worker CPU/wall-time quantiles (Worker invocations only) | **No.** The only percentile metric is `OriginLatency`, which counts misses only | **Yes.** `https/total_latencies` is a distribution with a `cache_result` label (free) | Fly: `fly_edge_http_response_time_seconds` histogram (misses only if a CDN is in front). Bunny/Fastly: no edge-latency percentiles |
| **Per-request edge log** | HTTP requests Logpush is **Enterprise only**. A Worker can emit its own events (Analytics Engine, Workers Logs), but only when it runs | Standard logs v2 (S3 free delivery; CloudWatch Logs gets 750 B/request free) or real-time logs (Kinesis) | LB request logs in Cloud Logging, including cache hits, sampleRate configurable | Bunny raw logs / syslog, Fastly log streaming. No per-request proxy log on Fly (**UNVERIFIED**) |
| **Synthetic uptime at ≤$20** | Health Checks need Pro+. DIY: Cron Trigger Worker | Route 53 health check (~$0.50–4.75/mo) or Synthetics canary ($0.0012/run) | Uptime checks: 1M executions/project/mo free, 1-min interval | UptimeRobot / Better Stack / Checkly / Grafana Synthetic free tiers |
| **Public dashboard product** | None. Serve your own page | CloudWatch public sharing exists but grants account-wide `GetMetricData`, so it is unsuitable | None (IAM-only sharing) | Grafana Cloud "externally shared dashboards" |
| **Same pipeline reusable for per-Link events?** | Analytics Engine can hold them, but misses Workers Cache hits and samples hot Links | Yes. Edge logs carry `cs-uri-stem` and include cache hits | Yes. LB logs carry `requestUrl` and include cache hits | Only through the CDN's log stream. Cached Redirects never reach Fly |

**Five things hold on every provider:**

1. **Cache hits are invisible to origin code.** Once a Redirect is cached at the edge, the only data about it comes from the edge provider's own metrics or logs. App-emitted events (EMF, Analytics Engine writes, app logs, Fly app metrics) see cache misses only.
2. **No provider measures latency as the Visitor experiences it end to end.** Edge metrics are measured at the edge server: from receiving the request to the first or last byte sent, excluding the Visitor's network. Only synthetic probes measure from outside, and they are coarse and not representative of real Visitors.
3. **Public pages must not query the metrics backend directly.** Every provider needs a server-side credential. Every per-query price scales with page views: AWS `GetMetricData` is $0.01/1k metrics, GCP reads are $0.50/M series, Cloudflare's GraphQL API allows 300 queries per 5 minutes. The cheap pattern is a scheduled job that writes aggregated JSON, served cached. This is an observation, not a decision.
4. **Retention is shorter than "over time" might mean:**
   - Cloudflare Analytics Engine / Workers metrics: 3 months
   - Fly Prometheus: ~15 days
   - Grafana Cloud Free: 14 days
   - GCP uptime/Cloud Run metrics: 6 weeks
   - GCP LB metrics: 24 months, downsampled after 6 weeks
   - AWS CloudWatch: 15 months with rollups

   Longer history requires storing your own rollups.
5. **Complete per-Link click capture at 100M DAU does not fit $20/mo on any provider.** The table below lists what each option costs at a peak of about 3–5B Redirects/month.

---

## Cloudflare

### Products and what they expose

**Workers Analytics Engine (AE)** ([overview](https://developers.cloudflare.com/analytics/analytics-engine/))
- **Writing:** a Worker calls `writeDataPoint({blobs, doubles, indexes})` without awaiting it ([get started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)).
- **Limits:** 20 blobs, 20 doubles and 1 index per data point; 250 data points per invocation. **Retention: 3 months** ([limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)).
- **Querying:** a SQL API with `quantileExactWeighted(q)(col, _sample_interval)`, so any percentile including p90 is possible ([aggregate functions](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/)). It can be called from a Worker using a token stored as a secret ([worker querying](https://developers.cloudflare.com/analytics/analytics-engine/worker-querying/)).
- **Sampling:** sampling is applied at write time when one index value is written too fast, and at read time for long ranges ("Adaptive Bit Rate"). It is "equitable" per index value. Counts must use `sum(_sample_interval)` ([sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)). Sampling "becomes noticeable around 100 data points per second per index value" ([FAQ](https://developers.cloudflare.com/analytics/faq/wae-faqs/)).
- **Pricing** ([pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)):
  - Free: 100k data points written/day and 10k read queries/day.
  - Paid: 10M written/mo included, then $0.25/M; 1M reads/mo included, then $1/M.
  - "Currently, you will not be billed" for AE.
- **UNVERIFIED:** SQL API rate and timeout limits.

**GraphQL Analytics API** ([limits](https://developers.cloudflare.com/analytics/graphql-api/limits/), [settings](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/), [sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/))
- **Limits:** 300 queries per 5 minutes per user. Per-plan retention and range limits are read from the `settings` node. The adaptive datasets are sampled.
- **`workersInvocationsAdaptive`:**
  - Provides `sum{requests, errors}` and `quantiles{cpuTimeP50, cpuTimeP99, …}` by datetime, script and status ([tutorial](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)).
  - Data is available for up to 3 months back. The dashboard shows wall-time, CPU-time and duration quantiles ([metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)).
  - **UNVERIFIED:** the exact names of the p90 and wall-time quantile fields. Introspect the schema.
- **`httpRequestsAdaptiveGroups` (zone traffic, cache hits included):**
  - `edgeTimeToFirstByteMs`, `originResponseDurationMs` and `edgeDnsResponseTimeMs` as avg/P50/P95/P99. There is **no P90**.
  - **Pro, Business and Enterprise only** ([Timing Insights](https://blog.cloudflare.com/introducing-timing-insights/)).
  - Free-plan retention is **UNVERIFIED**; a non-primary source says about 7 days.

**Logs**
- **Workers Logs:**
  - Free: 200k events/day, 3-day retention.
  - Paid: 20M/mo included, then $0.60/M, 7-day retention.
  - Head sampling is configurable ([Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)).
- **Query Builder:** computes P50/P90/P99 over log fields, and has a REST API ([query builder](https://developers.cloudflare.com/workers/observability/query-builder/), [API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)).
- **Logpush** is **Enterprise only**, which includes the HTTP requests dataset. The exception is Workers Trace Events Logpush, which is available on Workers Paid: 10M/mo included, then $0.05/M ([Logpush](https://developers.cloudflare.com/logs/logpush/), [Workers Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/)).
- **HTTP requests Logpush fields (Enterprise):** `EdgeTimeToFirstByteMs`, `OriginResponseDurationMs`, `ClientTCPRTTMs`, `WorkerWallTimeUs` and others ([fields](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/)).
- **Web Analytics** is a JS beacon. It cannot observe a 302 ([Web Analytics](https://developers.cloudflare.com/web-analytics/about/)).

### Latency semantics
- **Edge, Visitor-facing:** `edgeTimeToFirstByteMs` runs from the first request byte received from the Visitor until Cloudflare starts sending the response. It is measured inside Cloudflare and excludes the Visitor's network. The Visitor's RTT (`ClientTCPRTTMs`) is available only in Enterprise logs.
- **Edge to origin:** `originResponseDurationMs`. A Worker-only redirector has no origin.
- **Worker execution:** wall time (start of the invocation until no more JS needs to run) and CPU time.
- **Self-timing inside a Worker:** `Date.now()` / `performance.now()` "only advance or increment after I/O occurs" (Spectre mitigation). A Worker can time its own I/O, such as a KV or D1 read, but not its CPU work or total edge time ([performance](https://developers.cloudflare.com/workers/runtime-apis/performance/), [security model](https://developers.cloudflare.com/workers/reference/security-model/)).
- **Workers Cache** (blog dated 2026-07-06, [docs](https://developers.cloudflare.com/workers/cache/), [configuration](https://developers.cloudflare.com/workers/cache/configuration/), [blog](https://blog.cloudflare.com/workers-cache/)):
  - It sits in front of the Worker. **On a hit the Worker does not run**, so no AE write or custom log happens. Hits are still billed as Workers requests, with no CPU charge.
  - **302 is not cached by default.** An explicit `Cache-Control` overrides the defaults and makes it cacheable.
  - The Observability dashboard shows the hit ratio.
- **Classic zone cache:** "Workers runs before the Cloudflare cache" ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)).

### Synthetic uptime
- **Health Checks:** Pro 10, Business 50, Enterprise 1,000, with analytics for uptime % and RTT per region. **Not on Free** ([Health Checks](https://developers.cloudflare.com/health-checks/), [analytics](https://developers.cloudflare.com/health-checks/health-checks-analytics/)).
- **Notifications:** Health-check notifications need Pro+ ([notifications](https://developers.cloudflare.com/notifications/notification-available/)).
- **Load Balancing monitors:** a paid add-on ([monitors](https://developers.cloudflare.com/load-balancing/monitors/)).
- **DIY with Cron Triggers:** 5 per account on Free, 250 on Paid. They "run on underutilized machines," so the probe location is not controlled ([cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [limits](https://developers.cloudflare.com/workers/platform/limits/)).

### Cost to serve a public page
A Worker holding a token queries AE or GraphQL, and caches the result or rolls it up into KV or D1:

| Item | Free | Paid |
|---|---|---|
| KV ([pricing](https://developers.cloudflare.com/kv/platform/pricing/)) | 100k reads/day, 1k writes/day | 10M reads/mo included, then $0.50/M |
| D1 ([pricing](https://developers.cloudflare.com/d1/platform/pricing/)) | 5M rows read/day, 100k rows written/day | — |
| Workers ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | 100k requests/day | $5/mo, 10M requests included, then $0.30/M |

### Future per-Link events
- **Fit:** AE is built for high cardinality, and using the Short code as the index keeps rare Links unsampled.
- **Hot Links are estimates:** Links above about 100 events/s per index value are sampled, so their counts are estimates, not exact.
- **Index conflict:** there is one index per data point. A per-Link index and a global Status page aggregate may want different indexes, which could mean two writes per Redirect. This is an inference.
- **Cost at the listed Paid prices:** 3B data points/mo ≈ $748, plus Workers requests ≈ $897.
- **Coverage gap:** Workers Cache hits skip the Worker, so capture is complete only if Redirects are not cached in front of the Worker.

---

## AWS (CloudFront)

### Products and what they expose

**CloudWatch metrics** ([viewing metrics](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/viewing-cloudfront-metrics.html), [programming metrics](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/programming-cloudwatch-metrics.html))
- **Default metrics, free, 1-minute:** Requests, BytesDownloaded, 4xx/5xx/TotalErrorRate.
- **Additional metrics, per distribution:**
  - CacheHitRate, OriginLatency and per-code error rates.
  - Billed as up to 8 metrics at a fixed monthly rate, ≈ $2.40 at $0.30/metric-month (inferred).
- **Only `OriginLatency` supports `Percentile`.** It measures edge to origin, **cache misses only**.
- **Location:** everything is in us-east-1, `Region=Global`.
- **Retention:** 60-s points kept 15 days, 5-min points 63 days, 1-hour points 455 days ([concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html)).

**Standard logs** ([standard logging](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html), [fields](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html), [access logs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html))
- **Destinations:**
  - Legacy logs go to S3.
  - v2 logs go to CloudWatch Logs, Firehose or S3 (JSON/Plain/w3c/Raw, or Parquet on S3), with field selection and Hive-style partitions.
- **Fields:** `time-taken`, `time-to-first-byte`, `x-edge-result-type`, `cs-uri-stem`. v2 adds `origin-fbl`/`origin-lbl`, `c-country`, `asn` and `viewer-request-log-data`.
- **Delivery:** usually within an hour, occasionally delayed up to 24 h. Best-effort: "not … a complete accounting of all requests."
- **Pricing** ([CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)):
  - Delivery to S3 is free; you pay S3 storage at $0.023/GB-mo.
  - CloudWatch Logs: **750 bytes of log delivery per CloudFront request free**, then $0.50/GB (tiered down).
  - Firehose ≈ $0.25/GB vended plus $0.13/GB ([Firehose pricing](https://aws.amazon.com/firehose/pricing/)).
  - The CloudFront page and the price-list API disagree on the middle tier prices.

**Real-time logs** ([real-time logs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/real-time-logs.html))
- Delivered to Kinesis Data Streams within seconds, with a sampling rate of 1–100% and up to 40 fields.
- Cost: $0.01 per 1M lines, plus Kinesis. On-demand Kinesis is $0.08/GB, with each record rounded up to 1 KB ([Kinesis pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)).
- **Not allowed on CloudFront flat-rate plans** ([flat-rate](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)).
- The flat-rate plans (Pro $15/mo for 10M requests, and higher tiers) do include CloudWatch Logs ingestion for standard logs.

### Latency semantics
- **`time-taken`:** from the edge server receiving the request to writing the last byte, measured on the server. It excludes the Visitor's network: "from the perspective of the viewer, the total time … will be longer."
- **`time-to-first-byte`:** the same, to the first byte.
- **`origin-fbl`/`origin-lbl` and `OriginLatency`:** edge to origin.
- **Nothing** measures the Visitor end to end.
- **RUM** ($1/100k events) needs JavaScript on a rendered page, so it probably cannot see a bare 302 (inference).

### Getting p50/p90/p99 that include cache hits
There is no built-in path. The options are:

- **(a) Metric filter:** standard logs v2 → CloudWatch Logs (Standard class) → a metric filter on `time-taken` → a custom metric. Percentiles are then supported, since metric-filter metrics accept percentile statistics and metric filters work only on the Standard class ([metric filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html)).
- **(b) Query the logs:** Logs Insights at $0.005/GB scanned, or S3 + Athena at $5/TB ([Athena](https://aws.amazon.com/athena/pricing/)).
- **Lag:** both options inherit the up-to-an-hour log delivery delay.
- **EMF:** Embedded Metric Format from the origin Lambda sees misses only. It bills per dimension combination, and AWS warns against high-cardinality dimensions such as the Short code ([EMF](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)).

### Querying and serving
- **Prices** ([CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)):
  - `GetMetricData`: $0.01 per 1k metrics. **Never free.**
  - Custom metrics: $0.30/metric-mo.
- **Free tier:** 10 custom metrics, 5 GB logs, 3 dashboards, 100 canary runs.
- **Public dashboard sharing:** anyone with the link gets `cloudwatch:GetMetricData` on the **whole account**, and every view bills `GetMetricData` ([dashboard sharing](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-dashboard-sharing.html)).
- **Scheduled Lambda → JSON in S3 behind CloudFront:** every 5 minutes with 6 metrics ≈ $0.52/mo. Lambda and S3 costs are negligible ([Lambda pricing](https://aws.amazon.com/lambda/pricing/)).

### Synthetic uptime
- **Route 53 health checks** ([pricing](https://aws.amazon.com/route53/pricing/), [behavior](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating-values.html)):
  - AWS endpoints $0.50/mo, non-AWS $0.75/mo. Optional features (HTTPS, latency measurement, 10-s interval) cost $1–2 each.
  - "Up to 50 health checks for AWS endpoints … for free." **UNVERIFIED:** whether a CloudFront distribution counts as an AWS endpoint.
  - 2xx/3xx counts as healthy, so a 302 passes.
  - At a 30-s interval the checkers send ~1.3M requests/mo, and those show up in the `Requests` metric.
- **CloudWatch Synthetics canaries:** $0.0012/run. Every 5 min ≈ $10/mo; every 1 min ≈ $52/mo ([canaries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)).
- **Internet Monitor** (~$7.20/mo) measures ISP health, not app latency percentiles ([Internet Monitor](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-InternetMonitor.what-is-cwim.html)).

### Future per-Link events
- Edge logs, both standard v2 and real-time, include cache hits and carry the Short code in `cs-uri-stem`.
- A CloudFront Function can add up to 800 bytes via `cf.logCustomData()` ([helper methods](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/general-helper-methods.html)).
- The same v2 log feed can serve both the Status page and later click analytics. Logs are best-effort, not exact.
- Estimates at 3B Redirects/mo with ~500 B records:

| Route | ≈ Monthly cost |
|---|---|
| v2 → S3 | $0 delivery + ~$32 storage per month retained (Athena scans extra) |
| v2 → CloudWatch Logs | $0 ingestion if ≤750 B/record; storage + Insights scans extra |
| v2 → Firehose | ~$531 + S3 |
| Real-time 100%, provisioned Kinesis | ~$115 |
| Real-time 100%, on-demand Kinesis | ~$344 |
| Real-time 1% sample | ~$12 (statistical only, no per-Link counts) |

---

## GCP (global external Application Load Balancer + Cloud CDN)

### Products and what they expose

**LB / Cloud CDN request logs** ([CDN logging](https://docs.cloud.google.com/cdn/docs/logging), [LB logging & monitoring](https://docs.cloud.google.com/load-balancing/docs/https/https-logging-monitoring), [backendServices](https://docs.cloud.google.com/compute/docs/reference/rest/v1/backendServices))
- "Each Cloud CDN request is logged," **including cache hits**:
  - hits: `httpRequest.cacheHit=true`, `statusDetails=response_from_cache`
  - edge location: `cacheId`
  - the Short code: `requestUrl`
- Logging is enabled per backend service and is off by default. `logConfig.sampleRate` ranges 0–1 and defaults to 1.0.
- **UNVERIFIED:** whether `sampleRate` also thins cache-hit entries.
- **Pricing** ([Observability pricing](https://cloud.google.com/stackdriver/pricing)):
  - Ingestion into a log bucket: $0.50/GiB, first 50 GiB/project/mo free, 30 days of storage included.
  - **Routing is free.** Entries excluded from buckets and sent only to BigQuery or Pub/Sub incur no Logging charge.
  - A `sample(insertId, f)` filter can thin what is stored ([query language](https://docs.cloud.google.com/logging/docs/view/logging-query-language)).
- **Cloud Run:** also writes its own request logs, but only for misses ([Cloud Run logging](https://docs.cloud.google.com/run/docs/logging)).

**LB metrics in Cloud Monitoring** ([metrics list](https://docs.cloud.google.com/monitoring/api/metrics_gcp_i_o))
- `https/request_count` (DELTA INT64).
- `https/total_latencies`, `https/backend_latencies` and `https/frontend_tcp_rtt` are **DISTRIBUTIONs**, so percentiles can be computed.
- Labels: `cache_result` (HIT/MISS/…), `response_code_class`, `client_country` and `proxy_continent`.
- Sampled every 60 s, visible within 210 s.
- **Free:** these are system metrics.
- **Sampled:** "Metrics are based on sampled traffic … The sampling rate is dynamic and cannot be adjusted." So request volume from metrics is approximate.
- **Retention:** 24 months, full resolution for 6 weeks and 10-min points after that ([quotas](https://docs.cloud.google.com/monitoring/quotas)). The LB doc says "six weeks", so the two docs conflict.
- **Cloud Run `request_latencies`:** a distribution, covering misses only, kept 6 weeks ([metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z)).

### Latency semantics
- **`total_latencies`:** from the proxy receiving the first request byte to the last response byte.
  - The LB doc says it "doesn't include the RTT between the client and the proxy".
  - The metrics list says "until the proxy got ACK from client on last response byte", which would add about one RTT.
  - **This conflict is unresolved.**
- **`backend_latencies`:** edge to origin. It should be empty for cache hits (inference).
- **`frontend_tcp_rtt`:** the Visitor's smoothed RTT per connection.
- **Log `httpRequest.latency`:** server-side processing time ([LogEntry](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry)).

### Querying and serving
- **Monitoring API reads** (since 2025-10-02): $0.50 per million time series returned, first 1M/billing account/mo free ([pricing](https://cloud.google.com/stackdriver/pricing)).
- **p90:**
  - The filter API's aligners offer only percentiles 05/50/95/99, so **there is no p90** ([Aligner](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies#Aligner)).
  - p90 needs PromQL: `histogram_quantile(0.9, …_bucket)`. System distribution metrics are queryable as Prometheus histograms ([PromQL](https://docs.cloud.google.com/monitoring/promql), [query_range](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v1/projects.location.prometheus.api.v1/query_range)).
  - **UNVERIFIED:** that PromQL reads are billed per series the same way.
- **Log Analytics SQL** in the console is free. A linked BigQuery dataset has no ingestion charge, but BigQuery analysis is billed ([Log Analytics](https://docs.cloud.google.com/logging/docs/log-analytics)).
- **Sink to BigQuery:** uses legacy streaming, $0.01 per 200 MiB ([BigQuery export](https://docs.cloud.google.com/logging/docs/export/bigquery), [BigQuery pricing](https://cloud.google.com/bigquery/pricing)).
- **No public dashboards:** sharing is IAM-only ([share dashboards](https://docs.cloud.google.com/monitoring/charts/share-dashboards)).
- **A Cloud Run page that queries Monitoring server-side and caches** stays within the free tiers: 6 series once a minute ≈ 259k series/mo ([Cloud Run pricing](https://cloud.google.com/run/pricing)).

### Synthetic uptime
- **Uptime checks** ([uptime checks](https://docs.cloud.google.com/monitoring/uptime-checks), [config](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.uptimeCheckConfigs)):
  - Price: $0.30 per 1k executions beyond **1M free per project/mo**. Each region's run counts separately.
  - A global 1-minute check ≈ 259k executions/mo, so it is **free**.
  - Intervals: 60/300/600/900 s. At least 3 checker regions are required.
- **Results via the API:**
  - `uptime_check/check_passed` and `uptime_check/request_latency`.
  - Kept only **6 weeks** (inferred from the quotas page).
- **Synthetic monitors:** $1.20 per 1k executions beyond 100 free, so a 1-minute monitor ≈ $52/mo ([introduction](https://docs.cloud.google.com/monitoring/uptime-checks/introduction)).

### Future per-Link events
- LB logs include cache hits and carry the Short code, so a sink to BigQuery or Pub/Sub reuses the same pipeline.
- `sampleRate < 1.0` is applied at generation, which permanently loses per-Link counts.
- Log entry size is **not published**; ~1–1.5 KB is an **UNVERIFIED** estimate.
- Estimates at 5B Redirects/mo with ~1.5 KB entries (≈7 TiB) ([Pub/Sub pricing](https://cloud.google.com/pubsub/pricing)):

| Destination | ≈ Monthly cost |
|---|---|
| Stored in a Cloud Logging bucket | ~$3,470 |
| Sink → BigQuery streaming | ~$358 + ~$160 storage per month retained |
| Pub/Sub delivery | ~$273 |
| Pub/Sub BigQuery subscription | ~$341 |
| `sampleRate` 0.01 into a bucket | ~$10 (no per-Link counts) |

---

## Composable (Fly.io + third-party CDN + third-party monitoring)

### Fly.io
- **Managed Prometheus (VictoriaMetrics)** ([metrics](https://docs.fly.io/monitoring/metrics/)):
  - Endpoint: `https://api.fly.io/prometheus/<org>/`. PromQL/MetricsQL via `/api/v1/query_range`.
  - Auth: an org or read-only token, which must stay server-side.
  - **~15-day retention.** Currently no charge ("Pricing could change … advance notice").
  - Managed Grafana at fly-metrics.net. **UNVERIFIED:** public sharing.
- **Proxy metrics:**
  - `fly_edge_http_responses_count{status}` and `fly_edge_http_response_time_seconds` (a histogram, so `histogram_quantile` gives p50/p90/p99).
  - `fly_app_http_response_time_seconds` and `fly_app_connect_time_seconds`.
  - **UNVERIFIED:** the histogram bucket boundaries, which limit how precise p99 can be.
- **Latency semantics:**
  - Edge response time is "the total time it takes to respond with the first HTTP response headers". It includes edge↔worker forwarding, possibly across regions ([fine-tune apps](https://docs.fly.io/apps/fine-tune-apps/); staff answer on [community](https://community.fly.io/t/fly-io-instance-response-times/23460/2)).
  - App response time excludes proxy overhead.
  - Neither includes the Visitor's network or TLS handshake (TLS handshake time is its own histogram).
  - With a CDN in front, both see CDN misses only.
- **Logs** ([logging overview](https://docs.fly.io/monitoring/logging-overview/), [exporting logs](https://docs.fly.io/monitoring/exporting-logs/), [fly-log-shipper](https://github.com/superfly/fly-log-shipper), [pricing](https://docs.fly.io/about/pricing/)):
  - Built-in search keeps 7 days.
  - fly-log-shipper (Vector, self-deployed) exports to S3/R2, Loki, Axiom and others. You pay for its Machine plus egress (from $0.02/GB).
  - **UNVERIFIED:** Fly appears to have no per-request proxy access log, so per-request events would come from the app.

### CDNs in front (cached Redirects are visible only here)
- **Bunny.net:**
  - Stats API: requests, cache hit rate, 3xx/4xx/5xx, `AverageOriginResponseTime`, hourly granularity. **No edge latency and no percentiles** ([statistics](https://bunny.net/docs/reference/statisticspublic_index)).
  - Raw logs: kept 3 days via API, or archived to Edge Storage ([CDN logging](https://bunny.net/docs/cdn-logging)).
  - Syslog forwarding: 10–30 s delay, and Bunny "cannot guarantee 100% delivery" ([log forwarding](https://bunny.net/docs/cdn-log-forwarding)).
  - Pricing: $0.005–0.06/GB, no request fees, $1/mo minimum ([pricing](https://bunny.net/pricing/cdn/)).
- **Fastly:**
  - Real-time API: 1-s buckets for 120 s, plus a `miss_histogram` of origin latency. That is origin only, not Visitor-facing, but percentiles can be derived ([real-time](https://www.fastly.com/documentation/reference/api/metrics-stats/realtime/)).
  - Historical API: minute data 35 days, hourly 375 days, `miss_time` averages, no percentiles ([historical](https://www.fastly.com/documentation/reference/api/metrics-stats/historical-stats/)).
  - Log streaming: free up to an average of 2 lines per request ([high-volume logging](https://www.fastly.com/resources/datasheets/observability/fastly-high-volume-logging)).
  - Pricing: 1M requests + 100 GB/mo free, then $0.01 per 10k requests ([pricing](https://www.fastly.com/pricing)).
- **Cloudflare Free as the CDN:**
  - GraphQL volume analytics are available.
  - Timing percentiles need Pro+.
  - Logpush needs Enterprise.
  - The only way to capture per-request data is a Worker, which bills every request (see the Cloudflare section).

### Third-party synthetic uptime (probes, not real-Visitor latency)

| Service | Free tier | Paid step up |
|---|---|---|
| UptimeRobot ([pricing](https://uptimerobot.com/pricing/), [terms](https://uptimerobot.com/terms/)) | 50 monitors at a 5-min interval, 1 status page, 3 months of response-time history. Commercial use allowed | — |
| Better Stack ([pricing](https://betterstack.com/pricing)) | 10 monitors at 3-min checks, 1 status page. "Free for personal projects" (terms **UNVERIFIED**) | — |
| Checkly ([pricing](https://www.checklyhq.com/pricing/)) | 10k API runs/mo, 2-min minimum interval, 1 status page | $24/mo |
| Grafana Cloud Synthetic Monitoring ([pricing](https://grafana.com/pricing/)) | 100k API executions/mo (1-min from 2 probes ≈ 86k) | — |

All of these record response time from a few probe locations. That suits uptime/downtime, but not real-traffic p50/p90/p99.

### Grafana Cloud Free
- **Allowances:** 10k active series, 50 GB logs, 14-day retention ([pricing](https://grafana.com/pricing/)).
- **Externally shared dashboards:** no login, and they support Prometheus/Loki data sources ([shared dashboards](https://grafana.com/docs/grafana-cloud/visualizations/dashboards/share-dashboards-panels/shared-dashboards/)).
  - Every view queries the data source.
  - No Free-tier restriction is stated.
  - **UNVERIFIED:** whether query caching is on Free.
- **Series budget:** using Fly's Prometheus as a data source ingests no series. Federating Fly histograms into Grafana Cloud would use series (buckets × status × region × host).

### Future per-Link events
- **Uncached Redirects:** the app can emit events to a queue or to ClickHouse/Tinybird. The Tinybird Events API takes NDJSON, up to 100 requests/s per data source ([Events API](https://www.tinybird.co/docs/forward/get-data-in/events-api)).
- **Cached Redirects at a third-party CDN** reach analytics only via that CDN's log stream: Bunny syslog (best-effort) or Fastly streaming. Cloudflare Free has no such stream.

---

## Open questions to test before a design depends on them
- **Cloudflare:**
  - Free-plan `httpRequestsAdaptiveGroups` retention (query the `settings` node).
  - The exact `workersInvocationsAdaptive` quantile field names, including p90 and wall time.
  - The AE SQL API rate limits.
- **AWS:**
  - Whether a CloudFront distribution counts as an "AWS endpoint" for free Route 53 health checks.
  - The actual v2 log record size against the 750-byte free allowance.
  - Whether metric-filter data points use the log event's timestamp, given the delivery lag.
- **GCP:**
  - Whether `total_latencies` includes the final-ACK RTT.
  - Whether `sampleRate` thins cache-hit entries.
  - Whether PromQL reads are billed per series.
  - The real LB log entry size.
  - Whether `backend_latencies` stays empty on hits.
- **Fly:**
  - The histogram bucket boundaries.
  - Whether a per-request proxy access log exists.
  - Whether fly-metrics.net dashboards can be shared publicly.
- **Bunny:** whether the log response-time field is edge or origin time.
