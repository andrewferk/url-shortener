---
status: accepted
---

# Links are immutable, and deleting a Link erases its Target URL

Immutability was never decided on its own. [ADR 0006](./0006-redirect-caching-kv-values-colo-cache-no-store.md) called changing a Target URL or Expiry "off the table" because the caches had no invalidation story, and [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md) built the change log on the premise that "a Link's fields never change", so replay merges entries in any order by "the deleted one wins". The PRD's [features review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5942436020) found the cache reason weak (an edit would ride the same outbox and TTLs as a delete, about 90 s) and the log the real blocker, and asked for editing to be decided on its merits. The [security review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5942073170) found the opposite gap: a Deleted link keeps its Target URL forever in the shard, the Creator list and the locked change log, and Target URLs often carry tokens or personal data.

Both are decided here. A Link is immutable because a Short URL is a promise to Visitors about where it goes, not because the caches can't cope. And deletion is the erasure path: deleting a Link removes its Target URL from every copy, with the change log's own compaction carrying the erasure through the locked bucket.

Decided in [Can a Link's fields ever change or be erased?](https://github.com/andrewferk/url-shortener/issues/50).

## Decision

### A Link's fields never change

- **The Target URL, Expiry, Custom alias flag, Creator and creation time are fixed when the Link is created.** There is no edit, no extending or removing an Expiry, no undelete and no pause. The only change a Link ever makes is live → deleted, once.
- **This is a property of the service, not a limitation.** Three independent lines land on the same side:
  - **Visitors.** A Short URL that is printed, shared or scanned must keep meaning what it meant. Abuse guidance for shorteners says the same: never change a Target URL, and answer 404 or 410 ([abuse research](https://github.com/andrewferk/url-shortener/issues/47#issuecomment-5942711906)).
  - **Integrity.** With nothing allowed to change, a Target URL that differs between two live records of one Link is tampering by definition. That gives [How is a silent Redirect hijack detected?](https://github.com/andrewferk/url-shortener/issues/56) a sharp invariant (below).
  - **Replay.** ADR 0008's merge rule stays "the deleted one wins", with no version column. Restores, drills and compaction keep working in any order.
- **This is "never", not "not yet".** The change log does not gain a `version` column as insurance. Keeping the door open would weaken the integrity invariant for a feature this ADR rules out.
- **The Link API has no update operation,** and `docs/api/openapi.yaml` defines none. The fix for a wrong Target URL or Expiry is to delete the Link and create another.
- **A typo behind a Custom alias burns that alias.** Short codes are never reissued ([ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)), so a Creator who deletes `launch` because its Target URL was wrong cannot claim `launch` again, even for itself. This is accepted, and the Link API docs say so: check the Target URL before claiming an alias. There is no reclaim window, because a reissue to the same Creator still re-points a Short URL Visitors may already have followed.

### Deleting a Link erases its Target URL

Every deletion erases: a Creator's delete, an Operator's takedown, and `creators remove --delete-links` ([ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md)).

- **The shard rewrites the row.** The delete sets `deleted_at` and `deleted_by` as before, sets `target_url` to the empty string, and fills a new column:

  ```sql
  target_url_sha256 TEXT   -- NULL while live, or when the hash is unknown
  ```

  The value is the lowercase hex SHA-256 over the UTF-8 bytes of the stored Target URL (the normalized form ADR 0009 compares). The domain core owns the function, pinned by a test vector, like the shard hash.
  - `target_url` keeps `NOT NULL`, and `STRICT` holds. The column is in the initial schema, so no migration follows.
  - **The hash earns its place twice.** A keyed create ([ADR 0009](./0009-idempotent-link-creation-by-key-derived-short-codes.md)) that finds its own earlier attempt already deleted can still tell a replay from a key reuse: it hashes the request's Target URL and compares. And the Operator can still answer "was it this URL?" to an abuse report, without holding the URL.
  - **A row rebuilt from `LINKS`** (ADR 0008's reconcile) comes from a tombstone that never had the URL, so it gets the empty string and a `NULL` hash.
- **The copies follow through the outbox,** unchanged in mechanism: the delete makes the same `(short_code, destination)` items pending, and each delivery reads the current, scrubbed row.
  - **The Creator list row** gets the empty string for `target_url` and no hash. Nothing in a listing needs it.
  - **The KV tombstone** already carries no Target URL (ADR 0008) and doesn't change.
  - **The change-log entry** is the scrubbed row.
- **Compaction carries the erasure through the locked bucket.** ADR 0008's merge rule is "the deleted one wins", so once the scrubbed entry is in the log, every daily and snapshot compaction keeps it and drops the live entry that held the URL. The URL is out of every retained object once the objects that held it retire: minute objects after their 2-day lock, dailies after 90 days, and the last three monthly snapshots. That is about **three months** after the delete, and nothing ever touches a locked object.
- **The Link API omits `target_url` on a Deleted link,** in `GET /v1/links/{shortCode}` and in listings. `openapi.yaml` marks the field as present on every Link whose `state` isn't `deleted`. It is never `null`: a live Link always has a destination.
- **The Operator's audit record keeps the full Target URL.** A takedown's and a Creator removal's `ops/` record (ADR 0010) lists every Link it deleted with its Target URL. That is the Operator's own evidence for the abuse report it acted on. The records are locked for 90 days and never retired by compaction, so this is the one place a taken-down URL outlives three months, and it is the Operator's to delete once the lock passes, which is the honest answer to an erasure request about a taken-down Link.
- **Deletion is the only erasure path.** An Expired link isn't deleted, so it keeps its Target URL and the API still shows it; the Creator deletes it to erase it. A third party whose personal data sits in a live Link's URL is served by a takedown.
- **Erasure is eventual across restores.** Point-in-time recovery to before a delete brings the row back, URL and all, until the log replay that every restore runs re-applies the scrubbed delete. The recovery window is 30 days, so that is the longest a URL can resurface.

### The invariant handed to hijack detection

For one `(Namespace, Short code)`, across every record the change log holds:

- `created_at`, `creator_id`, `custom_alias`, `expires_at` and `idempotency_key` never differ;
- `deleted_at` and `deleted_by` are set at most once and never unset;
- `target_url` differs only between a live entry and a deleted entry, and then the deleted entry's `target_url_sha256` equals the hash of the live entry's `target_url`.

Anything else is tampering. Whether compaction checks it, and what it alerts, is decided in [How is a silent Redirect hijack detected?](https://github.com/andrewferk/url-shortener/issues/56).

### When

- **Slice 1.2** (the domain core): the Target URL hash and its test vector.
- **Slice 1.3** (create and Redirect, locally): `target_url_sha256` in the initial shard schema.
- **Slice 3.2** (delete): the row rewrite, the scrubbed Creator list row, and the omitted field in the API.
- **Slices 6.2 and 6.3** (takedowns, Creator removal): the Target URL in the `ops/` records.
- **Slice 6.1** (change log) changes nothing. The existing merge rule does the log erasure.

No slice moves between milestones.

## Cost

**Today:** $0.

**Peak:** a Deleted link's row grows by about 64 bytes for the hash and shrinks by its Target URL, so the shard and the log get smaller, not larger. `ops/` records grow by one URL per deleted Link. Nothing else changes.

## Considered options

- **An editable Target URL,** versioned: an additive `version` column and "highest version wins, deleted wins ties". It is reopenable without touching a permanent format, and it is the most-asked-for shortener feature the design omits (fixing a typo, re-pointing a printed QR code). Rejected because a re-pointed Short URL is the hijack this service most needs to be able to rule out, abuse guidance says never to do it, and it reworks restores, drills and the glossary for a feature that delete-and-create replaces.
- **"Not now, maybe later":** keep the API immutable but write the versioned merge rule from slice 6.1 so the door stays open. Rejected because the open door is what the integrity invariant would have to tolerate.
- **Extend-only Expiry changes.** The one Expiry edit with a real use (a campaign that runs over). Rejected: it alone would force the versioned merge rule, and a new Link does the job.
- **Pause as a fourth Link state, or undelete.** Both are a Deleted link coming back, which breaks "deleted wins" and the glossary's "the deletion is permanent". The Operator's takedown already covers "under investigation", one way.
- **A reclaim window** for a Creator's own just-deleted alias. A reissue in all but name, and a hijack window.
- **A `dry_run` on create.** It catches alias typos, not Target URL typos.
- **Keep the Target URL forever** (ADR 0008 as written), "as the record of what was taken down". Rejected: there was no erasure path at all, and the Operator's evidence belongs in the audit record, not in a row every copy carries.
- **Scrub on a Creator's delete only, keep it on a takedown.** Simplest for the abuse case, but then a takedown can't serve an erasure request.
- **Blank the Target URL with no hash.** It loses ADR 0009's replay check against a deleted row and "was it this URL?".
- **Overwrite `target_url` with a `sha256:<hex>` sentinel,** no new column. No schema change, and the hash rides to every copy for free. Rejected because every reader must parse a prefix before trusting the column as a URL, the integrity check becomes a string rule inside compaction, and a row rebuilt without a hash would need a second sentinel.
- **A hash only in the `ops/` record,** not the URL. The Operator would then be unable to show what it removed when answering the report it acted on.
- **A separate scrub operation** the Creator or Operator runs after a delete. One more thing to build, audit and forget. Making erasure a property of deletion means it can't be skipped.

## Consequences

- **Amends ADR 0006:** immutability of the Target URL and Expiry is a chosen property of a Link, not a consequence of the caches. The 90 s delete bound is unchanged.
- **Amends ADR 0008:** a Deleted link no longer keeps its Target URL in the shard; the row holds the empty string and `target_url_sha256`. The merge rule "the deleted one wins" is unchanged and is now a deliberate choice. The Creator list's deleted rows carry an empty `target_url`. "A shard rebuilt from `LINKS` loses deletion details" now includes the hash.
- **Amends ADR 0009:** a keyed create that finds its own deleted row compares the request's Target URL by hash. Key reuse is still caught.
- **Amends ADR 0010:** takedown and Creator-removal audit records carry the Target URL of every Link they delete.
- **The glossary** states that a Link's fields never change, that a Target URL is erased on deletion, and that a Deleted link's Target URL is erased.
- **The map's standing preference "Target URL is immutable" stands,** now with a reason.
- **[How is a silent Redirect hijack detected?](https://github.com/andrewferk/url-shortener/issues/56) inherits the invariant above.** A delete legitimately changes `target_url`, so any check must compare a deleted entry's hash against the live entry, not the raw field.
- **A listing shows a Deleted link without its destination.** A Creator who wants to know what a deleted Link pointed to must keep that record itself.
- **The hash is a weak secret.** Anyone holding a deleted row can confirm a guessed URL. Target URLs with tokens are not guessable; those without are not secret.
- **The PRD's slices 1.2, 1.3, 3.2, 6.2 and 6.3** gain a line each through the closing ticket, [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60).
