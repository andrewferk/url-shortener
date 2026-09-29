---
status: accepted
---

# Cache Redirects only inside the Worker: a 30 s per-colo cache in front of a 60 s KV cache, `no-store` to browsers, and no purge

Every Redirect runs the Worker ([ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md)), and the zone cache sits behind the Worker, so it never sees a Redirect. That leaves two caches that matter: KV's own edge cache, and whatever the Visitor's browser keeps. Workers KV bills every read, per key, whether or not its edge cache served it. So KV's `cacheTtl` buys latency, not money. [ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md) priced peak KV reads at a 90% edge hit ratio as if cached reads were free. Only a cache the Worker owns makes that figure true, and the Cache API is free. We put a short per-colo cache in front of KV and keep browsers out of it entirely. Nothing is purged: deletion is bounded by the TTLs alone.

Decided in [How are Redirects cached at the edge?](https://github.com/andrewferk/url-shortener/issues/12).

## Decision

- **What a lookup returns:** a KV value holds the Link's Target URL, its Expiry and its state (live or deleted).
  - The Worker evaluates Expiry on every request with the domain core's `Clock`. Caching never delays an Expired link: a cached value goes Gone at its Expiry exactly.
  - Deleting a Link writes a **tombstone value** to KV through the shard's outbox. The Worker never deletes a KV key and never sets KV's native `expiration`.
  - So Expired and Deleted links answer 410 from a cache hit. Only Short codes that were never issued miss KV and fall back to the shard.
- **Expiry is immutable,** set only when the Link is created, like its Target URL. Deletion is the only change a Link's cached value ever goes through.
- **KV `cacheTtl`: 60 s** (KV's default) on every Redirect read.
- **Per-colo cache:** the KV reader adapter keeps KV *hits*, live and tombstoned, in the Cache API for **30 s**.
  - The key is internal to the Worker, one per Short code. It is never a Visitor-facing URL.
  - KV misses and shard-confirmed not-founds are never stored, so a newly claimed Short code is never hidden by a cached not-found.
  - The stored entry is separate from the response sent to the Visitor. The Worker still runs, and still emits a Redirect event, on every request.
- **`Cache-Control: no-store` on every Redirect Worker response:** 302, 404, 410, and ADR 0004's 429 and 503. A browser never replays a Redirect without the Worker seeing it.
- **No negative caching** beyond what KV does on its own. KV's cached misses don't reduce shard traffic, because every KV miss falls back to the shard anyway. [ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)'s shard-fallback limit and daily cost brake bound that traffic.
- **No purge on delete.** KV can't be purged, and the Cache API purges only one colo at a time from inside a Worker. A Deleted link stops redirecting once its tombstone has passed through both caches. The worst case is about **90 s** after the outbox writes it (30 s colo + 60 s KV), which keeps ADR 0001's "about 1–2 minutes".
- **Redirect events:** the outcomes in ADR 0003 gain `colo-hit`, a 302 served from the per-colo cache. `kv-hit` now means the colo cache missed and KV answered.

## Cost

**Today:** $0 extra. The Cache API isn't billed, and Redirect KV reads stay within Workers Paid's included 10M.

**Peak** (30B Redirects/mo): uncached, KV reads would cost about **$15k/mo** ($0.50 per 1M), whatever `cacheTtl` is. At a 90% per-colo hit ratio they drop to about $1.5k, the figure ADR 0001 used, so its ≈$11–25k/mo range stands. The 90% is an assumption, not a measurement. Redirect events split `colo-hit` from `kv-hit`, so the real ratio shows up on the Status page's data.

## Considered options

- **KV only, `cacheTtl` 60 s.** Simplest, with the tightest delete bound (about 60 s). Rejected because peak KV reads would cost about $15k/mo, taking the peak range to about $24–38k.
- **A longer KV `cacheTtl`.** It saves nothing, since cached reads are billed. It also stretches the delete bound, and how long a new Link falls back to the shard, past what ADR 0001 and ADR 0004 assume.
- **KV native `expiration` for Expiry, and KV deletes for Deleted links.** Every request for an Expired or Deleted link would miss KV and hit the shard. That traffic would count against the shard-fallback limit and the cost brake. A popular Link that expired would start answering 429 or 503 instead of 410 to Visitors sharing an IP.
- **`Cache-Control` letting browsers cache 302s or 410s.** Cached responses skip the Worker. The Status page and future click analytics would miss them, and a cached 302 would outlive a delete. The saving is repeat Worker requests only.
- **A per-colo cache of shard-confirmed not-founds.** It only helps when the same unknown Short code is requested over and over. Guessing attacks use a different code each time. It would also let a newly claimed Custom alias look nonexistent.
- **Negative entries in KV.** Every guess would buy a $5-per-1M KV write.
- **Purging on delete** through the zone purge API. It saves at most 30 s, and needs an API token in the Durable Object plus headroom under purge rate limits.

## Consequences

- **A Deleted link can keep redirecting for about 90 s,** and its Redirect events show 302s during that window. There is no faster takedown lever for a single Short code: ADR 0004's emergency block works by IP, country or ASN.
- **Changing a Link's Target URL or Expiry is off the table,** not just unimplemented. Either change would need a cache-invalidation story this design doesn't have.
- **Tombstones stay in KV forever,** one per Deleted link, inside ADR 0001's KV storage estimate.
- **ADR 0001's peak cost relies on the per-colo cache.** Removing it roughly adds $13.5k/mo at peak.
