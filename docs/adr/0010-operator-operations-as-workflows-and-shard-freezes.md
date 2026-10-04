---
status: accepted
---

> Amended by [ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md): operations address a Link by Short URL (or `--namespace` plus a Short code), and lists they print or read use Short URLs or `<Namespace ID>:<Short code>`.
>
> Amended by [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md): restore drills run these Workflows from GitHub Actions, in a throwaway `drill` environment with preview credentials only. Prod operations still never run from GitHub Actions. Bootstrap's check of the `operator` token's scope runs as the Operator CLI's `doctor`.
>
> Amended by [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md): the audit record of a takedown or a `creators remove --delete-links` lists every Link it deleted with its Target URL, because the shard erases the URL on deletion and the record is the Operator's evidence.
>
> Amended by [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md): `creators suspend` and `creators resume` are Workflows that call the Creator object. `links find` gains `--creator` and `--created-since`. Past the daily ceiling the Creator object makes Takedowns itself, with `deleted_by='operator'` and the reason "over daily ceiling", and writes their audit record under `ops/`.
>
> Amended by [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md): Operator-only shard and Creator-object methods take an `OPERATOR_GATE` secret that only `links-data` holds, so `redirect` can't call them. The `operator` token drops KV Edit and the laptop's R2 key becomes Object Read only; `links-data` writes every `ops/` and `auth/` object, and `ops record` audits a break-glass action afterwards. Corrections: Data Studio SQL is logged in Audit Logs v1, and `query/v2` is a published API.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): Creator removal takes about 30 s to stop creates. Durable Object calls use RPC methods. Fan-out uses `createBatch` and a rerun uses `restart`. `workers_dev` and `preview_urls` are `false` on all three Workers. A Cost section states that Workflow steps are billed: a full reconcile at peak is about 1.02M steps, $4.19 over the included amount.

> Amended by [ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md): an Operator Workflow reaches shards and Creator objects through the one stub factory, so every `get()` passes the deployment's location hint. The restore runbook resets the recorded hint before a deleted namespace is replayed.

> Amended by [ADR 0018](./0018-hash-the-case-folded-short-code-keep-aliases-case-sensitive-reserve-case-insensitive-mode.md): an operation that goes by Short URL computes the shard from the case-folded Short code. The per-shard reconcile is unchanged.

> Amended by [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md): `links-data` signs every object it writes to the backup bucket, `ops/` records included, and a restore skips an unsigned or wrongly signed object unless an override is given, which its audit record notes. A new Operator operation resumes a compaction that the invariant check stopped, naming the objects to drop or keep. The hourly `LINKS` sweep skips a frozen shard.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the audit record of an `AUTH` command follows ADR 0024.

# Run Operator operations as Workflows in `links-data`, audit them in the backup bucket, and freeze shards during restores

The shard and Creator Durable Objects live in `links-data`, which has no routes and deploys only through `production-admin` ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)). There is no admin endpoint ([ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)). Yet the Operator must reach that data:
- to take down a Link;
- to delete a removed Creator's Links;
- to run every restore in [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md): point-in-time recovery, log replay, re-seeding the bucket, the `LINKS` reconcile, and re-driving outbox destinations.

Point-in-time recovery can only be called from inside the object. Cloudflare has no REST call for a Durable Object method, but it does have one to start a Workflow instance. So every Operator operation is a Workflow defined in `links-data`, started by the Operator CLI, and running the objects' own code, so the outbox and audit trail can't be skipped.

A restore also opens a gap in [ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)'s rule that no Short code is reissued. Until its reconcile finishes, a restored shard can reissue codes claimed after its restore point. So restores freeze the shard from outside its own storage.

