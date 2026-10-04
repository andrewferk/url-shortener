---
status: accepted
---

> Amended by [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md): the Durable Object classes live in a separately deployed `links-data` Worker, which the Redirect Worker binds to.
>
> Amended by [ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md): there is a region to choose after all. Every shard and Creator object is placed by a required `location_hints.durable_objects` input, and D1 and R2 take optional hints. No jurisdiction is set.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): the 1,000 req/s soft limit is cited beside Cloudflare's 200–500 req/s guidance for storage writes, and the 256-shard arithmetic holds against the lower figure. Durable Object calls use RPC methods.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the topology line follows ADR 0017: there is a region to choose.

# Build on Cloudflare Workers in TypeScript, with sharded Durable Objects as the Link source of truth and KV as the Redirect read copy

The service must run for ≤ $20/mo today without anything capping out below 100M DAU / 1B Links, keep Short codes guaranteed unique, and put a CDN and firewall in front of Redirects. We build it edge-native on Cloudflare: a single global TypeScript Worker, sharded Durable Objects (SQLite) as the only strongly consistent write path, and Workers KV as the eventually consistent copy that Redirects read. It is the only single-provider stack that fits the budget with CDN, WAF and DDoS protection included, and its peak cost (≈$11–25k/mo at list) is the lowest of the single-provider options because the zone CDN and WAF carry no per-request fee.

