---
status: accepted
---

# Place Links by SHA-256, keep each Link's row as its own tombstone, make KV a full second copy, and log every shard change to a locked R2 bucket

[ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md) put every Link in one of 256 SQLite Durable Object shards, projected into Workers KV for Redirects and into one Durable Object per Creator for listing. This ADR fixes the shapes those three copies take and how they're kept recoverable.

Two facts drive most of it:
- **Some of it can never change.** The shard hash and the KV key format are permanent: changing either means moving every Link.
- **Deletion can't be undone.** Cloudflare has no trash or restore for a deleted Durable Object namespace or KV namespace ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)). Durable Object point-in-time recovery (30 days, whole object) only works while the namespace still exists, and there is no Durable Object export tool.

So each copy can rebuild the others, and a change log of every shard lives outside both namespaces. The rule that no Short code is ever reissued ([ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)) has to survive every restore.

Decided in [What is the Link data model across shards, KV, and Creator lists?](https://github.com/andrewferk/url-shortener/issues/14).

## Decision

### Shard placement

- **The shard number** is the first byte of SHA-256 over the Short code's UTF-8 bytes, 0–255. The hash is unkeyed and takes the exact, case-sensitive Short code.
  - Custom aliases aren't random, so the Short code's own characters would cluster them onto a few shards.
  - A keyed hash would stop a Creator grinding aliases onto one shard, but it would bring back the permanent secret ADR 0002 rejected. Creator limits and the 10 GB shard ceiling already bound grinding.
- **The domain core owns the hash,** pinned by test vectors, so any future adapter reproduces it exactly.
- **Object names:** shard *n* is `idFromName("shard-" + n)`, with *n* in decimal. A Creator's object is `idFromName(creatorId)`. Both names are permanent.

### The shard

```sql
CREATE TABLE links (
  short_code   TEXT PRIMARY KEY,   -- exact, case-sensitive
  target_url   TEXT NOT NULL,
  creator_id   TEXT NOT NULL,      -- cr_… (ADR 0005)
  custom_alias INTEGER NOT NULL,   -- 1 if a Custom alias; a 7-character alias looks like a generated code
  created_at   INTEGER NOT NULL,   -- epoch ms, from the shard's Clock
  expires_at   INTEGER,            -- epoch ms; NULL means no Expiry
  deleted_at   INTEGER,            -- NULL while not deleted
  deleted_by   TEXT                -- 'creator' | 'operator'
) STRICT, WITHOUT ROWID;
```

- **The row is the tombstone.** A claim is `INSERT … ON CONFLICT DO NOTHING`, and deleting a Link only sets `deleted_at`, so the row stays forever and blocks any later claim. There's no separate tombstone table.
- **A Deleted link keeps its Target URL in the shard,** as the record of what was taken down. The KV copy drops it (below).
- **Expired links aren't marked.** Expiry is derived from `expires_at` whenever it's read.
- **`deleted_by`** separates a Creator's delete from an Operator's takedown. A Creator may delete only rows carrying its own `creator_id`.
- **No secondary indexes.** Every shard lookup is by Short code, and each index would add billed row writes.
- **Timestamps are epoch milliseconds** in the shard, KV and the Creator lists.
- **Storage:** ADR 0001's ≈2 GB per shard at 1B Links means about 500 bytes per Link. The Link API's Target URL length cap must keep the *average* well under the 10 GB ceiling, which is about 2.5 KB per Link.
- `STRICT` and `WITHOUT ROWID` are used if Durable Object SQLite accepts them. Otherwise the tables are plain, with the same keys.

### The outbox

The outbox is state-based, not event-based. It commits in the same transaction as the change to `links`.

```sql
CREATE TABLE outbox (
  short_code      TEXT NOT NULL,
  destination     TEXT NOT NULL,   -- 'kv' | 'creator' | 'log'
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  PRIMARY KEY (short_code, destination)
) STRICT, WITHOUT ROWID;
```

- **One pending item per `(short_code, destination)`.** The payload is read from the *current* `links` row when the item is sent, and a delete just makes the same item pending again.
  - So every delivery is idempotent.
  - No stale "live" write can land after a tombstone.
  - The destinations fail independently: a KV outage doesn't hold up the Creator lists or the change log.
- **Delivery:**
  - Every enqueue sets the alarm to "now".
  - The alarm handler drains items in batches and deletes each one once it's delivered.
  - A failure backs off exponentially, capped at 1 h.
- **The handler never throws.** Cloudflare retries a throwing alarm only 6 times, so the handler catches every delivery failure and schedules its own next alarm. That's what makes "retry forever" true. Nothing is ever dropped, and queue depth is logged.
- **KV allows one write per second to the same key.** A create followed quickly by a delete just gets retried.

### KV

- **Three namespaces,** so no binding can delete what it doesn't own. A KV binding that can write can also delete.

  | Namespace | Holds | Written by | Read by |
  |---|---|---|---|
  | `LINKS` | One value per Link | `links-data` (the outbox) | `redirect` |
  | `AUTH` | [ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)'s `cred:<sha256>` and `creator:<id>` | The Operator CLI only | `redirect` |
  | `FLAGS` | [ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)'s `brake:<utc-date>` and `cap:<creatorId>:<utc-date>` | `redirect` (the brake), `links-data` (the daily cap) | `redirect` |

  - `links-data` never binds `AUTH`.
  - Flag keys carry their UTC date, so "until midnight UTC" needs no cleanup. KV's native `expiration` garbage-collects these small keys.
- **`LINKS` keys are `<shard as 2 lowercase hex digits>:<Short code>`,** e.g. `07:Ab3xYz9`.
  - Listing one shard's keys is then a prefix list: about 4k list calls at peak instead of 1M. That's what makes a single-shard reconcile (below) affordable.
  - The Redirect Worker needs the shard number for its fallback anyway. Hashing before every read costs microseconds and no I/O.
  - This format is as permanent as the hash.
- **`LINKS` values** are versioned JSON, read with `type: "json"`:
  - live: `{"v":1,"t":"<Target URL>","e":<Expiry ms>,"c":"<Creator ID>","ts":<created_at ms>}`. The `e` is left out when there's no Expiry.
  - deleted: `{"v":1,"d":1,"c":"<Creator ID>","ts":<created_at ms>}`. A tombstone drops the Target URL and the Expiry, so a takedown removes the URL from the public read copy.
  - `c` and `ts` aren't needed to Redirect. They make KV a complete second copy of every Link except deletion details, so the shards can be rebuilt from it. With the change log in place, they cover only what the log can't: its last minute, and losing the backup bucket together with `links-data`. They cost $0 today and could be dropped later for free. Adding them back later would mean rewriting every value.
  - Nothing goes in KV metadata.
  - The shard answers the Worker's KV-miss fallback with the same value shape.

### The Creator list

```sql
CREATE TABLE links (
  created_at   INTEGER NOT NULL,
  short_code   TEXT NOT NULL,
  target_url   TEXT NOT NULL,
  custom_alias INTEGER NOT NULL,
  expires_at   INTEGER,
  deleted_at   INTEGER,
  deleted_by   TEXT,
  PRIMARY KEY (created_at, short_code)
) STRICT, WITHOUT ROWID;
-- plus a one-row `meta` table: creator_id, and the UTC day whose cap flag was already written
```

- **The list is a full copy of what a listing shows,** so a listing never fans out to the shards.
- **The table is ordered by listing order,** keyed on `(created_at, short_code)`, with no secondary index.
  - A page is one contiguous read, with no per-row lookup.
  - An arrival writes one row, with no index row on top. Cloudflare bills every index update as an extra row written.
  - Both key columns never change, so an arrival upserts on the full key.
  - Nothing needs a lookup by Short code alone: single-Link reads and deletes go to the shard.
- **Paging** is keyset, newest first: `WHERE (created_at, short_code) < (?, ?) ORDER BY created_at DESC, short_code DESC LIMIT ?`.
  - The cursor is opaque base64url of `(created_at, short_code)`.
  - Checked on SQLite 3.51 with 1M Links in one list: a page 500k deep touches 50 rows.
  - The order is total, so a cursor never skips or repeats a Link that's already listed. It isn't a snapshot, though: a late outbox arrival with an older `created_at` can land behind a client that has already paged past it.
- **Deleted and Expired links stay in the list,** marked by their state.
  - `creators remove --delete-links` is re-runnable.
  - The daily count doesn't drop when a Link is deleted.
- **The daily count** for ADR 0004's cap is `COUNT(*) WHERE created_at >= <today's UTC midnight>`. It's a range read of the key, and a retried arrival can't double-count. `meta` remembers the day whose `FLAGS` cap flag was already written, so the flag is written once.
- **`meta.creator_id`** maps object IDs from Cloudflare's namespace-listing API back to Creators, so every Creator object can be walked.
- **Filters are the Link API's decision.** If it offers them, there are two patterns:
  - "Not deleted": a partial index `ON links (created_at, short_code) WHERE deleted_at IS NULL`. Without it, a page behind many deleted Links scans the table; that measured 999k rows against 50 with the index.
  - "Not expired": this depends on the current time, so it can't be indexed. It uses a scan budget per page, for example 1,000 rows, and may return a short page with a cursor.
- **Ceiling:** about 20M Links per Creator before the 10 GB object limit. At 300 a day, that takes about 180 years.

### Schema migrations

- **Every shard and Creator object** records its applied migrations in `_sql_schema_migrations`. Durable Objects don't support `PRAGMA user_version`.
- **The constructor applies pending migrations** inside `blockConcurrencyWhile`, so an object is current before it serves anything. Objects migrate when they wake: nothing walks 100M Creator objects.
- **Migrations are additive only:** new columns, tables and indexes. Code must read every schema version still in the wild, because a Creator object may sleep for years.
- **A change to the `LINKS` value shape bumps `v`.** The Worker reads every `v` it has ever written, and the 1B values are never rewritten in bulk.
- Migrations ship with `links-data`, so only through ADR 0007's approval-gated `production-admin` job.

### Backups

| Copy | Protected by |
|---|---|
| Shards | Point-in-time recovery (30 days); the change log in R2; rebuilding from `LINKS` |
| `LINKS` | Re-driving every shard row through the outbox |
| Creator lists | Re-driving the `creator` destination from the shards |
| `AUTH` | Operator CLI exports to R2 |
| `FLAGS` | Nothing. The flags are dated and short-lived. |

- **The change log is the outbox's third destination, `log`.** Every change to a shard's `links` table also lands in R2, with the same retry-forever delivery as `kv` and `creator`.
  - **Entries** are full current rows, as gzipped NDJSON sorted by Short code. A retried write can duplicate entries, which is harmless.
  - **Batched per shard, at most once a minute.** A `log` item becomes due no sooner than 60 s after the shard's last log write. The drain then writes every due `log` item as one object, `log/minute/<nn>/<yyyy-mm-dd>/<timestamp>-<random>.ndjson.gz`. R2 objects can't be appended to, and one object per change would cost about $90–1,350/mo at peak in write operations.
  - **Replay needs no ordering.** A Link's fields never change, and the only change a row can make is live → deleted. So merging entries for the same Short code is "the deleted one wins": replay works in any order and in parallel.
  - **Replay can stop at a point in time.** The rows carry `created_at` and `deleted_at`, so replaying "as of T" ignores creates and deletes at or after T. That gives point-in-time recovery for as long as the log is kept, not just 30 days.
- **Compaction** is a Cron Trigger on `links-data`, run as a streaming merge per shard. That works because every object is sorted by Short code.
  - **Daily:** it merges yesterday's minute objects into `log/daily/<nn>/<yyyy-mm-dd>.ndjson.gz`.
  - **Monthly:** it merges the previous snapshot with that month's dailies into `log/snapshot/<nn>/<yyyy-mm>.ndjson.gz`. It never scans a shard.
  - **Recovery reads the latest snapshot, then the dailies since, then the minute objects since.**
- **The bucket** is an R2 bucket in the prod account, owned by `infra/env` with `prevent_destroy`, and bound only to `links-data`.
  - **Bucket locks per prefix** (`cloudflare_r2_bucket_lock`): minute objects are locked for 2 days; dailies, snapshots and `auth/` for 90 days.
  - **No lifecycle rule expires anything.** Compaction retires an object only once a newer object covering it has been written and its lock has passed. So a stuck compaction grows the bucket instead of losing data. It keeps the last three snapshots and every daily since the oldest of them, which is about three months of point-in-time replay.
  - **The lock guards against accidents, not against an admin:** anyone with R2 write can remove the rule first. The rules live in OpenTofu, so removing one shows up in a PR.
- **`AUTH` backups:** the Operator CLI gains `backup` and `restore`.
  - `backup` exports `AUTH` to `auth/<timestamp>.json.gz` in the same bucket. It holds only hashes, so it's safe to store, and it's never retired.
  - The CLI runs `backup` after every write it makes to `AUTH`.

### Restores

**Every restore ends with a reconcile, because a restore must never forget a claimed Short code.** A shard restored to an earlier point, or rebuilt from the log, can lack codes claimed since. `LINKS` still holds them, so the shard could reissue one. The reconcile:
1. lists the shard's `LINKS` prefix;
2. re-inserts every Short code the shard lacks, as a full row (this also enqueues it to `log`);
3. re-drives the `kv` and `creator` destinations for the shard.

**Rolling back past an incident doesn't drop what came after it.** Log entries after the stopping point are reviewed and re-applied, at the least as claims, so a rollback fixes the bad rows without forgetting any Short code.

| Loss | Restore |
|---|---|
| Bad code corrupted a shard (within 30 days) | Point-in-time recovery to a bookmark before the incident, then replay the log from that point, then reconcile |
| Corruption older than 30 days | Rebuild the affected shards by replaying the log as of just before the incident, then re-apply later entries after review, then reconcile |
| `links-data`'s namespace deleted (shards and Creator lists) | Redeploy. Replay each shard's latest snapshot, dailies and minute objects. Reconcile each shard from `LINKS`, which covers the last minute not yet logged, then re-drive `creator`. |
| `LINKS` namespace deleted | Recreate it, then re-drive the `kv` destination for every row in every shard |
| Backup bucket lost | Recreate it and re-seed: each shard writes a one-off full snapshot by scanning itself. The log carries on from there. |
| `AUTH` lost | `restore` from the latest `auth/` export |

How the Operator starts any of these belongs to [How does the Operator reach Link data (takedowns, Creator removal, restores)?](https://github.com/andrewferk/url-shortener/issues/24).

## Cost

**Today:** $0 extra.
- The change log and the `AUTH` backups fit R2's free tier (10 GB-month, 1M Class A operations). A shard writes a log object only when it has changes.
- Row reads and writes fit Workers Paid's included amounts.

**Peak** (1B Links):
- **`c`, `ts` and the key prefix** add about 55 bytes per `LINKS` value: about 55 GB, or ≈$25/mo of KV storage.
- **Creator lists** duplicate about 500 GB of Link data: ≈$100/mo of Durable Object storage.
- **A new Link writes about 10 SQLite rows:**
  - the shard row;
  - three outbox items, each inserted and then deleted;
  - an alarm;
  - the Creator list row.

  That's about $10 per 1M new Links once the included 50M rows written are used up.
- **R2 writes:** minute objects are at most 256 shards × 43,200 minutes, about 11M a month: ≈$45/mo above the free 1M. Compaction's reads and writes are under $1.
- **R2 storage:** three snapshots plus about three months of dailies, roughly 0.5 TB: ≈$7.5/mo.
- **One-off costs:** re-driving `LINKS` after it's lost costs ≈$5k of KV writes. Listing all of `LINKS` costs ≈$5.

This stays inside ADR 0001's ≈$11–25k/mo peak range.

## Considered options

- **FNV-1a mod 256.** Synchronous and tiny, but it's a hand-written function every future adapter would have to reproduce exactly. SHA-256 is standard everywhere.
- **A separate tombstone table** holding only the Short code. It saves little and loses the record of what a takedown removed.
- **An event outbox** (created, deleted) with payload snapshots. It needs ordered delivery to stop a stale create landing after a delete. Sending current state per item needs no ordering.
- **One KV namespace with key prefixes.** The same cost, but every binding that writes Link values could also delete credentials.
- **Bare Short codes as `LINKS` keys.** Then one shard's reconcile means listing all 1B keys, which is about 1M list calls and can't be spread per shard.
- **A lean KV value** (Target URL, Expiry and state only). It saves ≈$25/mo at peak. With the change log, KV's full copy only covers the log's last minute and a lost bucket. It's kept because dropping it later is free, while adding it back would mean rewriting every value (≈$5k at 1B Links).
- **A Creator list of Short codes only,** fetching details from the shards on each listing. A 50-Link page would cost up to 50 Durable Object requests.
- **A Creator list keyed by Short code with a `(created_at, short_code)` index.** It pages just as efficiently, but it writes twice the rows per arrival and needs a lookup per listed row.
- **Point-in-time recovery plus rebuilding each copy from the other, with nothing in R2.** It costs nothing, but it can't survive losing `links-data` and `LINKS` together, or corruption older than 30 days.
- **Nightly exports from a scan of each shard** (incremental, plus a monthly full). Up to a day of changes is at risk, and the full scans cost ≈$6/mo at peak. The change log cuts the risk to about a minute, with no scans.
- **One R2 object per change.** R2 can't append, so this means ≈$90–1,350/mo of writes at peak and billions of tiny objects to replay.
- **A change log with no compaction.** At peak, per-minute objects reach about 134M a year, and every recovery would have to list them all.
- **Backups in a separate Cloudflare account, or outside Cloudflare** (S3 or B2 with a compliance-mode object lock). Only these survive losing the prod account, but they add an account or a provider, a stored credential and S3 client code. Deferred (see Consequences).

## Consequences

- **The shard hash, the object names and the `LINKS` key format are permanent.**
- **Losing the whole prod account, or a compromised Operator token, can lose everything,** because the bucket lock can be removed by anyone with R2 write. This is an accepted risk for now. It is revisited at ADR 0007's trigger, the first real Creator, when the preview account split happens anyway.
- **If `links-data` and `LINKS` are lost together,** only changes not yet in the log are gone: about the last minute. Nothing records those Short codes, so they could be reissued. That's the one case where ADR 0002's guarantee doesn't hold.
- **Compaction must be monitored.** It never loses data, because objects are retired only once covered. But while it's stuck, minute objects pile up and recovery gets slower.
- **A shard rebuilt from `LINKS` loses deletion details.** A tombstone in KV says a Link was deleted, but not when or by whom.
- **The Link API ticket inherits:**
  - the Target URL size budget;
  - the cursor shape;
  - the two filter patterns;
  - `deleted_by`, so a Link removed by the Operator can say so;
  - that a create isn't naturally idempotent. A retry draws a new Short code, which usually lands on a different shard, so any idempotency record can't live in the shard that claims it.
- **Previews need a bucket without the lock.** A locked bucket can't be emptied, so ADR 0007's teardown would fail on one. The lock and `prevent_destroy` apply to prod only.
- **`production-admin` needs R2 edit** for the bucket and its lock. That extends ADR 0007's credentials table.
