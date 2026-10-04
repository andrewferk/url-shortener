---
status: accepted
---

# Void a forged or mistaken delete, never lose an acknowledged delete in a restore, and retire the rollback review file

The 2026-10-04 audit found four places where deleting a Link, erasing its Target URL and restoring a shard disagreed:

- **Nothing could bring a wrongly deleted Link back.** [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md) and [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md) called a mass delete through the Creator path recoverable for 30 days. But [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md) has every restore re-apply the delete from the change log, and [ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md)'s rollback review can only accept a later entry or make it claim-only. Both leave the Link deleted.
- **A restore could lose a delete the service had acknowledged.** A delete in KV but not yet in the change log was rewound by point-in-time recovery, and the reconcile then wrote the Link, Target URL and all, back to KV for good. A frozen shard also kept accepting deletes while its drain was paused, so those reached neither KV nor the log.
- **The rollback review file was a second place a deleted Target URL survived.** It holds full rows, sat under `ops/`, and was never retired. It also held `Idempotency-Key` values, which [ADR 0009](./0009-idempotent-link-creation-by-key-derived-short-codes.md) says no audit record holds.
- **A keyed create had no stated answer** when its own earlier attempt had since been deleted.

Decided in [Settle the audit's deletion and restore gaps](https://github.com/andrewferk/url-shortener/issues/78).

## Decision

### The Operator can void a delete

- **A Void cancels one delete.** The Link is live again with every field as it was: the same Target URL, Expiry, Creator and creation time. Nothing about the Link changes, so the Short URL still means what it meant.
- **Any delete can be voided,** a Creator's or a Takedown, including [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md)'s daily-ceiling Takedowns.
- **The Operator voids only two kinds:** a forged delete, which neither the Link's Creator nor the Operator made, and the Operator's own mistaken Takedown.
  - A Creator who regrets their own delete is refused. The answer is still to create another Link.
  - The software can't tell a forged delete from a real one, so this rule is the Operator's to keep. The Operator docs state it, and `--reason` is required.
- **This is not the undelete ADR 0019 rejected.** There is still no undelete in the Link API, no pause and no fourth Link state. A Void is the Operator correcting a delete that should never have been made, through an audited operation.
- **`links void` is an Operator Workflow** (ADR 0010). It takes Short URLs on stdin like a takedown, prints its plan, and acts only with `--execute`. For each Link:
  1. **It reads the shard row.** A Link that isn't deleted is left alone and marked `not_deleted`.
  2. **It refuses a Link whose Creator was removed with its Links,** and marks it `creator_removed`. ADR 0010's `removed_with_links` flag would take the Link down again as it reached the Creator's list, and no Creator could ever manage it.
  3. **It finds the Target URL in the change log,** from the Link's live entry in the prod bucket, and checks its SHA-256 against the row's `target_url_sha256`. With no live entry, or a hash that differs, the Link stays deleted and is marked `no_live_entry` or `hash_mismatch`. A row rebuilt from `LINKS` has no hash, so it is voided on the signed live entry alone and marked `hash_unknown`.
  4. **It writes a void record, then changes the row.** The shard's gated `void` method puts the Target URL back and clears `deleted_at`, `deleted_by` and `target_url_sha256`. The outbox carries the live row to `LINKS`, the Creator list and the change log as usual, so Redirects answer 302 again within about 60 s.
- **It works for about three months after the delete,** while the prod bucket still holds the live entry (ADR 0019's erasure time). After that the Target URL is gone and a Void is impossible. It doesn't read the off-account copy.
- **`links find` gains `--deleted-since` and `--deleted-by`,** so the Operator can list the deletes behind ADR 0026's delete alert and pipe them into a Void.

### The void record

- **A void record lives in the change log,** at `log/void/<nn>/<op_id>.ndjson.gz`, one object per shard per operation. Each line names a Link and the `deleted_at` it voids. It holds no Target URL and no `Idempotency-Key`.
- **It is signed** like every object `links-data` writes (ADR 0026), locked for 90 days, and never retired from the prod bucket.
- **The merge rule becomes "the deleted one wins, unless that delete is voided".** Replay, compaction and the invariant check treat a deleted entry named in a void record as absent. Compaction drops it as it merges.
  - A later, real delete of the same Link has a new `deleted_at`, which no void record names, so it wins as before.
  - Replay still needs no ordering.
- **The record is written before the row changes,** so a live entry never reaches the log without it. Each step can safely run twice.
- **A forged void record is skipped.** The `production` token can add objects to the bucket (ADR 0024) but can't sign them.
- **Void records are copied off-account** with the dailies and snapshots ([ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md)), under the same retention. That is long enough: a void record is always uploaded after every object that holds the delete it names, so it outlives them there.
- **The `ops/` audit record** holds the reason, the counts and each Link's result, as for any operation. It lists no Target URL, because the Links are live.

### A restore never loses an acknowledged delete

- **A frozen shard refuses deletes.** A Creator's delete answers `503 unavailable` with `Retry-After`, as a keyed create does. A Takedown or a Void of a Link on that shard waits and retries.
  - A Takedown on a frozen shard already had no effect on Redirects until the unfreeze, because the drain is paused.
- **The restore drains the shard's outbox once before it rewinds.** After the freeze's 2-minute sleep, the job has the shard deliver every pending `kv`, `creator` and `log` item. It rewinds only once the outbox is empty.
  - `--skip-drain` is for a shard too broken to drain. The audit record notes it.
  - A shard that no longer exists (a deleted namespace) has nothing to drain.
- **The reconcile applies "the deleted one wins" to `LINKS` too.** A tombstone over a live shard row means the restore lost a delete. The reconcile deletes the row, which erases its Target URL, with the tombstone's `deleted_at` and `deleted_by`, and lists it in its report.
  - If a void record names that `deleted_at`, the tombstone is the stale one: the row stays live and is re-driven.
- **A tombstone carries `deleted_at` and `deleted_by`:**

  ```json
  {"v":1,"d":1,"c":"<Creator ID>","ts":<created_at ms>,"dt":<deleted_at ms>,"by":"creator"}
  ```

  `by` is `creator` or `operator`. Nothing is built yet, so this is the `v:1` shape, not a migration. Redirects don't read either field.
- **Outside a restore, the `LINKS` sweep alerts on a tombstone over a live row and heals neither side.** It is a lost delete or a forged tombstone, and only the Operator can tell. The Operator settles it with a Takedown or a re-drive. Every other mismatch is healed from the shard as before.

### The rollback review file is working data

- **It moves to `review/<op_id>/after-restore-point.ndjson.gz`,** a prefix with no bucket lock. It is signed, and it isn't copied off-account.
- **The operation deletes it** as its last step, and so does `ops cancel`. Compaction removes any review file older than 30 days, which is how long a Workflow instance is kept.
- **Nothing is lost.** The file is a filter of log objects that still exist, and re-running the step writes it again.
- **The audit record keeps** the claim-only list, the counts and the file's SHA-256.
- **So ADR 0019's "the one place a taken-down URL outlives" stays true,** and so does ADR 0009's rule that no audit record holds an `Idempotency-Key`.

### A keyed replay of a Deleted link answers with the Link as it is now

- **A keyed create that finds its own earlier attempt deleted, with a matching hash, answers `201`** with `Idempotent-Replayed: true` and the Link as it is now: `state: deleted` and no `target_url`.
- **It is the rule every replay already follows.** A replay returns the Link's current representation, not a stored copy of the first response.
- **A hash that differs still answers `422 idempotency_key_reused`.**
- **The Link API docs tell clients to read `state` on a replay.** A deleted `state` means the Short URL answers 410, and a retry will not make a new Link under that key.

### When

- **Slice 1.2** (the domain core): the tombstone shape with `dt` and `by`, in the pinned test vectors; the merge rule with voids.
- **Slice 3.2** (delete): the keyed replay's answer, and the docs line.
- **Slice 6.1** (change log): the `log/void/` prefix with its 90-day lock and the unlocked `review/` prefix; compaction honours void records and removes old review files.
- **Slice 6.2** (Workflows and takedowns): `links void`; `links find --deleted-since --deleted-by`. Docs: the Void runbook, with the rule on which deletes are voided.
- **Slice 6.4** (restores): a frozen shard refuses deletes; the drain before the rewind and `--skip-drain`; the reconcile's tombstone rule; the review file's prefix and its deletion.
- **Slice 6.5** (drills): two assertions. A delete made just before the freeze is still a delete after the restore, and a voided Link is live after a replay.
- **Slice 6.6** (off-account copy): void records are pushed.
- **Slice 6.8** (integrity checks): the sweep's tombstone rule; the invariant check honours void records.

No slice moves between milestones.

## Cost

**Today:** $0. One more KV read per delete, of the freeze flag, cached per colo.

**Peak:** a Void reads one shard's snapshot, dailies and minute objects from R2, about what `links find` reads for that shard. A void record is a few dozen bytes per Link. The pre-rewind drain delivers items the outbox would have sent anyway.

## Considered options

- **Every delete is final, forged ones too.** The simplest rule, and it keeps ADR 0019 untouched. Rejected because ADR 0024's claim would become "an unattended credential can irrecoverably delete every Link", and the only fix left would be authenticating Creators inside `links-data`, which ADR 0024 rejected.
- **A Void only through a rollback's review,** as a third disposition for a later entry. It reuses what exists, but a mass delete spans all 256 shards, so recovering from one would freeze the whole namespace for up to 7 days and rewind everything else.
- **Void only Creator-path deletes, never a Takedown.** It keeps the Void to forged deletes alone. Rejected: a mistaken Takedown is the Operator's own error, and delete-and-recreate can't fix it, because the Short code is never reissued.
- **Void any delete on a Creator's request.** That is an undelete with the Operator as the support desk, and "delete" would stop being an erasure a third party can rely on.
- **The void record under `ops/`.** It isn't copied off-account, so a rebuild from the off-account copy would re-delete every voided Link.
- **A column on the row,** a version or a voided-at time. That is the versioned merge rule ADR 0019 refused.
- **Accept that a restore can lose a delete,** and say so. An erased Target URL coming back for good, unnoticed, is the failure ADR 0019 exists to rule out.
- **Record a tombstone's re-delete as the Operator's.** A Creator's own delete would then show as a Takedown in their listing.
- **Scrub the review file and keep it under `ops/`.** Without Target URLs the Operator can't judge which later rows were bad.
- **Name the review file as a second place a Target URL survives.** Honest, but it weakens the erasure answer for a file nobody needs once the review is done.
- **Answer a keyed replay of a Deleted link with the request's Target URL echoed.** The API never otherwise shows a Target URL on a Deleted link.
- **Answer it with `410`.** It tells the client its create failed when it succeeded.

## Consequences

- **Amends ADR 0019:** the only changes a Link makes are live → deleted, and deleted → live by a Void. The invariant's "never unset" gains the exception of a voided delete. "No undelete" now means none for a Creator.
- **Amends ADR 0008:** the tombstone carries `deleted_at` and `deleted_by`, so a shard rebuilt from `LINKS` keeps them and loses only the hash and the `Idempotency-Key`. The merge rule honours void records. The reconcile re-deletes a live row under a tombstone. The bucket gains `log/void/` and `review/`.
- **Amends ADR 0006:** the tombstone's shape.
- **Amends ADR 0009:** the keyed replay of a Deleted link.
- **Amends ADR 0010:** `links void`; `links find`'s new flags; a frozen shard refuses deletes; the drain before the rewind; the review file's prefix and deletion.
- **Amends ADR 0024:** a forged delete is recoverable by a Void for about three months, not by point-in-time recovery for 30 days. The `void` method is gated.
- **Amends ADR 0025:** void records are copied off-account, and a rebuild copies them back with the snapshot and dailies.
- **Amends ADR 0026:** the delete alert's recovery is a Void; the sweep leaves a tombstone over a live row alone; the invariant check honours void records.
- **The glossary** gains **Void**, and **Link** and **Deleted link** name it as the one way a deletion is reversed.
- **A voided Link was down in between.** Visitors got 410 from the delete until about 60 s after the Void. Nothing tells them, or the Creator, that it happened; the void record and the audit record are the only trace.
- **A Void brings a Target URL back to every copy.** If the delete was an erasure someone was owed, voiding it is the Operator's mistake to answer for.
- **A Takedown can wait up to 7 days** on a shard frozen for a rollback review. Its tombstone already waited that long.
- **Erasure across restores (ADR 0019) is unchanged:** point-in-time recovery still brings a Target URL back until the replay re-applies the delete.