Decided in [Which provider, runtime topology, and language do we build on?](https://github.com/andrewferk/url-shortener/issues/6), from the research in [Which provider stacks fit $20/mo with a path to peak scale?](https://github.com/andrewferk/url-shortener/issues/2) and [How do TypeScript, Rust, Go, and JVM compare for Redirects per platform?](https://github.com/andrewferk/url-shortener/issues/4).

## Decision

- **Topology:** edge-native, one global Worker deployment on Workers Paid ($5/mo). There is one region to choose, for the Durable Objects, and two optional ones ([ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md)). The zone stays on Cloudflare's Free plan.
- **Language:** TypeScript (strict). Warm Redirect latency is datastore-bound and equal across languages; on Workers, TypeScript is native while Rust and Go run as Wasm with larger bundles and rougher bindings. A hot path can later move to a Rust Wasm module without a rewrite.
- **Source of truth:** 256 Durable Object shards with SQLite storage, each Link placed by a stable hash of its Short code. A shard performs the atomic claim that makes Short codes unique (generated codes and Custom aliases alike) and keeps permanent tombstones so no Short code is ever reissued. The shard count is fixed from day one: it gives ≈2 GB per shard at 1B Links (the limit is 10 GB) and ≈256k req/s of fallback reads at the 1k req/s-per-object soft limit. That soft limit is still documented. Cloudflare's newer guidance puts one object at about 500–1,000 req/s for simple operations and about 200–500 req/s when each request writes to storage. Creates are storage writes, so 256 shards take about 51k–128k creates a second. Peak needs far less: 1B Links created within a single month would be about 400 a second.
- **Redirect read path:** Workers KV. After committing, a shard writes the Link to KV through an outbox retried by an alarm. On a KV miss, the Worker falls back to the owning shard, so a new Link never answers not-found to its first Visitors, even while KV is still propagating (~60 s) or has cached a negative lookup. A Deleted link may keep redirecting for up to about 1–2 minutes while KV and edge caches catch up.
- **Per-Creator listing:** one Durable Object per Creator holds that Creator's list of Links. It is a projection fed from the shard's outbox, like KV, so it is eventually consistent. Idle objects cost nothing, so at 100M Creators the cost is driven only by activity: ≈$0.1–1.3k/mo at peak, against ≈$115k/mo for querying all 256 shards on every listing.
- **No dedicated cache tier:** the read-through LRU from the original sketch is dropped. KV's edge caching is the cache. Whether Redirects are also served from Workers Cache (which skips the Worker) is left to the cache and Status page decisions.
- **IaC:** OpenTofu with the `cloudflare/cloudflare` provider, pinned to an exact version because v5 minor releases change schemas.
- **Ports and adapters:** a pure TypeScript domain core (Link, Short code validation, Expiry evaluation, the Redirect decision: 302, 404 or 410 Gone) that never imports `cloudflare:*` or Workers types. Its ports:
  - `LinkReader`: Redirect lookups.
  - `LinkRegistry`: atomic claim, create and delete. The only place Short code uniqueness is guaranteed.
  - `ShortCodeGenerator`: proposes *candidate* Short codes. A candidate can clash with an existing Custom alias, so the caller retries on a failed claim. How candidates are made belongs to [How are Short codes generated?](https://github.com/andrewferk/url-shortener/issues/5).
  - `Clock`.

  The Workers `fetch` handler, the KV reader with its shard fallback, and the Durable Object classes are adapters that call into the core. Workers call the Durable Objects through RPC methods, not the `fetch()` handler, as Cloudflare recommends. The core's tests run under plain Node with in-memory adapters; moving to Lambda or Cloud Run means new adapters, not a new domain.

## Cost

**Today** (~300k Redirects/mo, ~10k Links): **$5/mo**, the Workers Paid minimum. Everything fits its included amounts: 10M Worker requests; 10M KV reads, 1M KV writes and 1 GB of KV storage; 1M Durable Object requests, 400k GB-s, 50M SQLite rows written and 5 GB stored. That leaves $15 for a domain name. A Pro zone ($20–25/mo) would push the total over budget, so no decision may assume Pro.

**Peak** (30B Redirects/mo, 1B Links), order of magnitude at list price: **≈$11–25k/mo**. The Workers request fee (≈$9k) is the floor, then KV reads (≈$1.5k at a 90% edge hit ratio, ≈$15k uncached), KV writes (≈$0.1–1.5k), KV storage (≈$250) and the per-Creator lists (≈$0.1–1.3k). Nothing needs pre-scaling: Workers and KV scale automatically and Cloudflare offers no pre-warm, while shard capacity is fixed up front by the shard count.

## Considered options

- **AWS: CloudFront → Lambda → DynamoDB.** DynamoDB's conditional writes give uniqueness for free and it partitions automatically, and every language is supported. Rejected on peak cost (≈$51–64k/mo, mostly CloudFront and WAF request fees) and because edge latency percentiles need log processing.
- **A Cloudflare Free zone in front of AWS Lambda and DynamoDB.** The cheapest peak, because cached 302s cost nothing. Rejected because it means two providers, and two OpenTofu providers, against "target one provider initially".
- **GCP: Cloud Run → Firestore.** The only option with free edge latency percentiles. Rejected because the load balancer and CDN alone cost ≈$18.50/mo, and Firestore can't be scaled up ahead of a known peak.
- **KV alone, with no Durable Objects.** Rejected: KV has no conditional write, so two Creators claiming the same Custom alias at once could both "succeed".
- **D1 as the source of truth.** The same 10 GB-per-database limit and app-level sharding as Durable Objects, with coarser read replication. Durable Objects give the atomic claim and the per-Creator lists in one model.

## Consequences

- **Short code uniqueness lives in exactly one place,** `LinkRegistry`'s claim on the owning shard. A Short code generator that seems to guarantee uniqueness on its own is still not enough.
- **The shard count and the shard hash are effectively permanent.** Changing either means migrating every Link.
- **Probes of unknown Short codes reach Durable Objects,** because the KV-miss fallback must answer them. Rate limiting (see [How are Redirects and Link creation protected from abuse?](https://github.com/andrewferk/url-shortener/issues/8)) has to cover that path.
- **The Status page gets weaker data.** Pro doesn't fit the budget, and without it there are no edge latency percentiles, only Worker wall-time quantiles for requests the Worker runs. If Redirects are served from Workers Cache, those hits are invisible to the Worker too. [How does the Status page get its metrics and where is it served?](https://github.com/andrewferk/url-shortener/issues/7) must work within this.
- **Per-Link click analytics stays possible** as long as every Redirect runs the Worker. Serving Redirects from Workers Cache would trade that away, so that choice must be made knowingly.