Decided in [How does the Operator reach Link data (takedowns, Creator removal, restores)?](https://github.com/andrewferk/url-shortener/issues/24).

## Decision

### The channel

- **Every Operator operation that touches Link data is a Workflow instance in `links-data`,** even a single takedown.
  - The Operator CLI starts it through Cloudflare's Workflows REST API.
  - Its steps call the shard and Creator objects' own RPC methods through the Worker's bindings.
  - No route, HTTP endpoint or service binding is added.
- **An operation writes only shard rows and outbox items.** The existing outbox drain stays the only writer to `LINKS`, the Creator lists and the change log. A second writer could land a stale value over a tombstone.
  - A re-drive marks outbox items pending a page at a time. It adds the next page only while that shard has fewer than 10k items pending for that destination (a `links-data` variable).
  - **Two exceptions:**
    - re-seeding a lost bucket, where each shard writes a full snapshot of itself to R2;
    - `links find`, which only reads R2.
- **Raw SQL is not an operating channel.** The `query/v2` API and the dashboard's Data Studio run SQL against a named object with only Editor on `links-data`.
  - Reads are allowed for investigation.
  - A write is break-glass, for when the Workflow path itself is broken. It must insert the matching `outbox` rows, the shard is reconciled afterwards, and the Operator writes the audit record by hand.
  - The Operator CLI never uses raw SQL.
- **All three Workers set `workers_dev = false` and `preview_urls = false` explicitly,** not only `links-data`. The render script fails the deploy if either is missing or true on any of them. `preview_urls` has to be stated: `workers_dev = false` does not disable Version or Preview URLs, and an omitted `preview_urls` leaves the stored setting alone.

### Credentials

- **The Operator CLI uses a dedicated `operator` API token, not the Operator's broad token.** It holds:
  - Editor on `links-data`, for starting, controlling and sending events to Workflow instances;
  - Workers Scripts Read, for instance status;
  - KV Edit, for ADR 0005's `AUTH` records.
- **The CLI also uses an R2 key scoped to the backup bucket** with Object Read & Write, for `links find` and the `auth/` exports. It can't change the bucket's lock rules or delete a locked object.
- **Neither credential has Workers Admin, R2 admin, DNS or zone rights.** The broad token stays in the password manager for bootstrap and for recreating deleted resources. Recreating goes through OpenTofu or `production-admin` anyway.
- **Both are created in `infra/bootstrap`** and kept in the password manager.
  - Bootstrap checks that a per-Worker Editor scope covers the `/workflows/*` endpoints. Cloudflare doesn't document whether it does.
  - If it doesn't, the token gets Editor over all Workers, which still carries no Admin.

### Approval and audit

- **There is one Operator, so there's no second approver.** Operations never run from GitHub Actions.
  - A single-Link command asks for a typed confirmation, such as retyping the Short code.
  - A bulk or restore command prints its plan and acts only with `--execute`.
- **An operation's ID is its Workflow instance ID, `op_<ulid>`.** Instances are kept for 30 days, the maximum.
- **`links-data` writes the audit record,** as the operation's first and last steps, to `ops/<yyyy-mm-dd>/<op_id>.json` in the backup bucket. Because the server writes it, a CLI bug can't skip it.
  - It holds the operation, its parameters, the reason, the start and end times, the counts, and any undo bookmark.
  - It's never retired, and it's locked for 90 days under a bucket lock on `ops/`, like `auth/`.
- **Commands that write only `AUTH`** are Workflows in `links-data` too ([ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md)), so `links-data` writes their audit records like any other. As first decided, `links-data` never bound `AUTH` and the CLI wrote these records.
- **The change log already records *what* changed.** It shows `deleted_by='operator'` and `deleted_at`. The audit record adds *why*, and it covers operations that change no row.

### Takedowns

- **A takedown targets Short codes:** one, or a list on stdin. `--reason` is required and is stored only in the audit record. The Creator sees `deleted_by: operator` and nothing more.
- **`links find --target-host <host>`** streams the latest snapshot, the dailies and the minute objects from R2, and prints matching Short codes to pipe into a takedown.
  - There is no Target URL index in the shards, and a scan puts no load on them.
- **An Expired link is taken down like a live one.** The tombstone drops its Target URL from `LINKS`.
- **An already Deleted link is left alone.** Its `deleted_by` is never overwritten, because live → deleted is the only change a row can make. The audit record marks it `already_deleted`. This matches how the Link API treats a Creator's delete ([ADR 0009](./0009-idempotent-link-creation-by-key-derived-short-codes.md)'s ticket).

