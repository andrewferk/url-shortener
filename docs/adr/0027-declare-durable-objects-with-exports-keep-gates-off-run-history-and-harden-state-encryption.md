---
status: accepted
---

> Amended by [ADR 0031](./0031-touch-shards-through-a-workflow-tag-links-data-with-its-bundle-hash-and-state-the-case-insensitive-limit.md): a Worker with `exports` keeps `--tag`; `links-data` is tagged with its bundle hash. What `exports` rules out is restated as documented and partly contradicted by Wrangler's source, to be settled by a spike.

# Declare the Durable Objects with `exports`, keep delivery's gates off run history, make the state passphrase random and enforced, show approvers values, and pin OpenTofu 1.13

Six parts of [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md) and [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md) no longer match what Cloudflare, GitHub and OpenTofu document:

- **Cloudflare tells new Workers to use `exports`.** "For new Workers, use the declarative `exports` field instead of the `migrations` array." The guard ADR 0007 relies on, a class delete refused while another Worker binds to it, is documented only for `exports`.
- **GitHub's retention setting now deletes history.** Since 2026-10-01 it removes workflow runs, checks and commit statuses, not only logs and artifacts: after 90 days at most on a public repo, and after 30 in an ops repo as ADR 0016 sets it. The teardown's `find` job, the release gate and the `preview` status all read that history.
- **Encrypted plans are public downloads.** An ops repo is public, so anyone can download a plan artifact and attack its passphrase offline. The design sets no strength for the passphrase, omits `enforced` and has no rotation procedure.
- **An approval shows no values.** An apex DNS change reads "update in place".
- **OpenTofu 1.12.x support ends 2027-02-01.**
- **Read-only planning is documented by nobody.** Neither vendor describes `tofu plan -lock=false` with a read-only R2 key.

Nothing is built yet, so each is changed now.

