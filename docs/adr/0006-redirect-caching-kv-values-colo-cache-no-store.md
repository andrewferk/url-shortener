---
status: accepted
---

> Amended by [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md): Link values live in the `LINKS` KV namespace under `<shard hex>:<Short code>` keys. Every value, tombstones included, also carries the Creator ID and `created_at`, so KV can rebuild the shards.
>
> Amended by [ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md): `LINKS` keys, and so the per-colo cache key, are `<shard hex>:<Namespace ID>:<Short code>`.
>
> Amended by [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md): a Link's Target URL and Expiry are immutable as a chosen property of the service, not because the caches lack invalidation. The delete bound, about 60 s, is unchanged.

> Amended by [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md): the cost brake that bounds shard traffic resets every UTC hour, not every day.
>
> Amended in place by [Does the delete bound drop now that `cacheTtl` can be 30 s?](https://github.com/andrewferk/url-shortener/issues/59): KV's `cacheTtl` minimum fell from 60 s to 30 s on 2026-01-30, so `cacheTtl` is 30 s and the delete bound is about 60 s, not 90 s. "Cached KV reads are billed" is restated as an assumption, with a spike to measure it and a rule for the per-colo cache if it proves false.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): ADR 0019's note above says the delete bound is about 60 s, not 90 s.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the body's "daily cost brake" and its reason for immutability follow ADRs 0022 and 0019.

> Amended by [ADR 0028](./0028-void-a-forged-or-mistaken-delete-and-never-lose-a-delete-in-a-restore.md): a tombstone also carries `deleted_at` and `deleted_by`, as `dt` and `by`.

> Amended by [ADR 0030](./0030-budget-an-ordinary-month-alert-on-request-floods-and-request-spend-and-make-every-outcome-eligible-unless-excluded.md): `colo-hit` is eligible for the latency and error-rate Objectives, which now name the outcomes they exclude.

# Cache Redirects only inside the Worker: a 30 s per-colo cache in front of a 30 s KV cache, `no-store` to browsers, and no purge

Every Redirect runs the Worker ([ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md)), and the zone cache sits behind the Worker, so it never sees a Redirect. That leaves two caches that matter: KV's own edge cache, and whatever the Visitor's browser keeps. We assume Workers KV bills every read, per key, whether or not its edge cache served it. Cloudflare's pricing page says "All operations incur charges" and lists no exemption, but no page mentions cached reads, so a spike measures it (see [The billing assumption](#the-billing-assumption)). On that assumption KV's `cacheTtl` buys latency, not money. [ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md) priced peak KV reads at a 90% edge hit ratio as if cached reads were free. Only a cache the Worker owns makes that figure true, and the Cache API is free. We put a short per-colo cache in front of KV and keep browsers out of it entirely. Nothing is purged: deletion is bounded by the TTLs alone.

Decided in [How are Redirects cached at the edge?](https://github.com/andrewferk/url-shortener/issues/12).

## Decision

- **What a lookup returns:** a KV value holds the Link's Target URL, its Expiry and its state (live or deleted).
  - The Worker evaluates Expiry on every request with the domain core's `Clock`. Caching never delays an Expired link: a cached value goes Gone at its Expiry exactly.
  - Deleting a Link writes a **tombstone value** to KV through the shard's outbox. The Worker never deletes a KV key and never sets KV's native `expiration`.
  - So Expired and Deleted links answer 410 from a cache hit. Only Short codes that were never issued miss KV and fall back to the shard.
- **Expiry is immutable,** set only when the Link is created, like its Target URL. Deletion is the only change a Link's cached value ever goes through.
- **KV `cacheTtl`: 30 s** (KV's minimum; the default is 60 s) on every KV read on a request path: `LINKS` reads for Redirects, and `AUTH` reads, so a key revocation, Creator removal or suspension takes effect within about 30 s.
- **Per-colo cache:** the KV reader adapter keeps KV *hits*, live and tombstoned, in the Cache API for **30 s**.
  - The key is internal to the Worker, one per Short code. It is never a Visitor-facing URL.
  - KV misses and shard-confirmed not-founds are never stored, so a newly claimed Short code is never hidden by a cached not-found.
  - The stored entry is separate from the response sent to the Visitor. The Worker still runs, and still emits a Redirect event, on every request.
- **`Cache-Control: no-store` on every Redirect Worker response:** 302, 404, 410, and ADR 0004's 429 and 503. A browser never replays a Redirect without the Worker seeing it.
- **No negative caching** beyond what KV does on its own. KV's cached misses don't reduce shard traffic, because every KV miss falls back to the shard anyway. [ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)'s shard-fallback limit and cost brake (hourly since ADR 0022) bound that traffic.
- **No purge on delete.** KV can't be purged, and the Cache API purges only one colo at a time from inside a Worker. A Deleted link stops redirecting once its tombstone has passed through both caches. The worst case is about **60 s** after the outbox writes it (30 s colo + 30 s KV), inside ADR 0001's "about 1–2 minutes". It is "about" because Cloudflare documents no hard upper bound on how long a KV location can serve a stale value.
- **Redirect events:** the outcomes in ADR 0003 gain `colo-hit`, a 302 served from the per-colo cache. `kv-hit` now means the colo cache missed and KV answered. `colo-hit` is eligible for both request-based Objectives ([ADR 0030](./0030-budget-an-ordinary-month-alert-on-request-floods-and-request-spend-and-make-every-outcome-eligible-unless-excluded.md)).

## The billing assumption

Whether a KV read served from the `cacheTtl` cache is billed is not documented. The per-colo cache's whole cost case rests on it, so the project measures it once, and the outcome is decided in advance:

- **The spike:** a one-off, human-run measurement by the project in milestone 1, as soon as `LINKS` exists. Read one key many times inside one `cacheTtl` from one location, then compare the count with KV analytics and with the billed usage figure. It is not a `doctor` check: the answer is a fact about Cloudflare's pricing, the same for every Operator, and usage figures can arrive a day later. The result is recorded here.
- **Billed, or still unknown:** the per-colo cache stays as specified.
- **Proven not billed:** the per-colo cache and the `colo-hit` outcome are dropped. KV alone then gives the same read bill, and the delete bound becomes about 30 s.

Nothing before the per-colo cache's slice waits on the spike.

## Cost

**Today:** $0 extra. The Cache API isn't billed, and Redirect KV reads stay within Workers Paid's included 10M.

**Peak** (30B Redirects/mo): if cached reads are billed, KV reads without the per-colo cache would cost about **$15k/mo** ($0.50 per 1M), whatever `cacheTtl` is. At a 90% per-colo hit ratio they drop to about $1.5k, the figure ADR 0001 used, so its ≈$11–25k/mo range stands. The 90% is an assumption, not a measurement. Redirect events split `colo-hit` from `kv-hit`, so the real ratio shows up on the Status page's data.

## Considered options

- **KV only, `cacheTtl` 30 s.** Simplest, with the tightest delete bound (about 30 s). Rejected while cached reads are assumed billed, because peak KV reads would cost about $15k/mo, taking the peak range to about $24–38k. It becomes the design if the spike proves cached reads are not billed.
- **`cacheTtl` 30 s behind a 60 s per-colo cache.** Keeps the 90 s bound and roughly halves KV reads for popular Links at peak. Rejected because the bound is what a Creator or an abuse reporter sees, and the saving rests on a hit ratio nobody has measured.
- **Leaving `cacheTtl` at 60 s.** Same read bill, a 90 s bound, and at most half the KV reads after a per-colo expiry go past KV's own cache. Rejected for the bound; KV refreshes cached values in the background, under conditions it doesn't document, and `kv-hit` latency on the Status page's data will show whether the shorter TTL costs anything.
- **A longer KV `cacheTtl`.** It saves nothing if cached reads are billed. It also stretches the delete bound, and how long a new Link falls back to the shard, past what ADR 0001 and ADR 0004 assume.
- **KV native `expiration` for Expiry, and KV deletes for Deleted links.** Every request for an Expired or Deleted link would miss KV and hit the shard. That traffic would count against the shard-fallback limit and the cost brake. A popular Link that expired would start answering 429 or 503 instead of 410 to Visitors sharing an IP.
- **`Cache-Control` letting browsers cache 302s or 410s.** Cached responses skip the Worker. The Status page and future click analytics would miss them, and a cached 302 would outlive a delete. The saving is repeat Worker requests only.
- **A per-colo cache of shard-confirmed not-founds.** It only helps when the same unknown Short code is requested over and over. Guessing attacks use a different code each time. It would also let a newly claimed Custom alias look nonexistent.
- **Negative entries in KV.** Every guess would buy a $5-per-1M KV write.
- **Purging on delete** through the zone purge API. It saves at most 30 s, and needs an API token in the Durable Object plus headroom under purge rate limits.

## Consequences

- **A Deleted link can keep redirecting for about 60 s,** and its Redirect events show 302s during that window. There is no faster takedown lever for a single Short code: ADR 0004's emergency block works by IP, country or ASN.
- **Changing a Link's Target URL or Expiry is off the table,** not just unimplemented. As first decided here, the reason was that either change would need a cache-invalidation story this design doesn't have. [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md) made immutability a chosen property of a Link, not a consequence of the caches.
- **Tombstones stay in KV forever,** one per Deleted link, inside ADR 0001's KV storage estimate.
- **ADR 0001's peak cost relies on the per-colo cache** for as long as cached reads are assumed billed. Removing it then roughly adds $13.5k/mo at peak.