### Removing a Creator with its Links

The Creator's list is the only index of its Links, and a Link can reach the list long after it's created (up to an hour's backoff per retry). So a single walk can miss Links. `creators remove --delete-links` runs in this order:
1. Mark the Creator removed in `AUTH`. New creates stop within about 30 s ([ADR 0006](./0006-redirect-caching-kv-values-colo-cache-no-store.md)'s `cacheTtl`).
2. Set a permanent `removed_with_links` flag in the Creator object's `meta`. From then on, every Link that arrives in its list is taken down on arrival: the Creator object calls the shard's delete with `deleted_by='operator'`.
3. Walk the list and take down every Link that's still live.

A re-run changes nothing. A late Link still redirects until it reaches the list: seconds usually, and at worst the outbox's backoff. Deletes of a single Link, by a Creator or the Operator, go straight to the shard and have no such gap.

### Long-running jobs

- **Shard-wide operations fan out:** reconcile, re-drive, log replay and re-seed.
  - A parent instance starts one child per shard (`op_…-<nn>`) with `createBatch`, which skips an ID that already exists within its retention, where `create` would throw. `--concurrency` sets how many run at once, 256 by default.
  - The parent checks its children once a minute and writes the final counts.
- **One step handles one page** of 1,000 keys or rows, and returns the next cursor as its result. A reconcile at peak is about 4k steps per shard, under the 10k default step limit. Each step retries with backoff.
- **Every step can safely run twice.** Inserts use `ON CONFLICT DO NOTHING`, and outbox items are state-based. So resuming is `restart` on the failed child, or on every child. `restart` is the documented way to run an existing instance ID again; a second `createBatch` only starts the children that don't exist yet.
- **The CLI has `ops status <op>`** (which sums up the children) and **`ops pause|resume|cancel <op>`.**

### Freezing a shard during a restore

A shard rewound by point-in-time recovery, or rebuilt from the log, lacks every code claimed after its restore point. Until its reconcile finishes, two things can go wrong:
- a create could claim one of those codes again. That's likeliest with a Custom alias or an `Idempotency-Key`, whose codes aren't random.
- its outbox could send a rewound "live" row to KV, bringing a taken-down Link back into the public copy until the log replay deletes it again.

Point-in-time recovery also rewinds anything the shard stores about itself, so the freeze lives in `FLAGS`, which `links-data` already writes:
1. The job writes `frozen:<nn>` and sleeps about 2 minutes so every colo sees it.
2. It restores and reconciles.
3. It deletes the flag.

While a shard is frozen:
- **Creates:** a generated code that lands on the frozen shard is redrawn; 255 times in 256 the new code lands on another shard. A Custom alias or keyed create for that shard answers `503` with `Retry-After`.
- **Its drain pauses:** the alarm handler reads the flag and sends nothing. Nothing is lost, because the reconcile re-drives every destination.
- **Redirects carry on,** from KV and the fallback to the shard.
- **Restoring the whole namespace freezes all 256 shards.**
- **Cancelling a restore leaves the shard frozen.** Only `shards unfreeze <nn>` lifts the freeze, with a typed confirmation and its own audit record.

### Restore procedures

- **Point-in-time recovery** runs inside the shard: `getBookmarkForTime`, then `onNextSessionRestoreBookmark`, then `ctx.abort()`. The undo bookmark that `onNextSessionRestoreBookmark` returns goes into the audit record, so a wrong restore can itself be undone within 30 days.
- **Rolling back past an incident has a review gate.** The reconcile re-inserts every code in `LINKS` that the shard lacks, including bad rows the incident already pushed to KV. So review must come before the reconcile:
  1. Freeze the shard, then restore it to before the incident (point-in-time recovery plus the log, or log replay alone).
  2. Write every log entry after the restore point to `ops/<op_id>/after-restore-point.ndjson.gz`, then wait with `waitForEvent('reviewed')` for up to 7 days.
  3. The Operator runs `ops review <op> --claim-only <file>`, listing the Short codes whose later rows were bad.
  4. Re-apply the later entries. Accepted rows go in as full rows. Claim-only rows go in as Deleted links with `deleted_by='operator'`, so their codes stay taken.
  5. Reconcile, then unfreeze. The reconcile now finds only codes the log never received. The report lists them.

  If no review arrives in 7 days, the step fails and the shard stays frozen.
- **Restores that fix no bad data skip the review.** These are a deleted namespace and a lost bucket.
- **Re-seeding a lost bucket:** each shard scans its `links` table in primary-key order, which is Short code order. It writes a full snapshot named by the time the scan started. The log keeps running during the scan, so the snapshot plus every minute object since that time is complete.

## Cost

Workflow steps are billed. Workers Paid includes 500,000 a month, then $0.80 per 100,000. Cloudflare says billing starts "no earlier than" 2026-08-10, and no page says it has begun. A sleep or a wait for an event counts as a step; a retry doesn't.

**Today:** $0. A takedown or a key command is a handful of steps.

**Peak** (1B Links): a full reconcile is about 256 × 4,000 = 1.02M steps. That is about $4.19 over the included amount if the month's allowance is otherwise unused, and about $8.19 if it is already spent. The parent's once-a-minute checks add about two steps a minute. Whether billing rounds up to whole 100,000s is not documented.

## Considered options

- **A Queue consumer in `links-data`, fed through Queues' HTTP API.** It needs an account-wide Queues Edit token and has no per-job status. Resuming would have to be hand-built.
- **Job files in R2, picked up by a Cron Trigger.** Everything is hand-built, and each job waits up to a minute to start.
- **The CLI runs SQL through `query/v2`.** It's the most direct route, but it bypasses the outbox and the audit record. It's kept only as break-glass.
- **Operations as approval-gated `production-admin` GitHub jobs.** The approver would be the Operator again, and CI would gain a trigger that can delete Links, which ADR 0007 avoided.
- **The Operator's broad token for everything.** It can delete Workers and remove the bucket lock, and it would leave the password manager for every routine takedown.
- **Jobs writing `LINKS` directly.** Faster, but that means two writers on the same keys, so a stale "live" write could land over a tombstone.
- **A freeze flag in the shard's own storage.** Point-in-time recovery erases it.
- **Stopping the Link API during a restore.** That halts creates on every shard to protect one.
- **Walking a removed Creator's list once, or twice with a wait.** Retries never stop, so no wait is long enough.
- **A shard index by Creator or by Target URL.** Every create would pay for an extra row write, for rare Operator work that the list and the R2 log already cover.
- **Storing the takedown reason in the shard.** It would need a schema change and would reach the change log. The audit record is enough.

## Consequences

- **Anyone with Editor on `links-data` can read and write shard SQL directly,** through `query/v2`, Data Studio or `wrangler dev --remote`. That includes `production-admin`'s token and the `operator` token. The protection is who holds those tokens, not the Worker's surface.
- **Every create does one more KV read**, of the freeze flag for its shard (cached per colo). So does every drain alarm.
- **Creates of a Custom alias or a keyed code can fail with `503`** while their shard is being restored. They reuse the Link API's existing `503 unavailable` with `Retry-After`, so the catalog is unchanged.
- **A rollback can leave a shard frozen for up to 7 days** while it waits for review.
- **The backup bucket gains `ops/`,** locked for 90 days and never retired.
- **Restore drills belong in a preview.** A preview runs the same Workflows against its own `links-data`, and its bucket has no lock.
- **Workflow limits and pricing are now a dependency:** the step limit, 30-day retention and billed steps. Pages must stay large enough that a shard's job fits the step limit as shards grow.
