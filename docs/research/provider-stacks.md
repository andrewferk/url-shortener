# Provider stacks: $20/mo today, a credible path to peak

Research for [#2](https://github.com/andrewferk/url-shortener/issues/2), a child of the map in [#1](https://github.com/andrewferk/url-shortener/issues/1). This document states facts and trade-offs only. The choice itself belongs to [#6](https://github.com/andrewferk/url-shortener/issues/6), "Which provider, runtime topology, and language do we build on?".

**Checked 2026-09-26.** Figures are list prices in USD for US regions (us-east-1 / us-central1 / iad), taken from official pricing pages, docs, limits pages, and the Terraform/OpenTofu registry APIs. Each claim links to its source. Items marked **UNVERIFIED** are inferences, assumptions, or cases where official pages disagree.

## Workload assumed

- **Personal scale (today):** about 10k Redirects/day (about 300k/month) and about 10k Links.
- **Hypothetical peak:** 100M DAU × about 10 Redirects/day comes to about 1B Redirects/day. That is about **30B Redirects/month**: about 11.5k req/s on average and 50–100k req/s at peak.
- **Links at peak:** **1B Links**, about 0.5 TB including indexes. Creators add 1–10M Links/day, which is 30–300M writes/month.
- **Latency:** the Redirect target is about 200 ms.
- **Response size:** a 302 is about 0.4–1 KB on the wire, so peak egress is about 12–30 TB/month.

Peak costs are **order-of-magnitude estimates at list price**. They rest on stated hit-ratio, CPU, and response-size assumptions, which are **UNVERIFIED**. At 30B requests/month, private or volume pricing is likely on every provider.

---

## Summary comparison

| | **Cloudflare**<br>Workers + KV / D1 / DO | **AWS**<br>CloudFront + Lambda + DynamoDB | **GCP**<br>Cloud Run + Firestore (+ LB/CDN/Armor) | **Composable**<br>Fly.io + Turso/Neon + Upstash (+ Cloudflare Free) |
|---|---|---|---|---|
| **Cost today (~300k Redirects/mo)** | **$0** on Workers Free, or **$5** on Workers Paid | **≈$0** without WAF; **≈$6.20** with a pay-as-you-go WAF ACL and 1 rule; $0 on the CloudFront flat-rate Free plan (eligibility caveat below) | **≈$0** for bare Cloud Run + Firestore (no CDN, no WAF); **≈$18.50** adding LB + Cloud CDN; **≈$26.70** adding Cloud Armor too (over budget) | **≈$2–4** for Fly + Turso Free + Upstash Free, with Cloudflare Free in front at $0. Fly has no free tier for new orgs. Neon always-on ≈$21–23 |
| **CDN / WAF / rate limiting at entry tier** | Unmetered DDoS; 5 custom WAF rules and 1 rate-limiting rule on Free (IP-keyed, 10 s period) | Shield Standard is free; WAF costs $5/ACL + $1/rule + $0.60/M requests; the flat-rate plans bundle WAF and IP rate limiting | Cloud CDN needs an external ALB (≈$18.25/mo forwarding rule); Cloud Armor Standard costs $5/policy + $1/rule + $0.75/M requests | Fly has no CDN or WAF. The Cloudflare Free zone in front gives CDN, WAF, DDoS protection and 1 rate-limiting rule |
| **Peak cost, order of magnitude** | **≈$11–12k/mo** with Workers Cache at a 90% hit ratio; **≈$25k** uncached. The Workers per-request fee (≈$9k) is a floor | **≈$51–64k/mo** pay-as-you-go. CloudFront HTTPS request fees (≈$30k) and WAF request fees (≈$18k) dominate. Flat-rate Premium tops out at 6B req for $10k; above that is custom pricing | **≈$4.9k** (Firestore Enterprise) to **$12.4k** (Firestore Standard) for bare Cloud Run with no CDN or WAF; **≈$24.5–47k** with LB + CDN + Cloud Armor | **≈$5.5–7.5k/mo** with sharded Upstash Fixed as the cache; **≈$1.3–2.5k** reading Turso directly, if a single database can take the load (**UNVERIFIED**) |
| **Datastore for 1B Links: shards without redesign?** | **KV: yes.** Storage is unlimited and it is managed as a global key-value store, but eventually consistent (≈60 s). **D1: no.** Max 10 GB per database, so at least 50 databases with sharding done in the app. **DO: no.** Max 10 GB per object and 1k req/s per object, so sharding is done in the app | **DynamoDB: yes.** Table size is unlimited and partitions are added automatically. Limits: 3k RCU / 1k WCU per partition; default quota of 40k RRU/s per table (adjustable) | **Firestore: yes.** Size is unlimited and key ranges split automatically, **but** monotonically increasing IDs hotspot on writes. **Bigtable: yes, by adding nodes**; 17k reads/s per SSD node, minimum ≈$474/mo | **Neon: no.** Single writer, max 56 CU; sharding means multiple projects. **Turso:** per-database size limit undocumented; many-database model with routing in the app. **Upstash:** 10–16k cmd/s per database, so sharding is done in the client |
| **Autoscale / pre-scale before a known peak** | Autoscaling is fully managed. There is no pre-scale mechanism and none is documented as needed. Workers Cache has no pre-populate API | DynamoDB **warm throughput** (a one-time fee; e.g. 12k→100k reads costs $11.44). Lambda **provisioned concurrency** can be scheduled. ElastiCache Serverless minimums must be set ≥60 min ahead. CloudFront has no pre-warm | Cloud Run min instances are best effort. Firestore has **no knob**: the 500/50/5 ramp takes ≈60–70 min to reach 50–100k ops/s. Bigtable min nodes can be set in IaC | `fly scale count N` pre-creates Machines, and autostop parks the spares. Raise `min_machines_running` before the peak. Org quotas need an email to Fly. Neon's minimum CU can be raised |
| **IaC (OpenTofu)** | `cloudflare/cloudflare` **v5.26.0** (2026-09-26), also on the OpenTofu registry. v5 minor releases keep shipping schema-breaking changes, so pin versions | `hashicorp/aws` **v6.66.0** (2026-09-21), also on the OpenTofu registry. CloudFront flat-rate plans are **not yet** supported | `hashicorp/google` **v8.4.0** (2026-09-22), also on the OpenTofu registry. The Firebase Hosting version/release resources need `google-beta` | **Weakest.** The Fly provider is archived and the community fork has been stale since 2025. The Neon provider is mid-transfer (community repo archived 2026-09-11; official not yet on the registry). Turso has community providers only. Upstash has `upstash/upstash` v2.1.0 |
| **Runtimes** | **TS/JS** is native. **Rust** is first-class via Wasm (workers-rs). **Go** runs via Wasm with community support only. **JVM:** none. Containers exist (Workers Paid) but have no autoscaling | **Node/TS**, **Java** (21/25, with SnapStart), **Go** and **Rust** on `provided.al2023` (Rust GA since 2025-11). Lambda@Edge supports Node/Python only; CloudFront Functions support JS only | Any Linux x86_64 container: **TS, Rust, Go, JVM** | Any container on Fly: **TS, Rust, Go, JVM**. Turso has official TS/Go/Rust SDKs; JDBC is community only |
| **Status page data** | Workers metrics (requests, CPU/wall-time quantiles) via the GraphQL Analytics API, kept 3 months | CloudFront request and error metrics are free; there is **no viewer-latency percentile**. Origin latency is a paid metric (≈$0.30/metric/mo) | `run.googleapis.com/request_latencies` (a distribution) and `request_count` are free | Fly-managed Prometheus/Grafana, currently free with ≈15-day retention, including edge response-time histograms |

### Cross-cutting facts

- **Per-request fees at the edge drive the peak cost.** At 30B requests/month:
  - Workers: $0.30/M ≈ $9k.
  - CloudFront HTTPS: $1.00/M ≈ $30k.
  - AWS WAF: $0.60/M ≈ $18k.
  - Cloud CDN lookups: $0.75/M ≈ $22.5k.
  - Cloud Armor Standard: $0.75/M ≈ $22.5k.

  Cloudflare's zone CDN, WAF and DDoS protection have **no per-request charge** on any plan. That is why a Cloudflare Free zone in front of a non-Cloudflare origin appears in the composable option. On Cloudflare itself, Workers run *before* the zone cache ([source](https://developers.cloudflare.com/cache/interaction-cloudflare-products/workers/)), so Worker-served Redirects are always billed per request.
- **302s can be cached on every CDN, but it is opt-in or conditional.**
  - Cloudflare's zone cache gives origin 302s a 20 min edge TTL by default ([source](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)).
  - Cloud CDN caches 302s that carry `Cache-Control` max-age/s-maxage or `Expires` ([source](https://cloud.google.com/cdn/docs/caching)).
  - Firebase Hosting caches Cloud Run responses only with `Cache-Control: public, s-maxage` ([source](https://firebase.google.com/docs/hosting/manage-cache)).
  - For CloudFront, no 3xx-specific rule was found (**UNVERIFIED**).

  Caching Redirects at the edge conflicts with counting every Visitor click at the origin, which matters for the future per-Link analytics that the map says must not be foreclosed.
- **Short code key shape matters.**
  - Firestore hotspots on monotonically increasing document IDs, and indexed sequential fields cap writes at 500/s ([source](https://cloud.google.com/firestore/native/docs/best-practices)).
  - Bigtable warns against sequential row keys ([source](https://cloud.google.com/bigtable/docs/schema-design)).
  - DynamoDB and KV place items by a hash of the key.

  A counter-based Short code needs a bijective scramble, which the map's sketch already includes, so that it does not hit the ordered-key hotspots on Firestore and Bigtable.
- **Eventual consistency of new Links:** Cloudflare KV can take ≥60 s to propagate, and it **caches negative lookups** for the cacheTtl (min 30 s). A Visitor who hits a new Short code at another location can get a not-found in that window ([source](https://developers.cloudflare.com/kv/concepts/how-kv-works/)). DynamoDB eventually consistent reads converge in about a second. Firestore reads are strongly consistent.

---

## Cloudflare: Workers + KV / D1 / Durable Objects

### Entry-tier limits

**Workers** ([pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/))
- **Free plan:** 100k requests/day and 10 ms CPU per invocation. Over the limit the Worker returns error 1027, or the route can be set to fail open.
- **Paid plan:** $5/mo minimum, including 10M requests/mo, then $0.30/M. Includes 30M CPU-ms, then $0.02/M CPU-ms.
- **Egress:** "no additional charges for data transfer (egress) or throughput (bandwidth)."
- **Blocked requests:** requests blocked by WAF or security features are not billed ([source](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)).

**Workers KV** ([pricing](https://developers.cloudflare.com/kv/platform/pricing/), [limits](https://developers.cloudflare.com/kv/platform/limits/))
- **Free plan:** 100k reads/day, 1k writes/day, 1 GB.
- **Paid plan:** 10M reads/mo included, then $0.50/M. 1M writes included, then $5.00/M. Storage 1 GB included, then $0.50/GB-mo. Account and namespace storage are "Unlimited".
- **Write rate:** 1 write/s per key.
- **UNVERIFIED:** whether edge-cached KV reads are billed. The estimates below assume every `get()` is billed.

**D1** ([limits](https://developers.cloudflare.com/d1/platform/limits/), [pricing](https://developers.cloudflare.com/d1/platform/pricing/))
- **Free plan:** 5M rows read/day and 100k rows written/day. 500 MB per database and 10 databases.
- **Paid plan:** 25B rows read/mo included, then $0.001/M. 50M rows written included, then $1/M. Storage $0.75/GB-mo.
- **Hard limits:** **10 GB max per database, "non-expandable"**. 50k databases per account; 1 TB per account (can be raised).
- **Throughput:** each database is single-threaded, about 1k queries/s at 1 ms per query.
- **Read replicas:** GA, one per region group, used through the Sessions API ([source](https://developers.cloudflare.com/d1/best-practices/read-replication/)).

**Durable Objects** ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/))
- **Paid plan:** $0.15/M requests and $12.50/M GB-s. SQLite storage $0.20/GB-mo.
- **Per-object limits:** **10 GB per object** and a soft limit of **1k req/s per object**. The number of objects is unlimited.

**Workers Cache** (GA, announced 2026-07-06) ([blog](https://blog.cloudflare.com/workers-cache/), [docs](https://developers.cloudflare.com/workers/cache/), [limitations](https://developers.cloudflare.com/workers/cache/limitations/))
- Serves cached responses without running the Worker, with tiered caching and tag purge.
- **Billing:** "every request to your Worker is charged at the standard Workers request rate". Cache hits use no CPU.
- **Pre-population:** there is no API to pre-populate the cache.

**Cache API** ([source](https://developers.cloudflare.com/workers/runtime-apis/cache/))
- Local to one data center, with no tiered caching.
- `cache.put()` rejects a 301/302 when the cache key ignores the query string but `Location` includes it.

**WAF, rate limiting and DDoS**
- **Rate-limiting rules:** Free 1, Pro 2, Business 5. On Free they are IP-keyed with a 10 s period ([source](https://developers.cloudflare.com/waf/rate-limiting-rules/)).
- **Custom WAF rules:** Free 5, Pro 20 ([source](https://developers.cloudflare.com/waf/custom-rules/)).
- **DDoS:** unmetered L3–7 DDoS protection on every plan ([source](https://developers.cloudflare.com/ddos-protection/)).
- **Workers Rate Limiting binding:** counts are local to each location and eventually consistent ([source](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).
- **UNVERIFIED:** the [Free plan marketing page](https://www.cloudflare.com/plans/free/) still describes rate limiting as a paid add-on. This appears to refer to the legacy product.

### Cost today

- **Free plan: $0.** 10k requests/day and 10k KV reads/day are under the 100k/day limits. About 5 MB of Links is under 1 GB. Link creation stays under the 1k writes/day limit.
- **Paid plan: $5.** All usage fits inside the included amounts.

### Cost at peak

Assumptions: about 1 ms CPU per request, 1 KV read per cache miss, 500 GB stored.

| Item | Workers Cache, 90% hit | No cache |
|---|---|---|
| Workers requests: (30,000M − 10M) × $0.30/M | $8,997 | $8,997 |
| CPU: misses only, or all requests | $59 | $599 |
| KV reads: 3B or 30B × $0.50/M | $1,495 | $14,995 |
| KV storage: 499 GB × $0.50 | $250 | $250 |
| KV writes: 30–300M × $5/M | $145–1,495 | $145–1,495 |
| **Total** | **≈$11–12.3k** | **≈$25–26k** |

- **D1 instead of KV** (sharded, 1 row read per lookup): reads stay inside the 25B included. Storage ≈$371 and writes ≈$10–550. The request floor of about $9k still applies.
- **Durable Objects instead of KV:** storage ≈$99 plus DO requests ≈$450, plus a duration charge that could not be estimated.
- **Observability:** Workers Logs at 100% sampling would add ≈$18k/mo; at 1% head sampling, ≈$168 ([source](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)).

### Scaling, IaC and runtimes

- **Scaling:** "There is no general limit on requests per second" ([limits](https://developers.cloudflare.com/workers/platform/limits/)). There is no provisioning or pre-warm mechanism. D1 and DO ceilings are addressed by sharding, not by pre-scaling.
- **IaC:**
  - `cloudflare/cloudflare` v5.26.0 was published 2026-09-26 ([registry API](https://registry.terraform.io/v1/providers/cloudflare/cloudflare)) and is also on the OpenTofu registry ([API](https://api.opentofu.org/registry/docs/providers/cloudflare/cloudflare/index.json)).
  - The provider is auto-generated from Cloudflare's API schema. v5 minor releases have dropped attributes and fixed perpetual-drift bugs ([releases](https://github.com/cloudflare/terraform-provider-cloudflare/releases)).
  - v4 is still patched (v4.52.9).
  - Wrangler (v4.141.0) is the Workers-native CLI.
- **Runtimes** ([languages](https://developers.cloudflare.com/workers/languages/)):
  - JS/TS and Python are first-class.
  - Rust uses [workers-rs](https://github.com/cloudflare/workers-rs), which compiles to Wasm and has KV, D1 and DO bindings.
  - Go runs only through Wasm, supported by community libraries such as [syumai/workers](https://github.com/syumai/workers) on TinyGo ([Wasm doc](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)).
  - There is no JVM support.
- **Containers** ([pricing](https://developers.cloudflare.com/containers/pricing/)):
  - Available with Workers Paid. Egress is charged at $0.025/GB in NA/EU after 1 TB.
  - Autoscaling is "Not today" ([source](https://developers.cloudflare.com/containers/beta-info/)).

---

## AWS: CloudFront + Lambda + DynamoDB (+ ElastiCache / DAX, WAF)

### Entry-tier limits

**Free Tier after 15 July 2025** ([free](https://aws.amazon.com/free/), [plans](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html))
- New accounts get $100 in credits, and can earn up to $100 more.
- A **Free plan** lasts 6 months or until the credits run out, then the account closes. A **Paid plan** is pay-as-you-go.
- Both plans keep the "always-free" offers listed below.

**CloudFront pay-as-you-go** ([pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/))
- **Always free:** 1 TB egress, 10M requests, 2M CloudFront Function invocations and 2M KeyValueStore reads per month.
- **After that:** HTTPS $0.0100 per 10k requests. US egress $0.085/GB up to 10 TB.
- **Edge compute:** CloudFront Functions $0.10/M. Lambda@Edge $0.60/M plus $0.00005001/GB-s.

**CloudFront flat-rate plans** ([docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html))

| Plan | Price | Requests | Transfer |
|---|---|---|---|
| Free | $0 | 1M | 100 GB |
| Pro | $15 | 10M | 50 TB |
| Business | $200 | 125M | 50 TB |
| Premium | $1,000 | 500M | 50 TB |

- **Premium upgrades:** configurable up to 6B requests / 600 TB for $10,000. Above that, contact sales.
- **No overage charges.** Sustained excess may lead AWS to adjust delivery.
- **Included:** WAF, IP rate limiting (5-minute window), geo blocking, DDoS protection, and a Route 53 zone.
- **Allowance:** requests blocked by WAF do not count against it.
- **KeyValueStore:** requires Pro or above.
- **Eligibility:** accounts "using AWS Free Tier" are excluded. **UNVERIFIED:** whether this covers the credits-based Free plan.
- **IaC:** there is **no Terraform resource yet** ([#45450](https://github.com/hashicorp/terraform-provider-aws/issues/45450)).

**Lambda** ([pricing](https://aws.amazon.com/lambda/pricing/))
- **Always free:** 1M requests and 400k GB-s per month.
- **Requests:** $0.20/M.
- **Duration:** Arm $0.0000133334/GB-s ([Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json)).
- **Function URLs:** free ([source](https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html)).
- **API Gateway HTTP API:** $1.00/M if used instead ([source](https://aws.amazon.com/api-gateway/pricing/)).

**DynamoDB** ([on-demand](https://aws.amazon.com/dynamodb/pricing/on-demand/), [provisioned](https://aws.amazon.com/dynamodb/pricing/provisioned/))
- **On-demand:** $0.125/M read request units and $0.625/M write request units. An eventually consistent read of an item ≤4 KB costs 0.5 RRU.
- **Storage:** $0.25/GB-mo.
- **Free tier:** 25 GB storage plus 25 RCU/25 WCU. The free capacity applies to provisioned mode only.

**Caches**
- **ElastiCache Serverless Valkey:** $0.084/GB-hr with a 100 MB minimum (≈$6.13/mo), plus $0.0023/M ECPU. A cache.t4g.micro node is ≈$9.34/mo ([source](https://aws.amazon.com/elasticache/pricing/)).
- **DAX:** dax.t3.small costs ≈$29.20/node-mo, and the typical cluster has 3 nodes. That is over budget at personal scale.

**WAF and Shield** ([WAF pricing](https://aws.amazon.com/waf/pricing/))
- **WAF:** $5 per web ACL, $1 per rule, $0.60/M requests.
- **Rate-based rules:** windows of 60–600 s, keyed by IP or custom keys; enforcement is approximate ([source](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html)).
- **Shield Standard:** free, covering L3/L4 ([source](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-standard-summary.html)).

### Cost today

- **Without WAF: ≈$0.02/mo.** CloudFront and Lambda usage is inside the always-free amounts. DynamoDB on-demand reads come to about $0.02.
- **Adding a pay-as-you-go WAF** (1 ACL and 1 rate-based rule) brings the total to **≈$6.20**.
- **On the flat-rate Free plan,** WAF and rate limiting cost $0, subject to the eligibility question above.
- **Edge-only alternative:** CloudFront Function + KeyValueStore. 10k Links is ≈2 MB, under the 5 MB store limit, and costs $0 on pay-as-you-go. It cannot scale to 1B Links (5 MB per store, 1 KB per value; [limits](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)).

### Cost at peak

Assumptions: 0.5 KB per 302, HTTPS, Lambda on Arm at 256 MB × 20 ms, 0.5 RRU per DynamoDB read.

| Item | 0% CDN hit | 90% CDN hit |
|---|---|---|
| CloudFront requests: 30B × $0.01/10k | $30,000 | $30,000 |
| CloudFront egress: ≈15 TB | $1,165 | $1,165 |
| WAF: 30B × $0.60/M | ≈$18,000 | ≈$18,000 |
| Lambda requests + duration | $8,000 | $800 |
| DynamoDB reads + writes + storage | $2,191 | $504 |
| Lambda logs (assumes ≈300 B per invocation) | ≈$4,500 | ≈$450 |
| **Total** | **≈$64k** | **≈$51k** |

- **API Gateway HTTP API** instead of a Function URL would add $2.7k (90% hit) to $27k (0% hit).
- **Flat-rate Premium** stops at 6B requests for $10k. 30B is 5× that, which puts it in custom pricing.
- **DynamoDB provisioned** at 0% hit costs ≈$550 for the average load, or ≈$4.7k if held at the 50k RCU peak all month.
- **DAX** with 3 × r5.large costs ≈$558.

### Scaling, IaC and runtimes

**DynamoDB**
- **Capacity:** table size is effectively unlimited ("unconstrained in number of items or bytes") ([quotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html)). Partitions are added transparently by a hash of the key ([partitions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html)).
- **Per-partition cap:** 3k RCU / 1k WCU ([source](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)). A single viral Link is capped at ≈6k eventually consistent reads/s unless it is cached.
- **Table quota:** the default is 40k RRU/s per table. The uncached peak (≈50k RRU/s) needs a quota increase.
- **On-demand scaling:** handles 2× the previous peak instantly ([source](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)).
- **Pre-scaling with warm throughput:** set through `UpdateTable --warm-throughput`, or `warm_throughput` in the `aws_dynamodb_table` resource. It cannot be decreased. It costs a one-time fee equal to one hourly RCU/WCU rate per unit of increase; AWS's example of 12k→100k reads is $11.44 ([docs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/warm-throughput.html)).

**Lambda** ([concurrency](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html), [scaling](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html))
- **Concurrency:** default 1,000, which also caps throughput at 10k RPS. The peak needs a concurrency quota increase to ≥10k.
- **Scaling rate:** +1,000 environments every 10 s per function. The same page elsewhere says 500, a discrepancy (**UNVERIFIED**).
- **Provisioned concurrency:** can be scheduled with Application Auto Scaling.

**Other services**
- **ElastiCache Serverless:** configured minimums take up to 60 min to apply, so set them ≥60 min before a peak ([source](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Scaling-serverless.html)).
- **CloudFront:** no pre-warm. Default quota is 250k req/s per distribution.

**IaC**
- `hashicorp/aws` v6.66.0 (2026-09-21), mirrored on the [OpenTofu registry](https://search.opentofu.org/provider/hashicorp/aws/latest).
- Resources exist for CloudFront Functions, KeyValueStore, and DynamoDB warm throughput. Flat-rate plans are missing.

**Runtimes** ([runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html))
- **Managed runtimes:** Node.js 22/24, Java 8–25, Python, .NET and Ruby, all on x86 and arm64.
- **Go:** runs on `provided.al2023`; the `go1.x` runtime is deprecated.
- **Rust:** runs on `provided.al2023` and has been **GA since 2025-11-14**, covered by AWS Support and the Lambda SLA ([announcement](https://aws.amazon.com/about-aws/whats-new/2025/11/aws-lambda-rust/)).
- **SnapStart** ([source](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)): Java 11+, Python and .NET. Not Node, Go or Rust.
- **Lambda@Edge** ([restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html)): Node and Python only, x86, us-east-1, with no provisioned concurrency.
- **CloudFront Functions:** JS only, with a 10 KB size limit and no network access.

**Status page data**
- CloudFront publishes requests and error rates for free, but **no viewer-latency percentiles**. Origin latency is a paid additional metric ([source](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/viewing-cloudfront-metrics.html)).
- CloudWatch prices: $0.30 per custom metric, $0.50/GB log ingestion ([source](https://aws.amazon.com/cloudwatch/pricing/)).

---

## GCP: Cloud Run + Firestore / Bigtable (+ Memorystore, LB + Cloud CDN, Cloud Armor)

### Entry-tier limits

**Cloud Run** ([pricing](https://cloud.google.com/run/pricing))
- **Request-based billing:**
  - Free each month: 2M requests, 180k vCPU-s, 360k GiB-s.
  - Then $0.40/M requests, $0.000024/vCPU-s, $0.0000025/GiB-s.
- **Instance-based billing:**
  - Free each month: 240k vCPU-s and 450k GiB-s.
  - **No per-request fee.** $0.000018/vCPU-s and $0.000002/GiB-s.
- **Egress:** 1 GiB/mo free in North America. Transfer to Cloud CDN or the load balancer is free.

**Firestore**
- **Standard edition** ([pricing](https://cloud.google.com/firestore/pricing)):
  - Free each day: 1 GiB stored, 50k reads/day, 20k writes/day.
  - Then $0.03 per 100k reads ($0.30/M), $0.09 per 100k writes, ≈$0.15/GiB-mo.
- **Enterprise edition** ([pricing](https://cloud.google.com/firestore/enterprise/pricing)):
  - $0.05/M read units (4 KiB each). For small point reads that is ≈6× cheaper than Standard.
  - $0.26/M write units; ≈$0.24/GiB-mo.

**Bigtable** ([pricing](https://cloud.google.com/bigtable/pricing))
- No free tier. The minimum is 1 node at **$0.65/hr, ≈$474.50/mo**.
- SSD storage ≈$0.17/GiB-mo.

**Memorystore** (no free tier)
- Redis Basic: the 1 GiB minimum is ≈$35.77/mo ([source](https://cloud.google.com/memorystore/docs/redis/pricing)).
- Valkey: the shared-core-nano node is ≈$23.21/mo ([source](https://cloud.google.com/memorystore/docs/valkey/pricing)).

**Cloud CDN** ([setup](https://docs.cloud.google.com/cdn/docs/setting-up-cdn-with-serverless), [CDN pricing](https://cloud.google.com/cdn/pricing), [LB pricing](https://cloud.google.com/vpc/network-pricing))
- Requires a global external Application Load Balancer with a serverless NEG in front of Cloud Run.
- **Forwarding rule:** $0.025/hr, **≈$18.25/mo minimum**.
- **Lookups:** **$0.75/M**. Egress $0.08/GiB up to 10 TiB. No free tier.

**Cloud Armor** ([pricing](https://cloud.google.com/armor/pricing), [policies](https://cloud.google.com/armor/docs/security-policy-overview))
- **Standard:** $5/policy/mo, $1/rule/mo, **$0.75/M requests** for global policies.
- **Enterprise Paygo:** ≈$200/mo plus a per-GiB data processing fee.
- **Where it applies:** only behind the load balancer. Edge policies run before the CDN cache. Rate limiting is available as throttle or rate-based ban ([source](https://cloud.google.com/armor/docs/rate-limiting-overview)).

**Firebase Hosting in front of Cloud Run** ([cloud-run](https://firebase.google.com/docs/hosting/cloud-run), [cache](https://firebase.google.com/docs/hosting/manage-cache))
- Needs the Blaze plan. It is a CDN with no per-request fee listed, and caches only responses that send `public, s-maxage`.
- **Transfer:** $0.15/GB beyond the free amount.
- **UNVERIFIED:** the free transfer allowance. [firebase.google.com/pricing](https://firebase.google.com/pricing) says 360 MB/day, while the [usage page](https://firebase.google.com/docs/hosting/usage-quotas-pricing) says 10 GB/mo.
- **UNVERIFIED:** no documented way to attach Cloud Armor, and no documented throughput ceiling.

### Cost today

| Setup | $/mo |
|---|---|
| Bare Cloud Run (scale to zero) + Firestore | **≈$0** |
| + 1 minimum instance (1 vCPU / 512 MiB, idle rate) | ≈$9.86 |
| LB + Cloud CDN | ≈$18.50 |
| LB + CDN + Cloud Armor Standard (1 policy, 3 rules) | **≈$26.70** (over budget) |
| Firebase Hosting + Cloud Run + Firestore | ≈$0 |
| Adding Bigtable / Memorystore | ≥$474.50 / ≥$23–36 |

### Cost at peak

Assumptions: 400 B per 302 (≈11.2 TiB egress). About 40 average instances at 1 vCPU / 512 MiB, each handling about 500 req/s (**UNVERIFIED**; the documented cap is 800 req/s per instance on HTTP/1).

**Bare Cloud Run + Firestore (no CDN, no WAF)**
- Firestore reads: $9,000 on Standard or $1,500 on Enterprise.
- Cloud Run instance-based compute ≈$2,000 (≈$1,080 with a 3-year CUD).
- Egress ≈$1,211. Storage and writes add under $400.
- **Total: ≈$12.4k (Standard) / ≈$4.9k (Enterprise).**
- Request-based billing would add ≈$12k in request fees.

**Plus Memorystore** (90% hit)
- Firestore reads fall to $900 (Standard) or $150 (Enterprise).
- The cache costs ≈$312 (3 Valkey standard-small nodes) to ≈$1,278 (50 GiB Redis).

**LB + Cloud CDN (90% hit) + Cloud Armor**
- CDN lookups alone cost **$22,500**.
- Cloud Armor Standard on an edge policy costs **$22,500**, or ≈$2,250 as a backend policy that only sees misses. Enterprise Paygo would be ≈$620–1,040.
- **Total ≈$24.5–47k.**

**Firebase Hosting in front:** ≈$1,676 of transfer, plus the cost of misses.

**Bigtable instead of Firestore:** 9–12 SSD nodes for the 100k req/s peak ≈$4.3–5.7k (1–2 nodes suffice for the average load). Storage ≈$87.

### Scaling, IaC and runtimes

**Firestore** ([quotas](https://cloud.google.com/firestore/quotas), [scaling](https://cloud.google.com/firestore/docs/understand-reads-writes-scale))
- **Capacity:** no stated limit on database size or document count. Key ranges split automatically.
- **Hotspots:** monotonically increasing IDs create a hotspot that splitting cannot fix.
- **Ramp-up:** the 500/50/5 rule means reaching 50–100k ops/s takes ≈60–70 min. There is **no provisioning knob**; pre-warming means sending synthetic traffic.

**Bigtable** ([performance](https://cloud.google.com/bigtable/docs/performance), [autoscaling](https://cloud.google.com/bigtable/docs/autoscaling))
- **Throughput:** up to 17k reads/s per SSD node, scaling linearly with nodes. 5 TB SSD per node.
- **Autoscaling:** set min/max nodes and a CPU target. Google advises raising the min nodes before a planned peak, because rebalancing takes minutes.

**Cloud Run**
- **Instances:** max instances defaults to 100 per revision, and can go higher up to regional quota ([max instances](https://cloud.google.com/run/docs/configuring/max-instances)).
- **Min instances** are best effort, with a recommended ≥3 for high availability ([min instances](https://cloud.google.com/run/docs/configuring/min-instances)).
- **Concurrency:** max 1,000 requests per instance.

**IaC**
- `hashicorp/google` v8.4.0 (2026-09-22). v8 is the current major, released 2026-08.
- **v8 breaking change:** the default load-balancing scheme is now `EXTERNAL_MANAGED` ([upgrade guide](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/version_8_upgrade)).
- On the [OpenTofu registry](https://search.opentofu.org/provider/hashicorp/google).
- `google_firebase_hosting_version` / `_release` require `google-beta`.

**Runtimes:** any Linux x86_64 container ([contract](https://cloud.google.com/run/docs/container-contract)). End-to-end HTTP/2 (h2c) avoids the 800 req/s per-instance cap on HTTP/1.

**Status page data** ([monitoring](https://cloud.google.com/run/docs/monitoring), [metrics](https://cloud.google.com/monitoring/api/metrics_gcp_p_z))
- `request_latencies` (a distribution, excluding container startup) and `request_count` are free.
- Read API: the first 1M time series per month are free.

---

## Composable: Fly.io + Turso / Neon + Upstash Redis (+ Cloudflare Free)

### Entry-tier limits

**Fly.io** ([pricing](https://docs.fly.io/about/pricing/), [trial](https://docs.fly.io/about/free-trial/), [discontinued plans](https://docs.fly.io/about/discontinued-plans/))
- **No free tier for new orgs.** The trial is 2 machine-hours or 7 days. The Hobby plan was discontinued on 2024-10-07. A card is required.
- **Machines (iad):** shared-cpu-1x 256 MB costs ≈$1.94/mo; performance-1x 2 GB ≈$31/mo. Regional markups are up to about 1.6×. Reservation blocks give 40% off.
- **Egress:** $0.02/GB in NA/EU, $0.04/GB in APAC.
- **Shared CPUs** have a 6.25% baseline with a burst balance, so they are unsuitable for sustained load ([source](https://docs.fly.io/machines/cpu-performance/)).
- **CDN and WAF:** no CDN or edge cache was found (**UNVERIFIED**) and there is no built-in WAF. The Wafris extension is a third-party option ([source](https://fly.io/docs/flyctl/extensions-wafris/)).

**Turso** ([pricing](https://turso.tech/pricing), [billing](https://docs.turso.tech/help/usage-and-billing))

| Plan | Price | Storage | Rows read/mo | Rows written/mo | Databases |
|---|---|---|---|---|---|
| Free | $0 | 5 GB | 500M | 10M | 100 |
| Developer | $4.99 | 9 GB | 2.5B | 25M | unlimited |
| Scaler | $24.92 | 24 GB, then $0.50/GB | 100B, then $0.80/B | 100M, then $0.80/M | unlimited |

- **Row reads** are counted as rows *scanned*.
- **Edge replicas** are deprecated for new users; embedded replicas replace them ([source](https://docs.turso.tech/features/data-edge.md)).

**Neon** ([pricing](https://neon.com/pricing), [plans](https://neon.com/docs/introduction/plans))
- **Free:** 0.5 GB and 100 CU-h per project. Scales to zero after 5 minutes, which cannot be disabled; waking takes a few hundred ms.
- **Launch:** $0.106/CU-h. **Scale:** $0.222/CU-h.
- **Storage:** $0.35/GB-mo.

**Upstash Redis** ([pricing](https://upstash.com/docs/redis/overall/pricing))
- **Free:** 256 MB and 500k commands/mo.
- **Pay-as-you-go:** $0.20 per 100k commands. Max 100 GB and **10k cmd/s per database**.
- **Fixed plans:** $10 for 250 MB up to $1,500 for 500 GB, with no per-command fee. Throughput is 10–16k cmd/s.
- **Enterprise:** "100K+" cmd/s.

**Cloudflare Free in front** ([plans](https://www.cloudflare.com/plans/network-cdn.md))
- Includes CDN, unmetered DDoS protection, the Free Managed Ruleset, and 1 rate-limiting rule.
- There is no per-request fee.
- Origin 302s are edge-cached for 20 min by default unless headers say otherwise.

### Cost today

- **Fly:** 1–2× shared-cpu-1x ≈$1.94–3.89.
- **Turso Free:** about 300k rows read against 500M included, so $0.
- **Upstash Free:** about 300k commands against 500k included, so $0. It fits, but not by a wide margin.
- **Total ≈$2–4/mo.**
- **With Neon instead of Turso:** a Redirect every ≈8.6 s keeps compute awake, which comes to ≈182 CU-h. That exceeds the Free plan's 100 CU-h, so compute would be suspended partway through the month. On Launch the cost is ≈$19.35, bringing the total to ≈$21–23.

### Cost at peak

Assumption: about 2,500 req/s per performance-1x vCPU (**UNVERIFIED**; needs a load test).

**Fly**
- Compute: 40× performance-1x ≈$1,240 always on, or ≈$744 with reservation blocks.
- Egress: 15–30 TB ≈$300–600 in NA/EU.

**Upstash**
- Pay-as-you-go would cost $60k at 30B commands, and caps at 10k cmd/s per database, so it is not viable.
- 10× Fixed 50 GB databases, sharded in the client, cost ≈$4,000.
- **Conflict (UNVERIFIED):** Fly's own docs say pay-as-you-go through Fly is capped at 10 GB, with fixed plans only up to 50 GB ([source](https://docs.fly.io/upstash/redis/)). This contradicts upstash.com.

**Datastore** (95% cache hit)
- Turso Scaler ≈$265–425, or Turso Pro ≈$620.
- Neon: storage $175, plus 8 CU always on at ≈$619 (Launch) or ≈$1,296 (Scale).

**Totals**
- With Upstash: **≈$5.5–7.5k/mo.**
- Without a cache, reading Turso directly: 30B rows is still inside Scaler's 100B included, so **≈$1.3–2.5k/mo**. This depends on single-database Turso throughput, which is undocumented.
- A Cloudflare zone cache in front would cut origin load further. That case was not costed.

### Scaling, IaC and runtimes

**Datastores**
- **Neon:** storage is unlimited on paid plans. It is a **single writer**: max 16 CU with autoscaling, or 56 CU fixed ([computes](https://neon.com/docs/manage/computes)). Read replicas are same-region only ([replicas](https://neon.com/docs/introduction/read-replicas)). There is no built-in sharding.
- **Turso:** the maximum size per database is **undocumented**. The API has a `size_limit` field ([source](https://docs.turso.tech/api-reference/databases/configuration)). Unlimited databases per account suits sharding in the app.
- **Upstash:** sharding across databases is done in the client, up to a limit of 100 databases.

**Fly scaling**
- Autostop/autostart "never creates or destroys Machines" ([source](https://docs.fly.io/launch/autostop-autostart/)).
- Pre-scale by creating the fleet with `fly scale count` ([source](https://docs.fly.io/flyctl/scale-count/)). Stopped Machines cost only $0.15/GB of rootfs per month.
- `fly-autoscaler` scales on metrics ([source](https://docs.fly.io/launch/autoscale-by-metric/)).
- Org scaling limits must be raised by email to Fly.

**IaC** (checked via the registry APIs)
- **Fly:** the official `fly-apps/fly` v0.0.23 (2023) is **archived**, and its README says it is "not a recommended method of deployment" ([repo](https://github.com/fly-apps/terraform-provider-fly)). The community fork `andrewbaxter/fly` v0.1.18 was last pushed 2025-02. The practical path is flyctl, `fly.toml`, and the Machines API.
- **Neon:** `kislerdm/neon` v0.18.0 was **archived 2026-09-11**, with a note that it will be maintained as `neondatabase/neon` ([repo](https://github.com/kislerdm/terraform-provider-neon)). That official name is **not yet on either registry**.
- **Turso:** community providers only. `jpedroh/turso` v1.2.0 describes itself as "unofficial".
- **Upstash:** `upstash/upstash` v2.1.0 (2025-08), published by the vendor. All four are on the OpenTofu registry.

**Runtimes**
- Fly runs any OCI container.
- Turso has official SDKs for TS, Go, Rust and Python; Java is community only ([source](https://docs.turso.tech/sdk/introduction)). SQL over HTTP works from any language.
- Neon works with any Postgres driver.
- Upstash works with any Redis client over TLS, or through its REST API.

**Status page data:** Fly's managed Prometheus/Grafana is "currently no additional charge", with ≈15-day retention. It includes `fly_edge_http_response_time_seconds` ([source](https://docs.fly.io/reference/metrics/)).

---

## Open questions (UNVERIFIED)

1. Whether a credits-based AWS Free-plan account can subscribe to the CloudFront flat-rate plans.
2. Whether Cloudflare Workers Cache hits count toward the Free plan's 100k requests/day, and whether edge-cached KV reads are billed.
3. The maximum size and throughput of a single Turso database, and when the `neondatabase/neon` provider will be published.
4. Whether large Upstash Fixed plans are available in Fly regions, given the conflict between Fly's docs and upstash.com.
5. Requests per second per instance for a Rust, Go, JVM, or TS Redirect handler. All peak compute figures assume a number that needs a load test.
6. Whether CloudFront caches 302s without explicit `Cache-Control`.
7. The two official Firebase Hosting pages disagree on free transfer.