Decided in [How does delivery change: Durable Object `exports`, retention-proof gates, state encryption and OpenTofu version?](https://github.com/andrewferk/url-shortener/issues/58). Facts are from [Which Cloudflare platform facts in the ADRs have gone stale?](https://github.com/andrewferk/url-shortener/issues/45) and [Do ADR 0016's GitHub Actions and OpenTofu assumptions hold?](https://github.com/andrewferk/url-shortener/issues/46), plus one check made for this ticket (2026-10-03): GitHub's retention docs and both changelog posts name checks, workflow runs, commit statuses, artifacts and logs, and say nothing about deployment records.

## Decision

### `links-data` declares its Durable Objects with `exports`

- **From its first deploy,** `links-data` declares the shard and Creator classes in `exports`, not in a `migrations` array. Its `wrangler.base.jsonc` holds them, and the render script passes them through.
- **The switch is one-way,** which is why it is made before anything is deployed: "Once a Worker has been deployed with `exports`, subsequent deploys cannot return to the legacy `migrations` array."
- **What it costs falls only on `links-data`.** One Cloudflare docs page says `wrangler versions upload` fails on a config with `exports` entries and that gradual deployments aren't supported with them; Wrangler's changelog and source contradict the first, and rollback is documented as blocked only across a lifecycle change. A spike settles it ([ADR 0031](./0031-touch-shards-through-a-workflow-tag-links-data-with-its-bundle-hash-and-state-the-case-insensitive-limit.md)), and nothing here depends on the answer: ADR 0016 already deploys `links-data` with `wrangler deploy`, never rolls it back and rejected gradual rollout. `links-data` keeps `--tag`, which `wrangler deploy` sets on either upload path. `redirect` and `status` declare no classes, so they keep versions and `wrangler rollback` whatever the spike finds.
- **The class-delete guard is now a documented one:** removing a class another Worker binds to is rejected with `tombstone_delete_blocked_by_external_bindings`.
- **The other guard is still inferred.** That a non-forced delete of the whole Worker is refused while `redirect` binds to it follows only from the API's `force` parameter. The restore drill already deletes `redirect-drill` and then `links-data-drill`; it now first tries to delete `links-data-drill` while `redirect-drill` binds to it, and fails the drill if Cloudflare allows it.

### Delivery's gates stop reading run history

**Previews are found through deployment records, not runs.**

- **Each preview run writes a GitHub deployment record in the ops repo** before it applies anything, and sets its status as it goes. The records share one environment name, `previews`, with `auto_inactive` off; the payload carries the pull request number and head SHA. Teardown marks a preview's records `inactive`.
- **The `find` job reads those records with `GITHUB_TOKEN`,** so it still holds no secret. A preview to remove is an active record whose pull request is closed, whose newest record is 7 days old, or whose last status is a failure. The cap of 5 live previews counts active records.
- **The backstop is the account itself.** In the single-account phase, the hourly integrity job ([ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md)) lists Workers named `<name>-pr-<n>` and fails when one has no active record. After the account split `preview` needs no approval, so `find` runs there and lists the preview account's Workers itself.
- **Whether a deployment record outlives its run is not documented.** `doctor` reads a record older than the retention period where one exists, and an early spike sets a test repo's retention to 1 day. If records are deleted too, `find` falls back to listing the `env/pr-*` state keys, and the backstop already covers the gap.

**The release gate runs CI itself.** `release.yml` calls this repo's CI workflow (`workflow_call`) on the commit it is about to tag, and tags only if it passes. It no longer reads checks left on `main`.

**The `preview` commit status is perishable, and that is accepted.** It is advice to a reviewer, never a required check, and the preview behind it is torn down after 7 days.

**Retention settings:** 90 days in this repo, the maximum for a public repo. The ops repo stays at 30 days, since nothing reads its history any more.

### State encryption

- **One passphrase per bucket stays.** `production-plan` must read both prod states, so a passphrase per state would isolate nothing. OpenTofu's "a key per state" advice is written for key management systems.
- **The passphrase is random, not chosen:** `openssl rand -base64 32`, 256 bits. Against that, offline cracking of a downloaded plan is not a threat, whatever the `pbkdf2` settings. Every job that uses a passphrase fails if it is shorter than 32 characters.
- **`enforced = true` on `state` and `plan`,** in the `encryption` block each root commits. Only the passphrases come from the environment, so a job that loses its secret fails instead of writing plaintext.
- **The hand-applied states follow the same rules:** the Grafana Synthetic Monitoring installation ([ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md)) and prod's backup bucket configuration ([ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md)).
- **Plans stay 1-day encrypted artifacts.** Moving them to a private bucket would give the unattended plan job a write key, for no gain once the passphrase is random.

**Rotation is by event, not by calendar.** Rotating can't protect ciphertext someone already downloaded, so there is no yearly roll as there is for tokens. The Operator rotates on a suspected exposure or when someone who held the passphrase no longer should. `docs/runbooks/state-passphrase-rotation.md` carries it:

1. In each prod environment, move the current value to a new optional secret, `STATE_PASSPHRASE_PREVIOUS`, and set a fresh `STATE_PASSPHRASE`. Store both in the password manager. When the previous secret is present, the workflows configure it as the `fallback` method: reads try both, and writes always use the new one.
2. Dispatch `deploy.yml` with `reencrypt`. The `admin` and `prod` jobs then rewrite their states even when nothing is pending, behind the usual one approval.
3. Once the integrity job plans cleanly, delete `STATE_PASSPHRASE_PREVIOUS`.

- The Operator re-encrypts the hand-applied states from their machine in the same way.
- A preview bucket is rotated by tearing down every preview and swapping the secret.
- If a secret had slipped into state, it is rolled as well; rotation alone doesn't un-leak it.
- OpenTofu documents `fallback` only in general terms and doesn't say which command rewrites an unchanged state. An early spike settles the command before the runbook is written.

### What an approver sees

- **The plan summary prints values.** For every update, replacement and delete, it shows each changed attribute before and after. Attributes OpenTofu marks sensitive are masked, and long values are truncated. Creates stay as address and action.
- **It covers both roots,** though only `env/prod` waits for an approval: the zone plan is applied unattended, and its summary is the record of what changed.
- **Nothing in it is secret.** State holds no secrets (ADR 0007), and the values are the deployment's own DNS records, rules and IDs, in a repo that already publishes its `deployment.json`.
- The plan is still never printed to the log, and the encrypted artifact is still what gets applied.

### OpenTofu 1.13

- **`v0.1.0` pins 1.13.x:** `required_version = "~> 1.13.0"` in every root, and the exact patch in the workflows. 1.13 is supported until 2027-08-01 and changes nothing in the S3 backend or `pbkdf2`.
- **A move to the next minor is a release of this repo** with an **Upgrading** note, made at least two months before the pinned minor's support ends.

### Read-only planning and locking

- **`production-plan` keeps its read-only R2 key and `-lock=false`.** An early spike in the walking skeleton proves it, and `doctor` checks it at bootstrap.
- **If it fails, `production-plan` takes a read-write key on the state bucket.** That adds little: the unattended `production` environment already holds one on the same bucket, because it applies the zone. The plan job still never applies.
- **`use_lockfile` stays,** behind the concurrency groups, which are the first guard. Only applying jobs take the lock, with `-lock-timeout=5m`.
- **An orphaned lock is a runbook entry.** A plan on R2 has left its own lock behind before (opentofu#4405), and a read-only key can't clear one. The entry is `tofu force-unlock` from the Operator's machine. The spike also applies under contention.

## Cost

**$0.** Deployment records, the summary and the spikes cost nothing. The orphan check adds one Workers list call to the hourly integrity job.

## Considered options

- **Stay on `migrations`.** It is still supported for existing Workers. Rejected: the guard the design names is undocumented for it, Cloudflare steers new Workers away from it, and the only time the choice is free is before the first deploy.
- **Raise the ops repo's retention to 90 days and keep reading runs.** It only moves the cliff: a preview whose teardown keeps failing, or whose schedule GitHub disabled, still drops out of sight.
- **A deployment environment per preview (`pr-<n>`).** GitHub would then mark superseded records inactive by itself. Rejected: it leaves a GitHub environment behind for every pull request ever previewed, and only a repo admin can delete one.
- **Listing state keys as the registry.** It needs an R2 key in the `find` job. Kept as the fallback.
- **Making `preview` a required check, or re-posting it on a schedule.** A required check that can vanish blocks merges for no reason.
- **A passphrase per state.** No isolation while one environment must read both.
- **Storing plans in R2 instead of as artifacts.** A write key for the unattended plan job, to hide ciphertext that a random passphrase already protects.
- **Yearly passphrase rotation.** It protects nothing already downloaded and risks a lost state each time.
- **Printing the whole plan.** Creates are long and say little. The diff of what changes is what an approval needs.
- **Staying on 1.12.x.** Its support ends within months of `v0.1.0`.
- **Dropping `use_lockfile` for concurrency groups alone.** The groups don't cover an apply from the Operator's machine.

## Consequences

- **Amends ADR 0007:**
  - Durable Objects use `exports`, not tagged `migrations`. Of the two guards it names, the class-delete one is documented and the Worker-delete one is asserted by the restore drill.
  - OpenTofu is pinned to 1.13.x.
  - The passphrase is 32 random bytes, and `enforced` is set on state and plan.
- **Amends ADR 0016:**
  - `wrangler.base.jsonc` carries `exports` in place of classes and migrations.
  - Previews write deployment records; `find`, the cap of 5 and the 7-day rule read them, not runs.
  - `release.yml` runs CI before tagging.
  - Plan summaries show before and after values.
  - The secret contract gains the optional `STATE_PASSPHRASE_PREVIOUS`, and `deploy.yml` gains a `reencrypt` input.
  - The restore drill's third case first asserts that deleting a bound `links-data-drill` is refused.
- **Amends ADR 0026:** the hourly integrity job also fails on a preview Worker with no active deployment record, in the single-account phase.
- **Amends ADRs 0021 and 0024:** their hand-applied states use a random passphrase and `enforced`.
- **`links-data` can never use gradual deployments or `wrangler versions upload`.** A future wish to roll shard code out gradually would need a new Worker.
- **Preview runs need `deployments: write`** on the ops repo's `GITHUB_TOKEN`, and the `find` job `deployments: read`.
- **New spikes and `doctor` checks:** read-only planning; R2 locking under contention; which command re-encrypts an unchanged state; whether deployment records outlive retention; the refused delete of a bound Worker.
