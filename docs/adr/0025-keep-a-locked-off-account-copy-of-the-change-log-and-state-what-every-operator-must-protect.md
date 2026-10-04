---
status: accepted
---

> Amended by [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md): every object pushed off-account carries its signature as object metadata, and a rebuild verifies it. `offsite/` markers are signed, and an unsigned marker is ignored. The integrity heartbeat goes to Grafana, not `FLAGS`, because the `production` token can write `FLAGS`.

> Amended by [ADR 0028](./0028-void-a-forged-or-mistaken-delete-and-never-lose-a-delete-in-a-restore.md): void records are copied off-account with the dailies and snapshots, and a rebuild copies them back.

# Keep a locked off-account copy of the change log, and state what every Operator must protect: the domain and the identity roots

[ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md) accepted that "losing the whole prod account, or a compromised Operator token, can lose everything", and deferred the revisit to the first real Creator. Nothing scheduled it. Three things make it worth deciding now:

- **Suspension is a realistic loss for a shortener.** Cloudflare gives an Operator 24 hours to answer a forwarded Abuse report before it risks blocks and account suspension ([ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md)). What a suspended account can still read is not documented.
- **Every backup lives in the account it protects.** [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md) took the bucket locks out of CI's reach, but the Operator's broad token and dashboard session can still remove them.
- **The domain and the accounts everything hangs from have no stated protection.** [ADR 0013](./0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md) says the Short domain can never change, and nothing covers a registrar lock, renewal or an expiry check. The ops repo's `main` is the real gate on prod ([ADR 0015](./0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md)), and nothing says how it or the accounts behind it are hardened.

So `links-data` pushes each day's change log and `AUTH` exports to a bucket outside Cloudflare that no credential in prod, CI or the Operator's laptop can delete from. The domain gets a required lock and auto-renew, with an expiry check that runs daily. The identity roots get a 2FA rule and a ruleset on the ops repo's `main`. Each obligation is sorted by who enforces it: code, `doctor`, an alert, or the Operator's word.

Decided in [How does a deployment survive losing its Cloudflare account, its domain or an identity root?](https://github.com/andrewferk/url-shortener/issues/57).

## Decision

### What survives, and what doesn't

| Loss | Outcome |
|---|---|
| The prod Cloudflare account (suspended, closed or taken over) | The Links and Creators survive. The Operator rebuilds in a fresh account by hand, with hours to days of downtime. Up to about a day of new Links and deletions is lost. |
| A stolen credential that removes the in-account backups | The same rebuild, from the same copy. |
| The Short domain | Nothing survives. Every Short URL ever issued is dead, and whoever buys the domain answers them. Prevention is the whole defence. |
| An identity root | Whatever that account controls. The only defence is the account's own 2FA. |

- **No standby account and no failover.** A warm second deployment is outside the budget and the one-provider preference.
- **An Operator barred from Cloudflare altogether keeps the data and has no platform.** The domain core's ports ([ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)) are the way out, and no second adapter is built.

### The off-account copy

- **The target is a contract, not a provider:** any S3-compatible bucket outside Cloudflare with Object Lock in compliance mode. Backblaze B2 is the documented reference: its first 10 GB are free, and its compliance lock "cannot be removed by any user".
  - A second Cloudflare account doesn't qualify. Whether a suspension covers one account or all of a person's accounts is not documented.
- **`deployment.json` gains `offsite_backup`:** either `{ "endpoint", "region", "bucket" }` or the string `"none"`. There is no default, so an Operator states one or the other.
- **What is copied:** every daily object, every monthly snapshot, every void record ([ADR 0028](./0028-void-a-forged-or-mistaken-delete-and-never-lose-a-delete-in-a-restore.md)), and every `auth/` export. Minute objects, `ops/` audit records and review files are not.
- **`links-data` pushes.** Its compaction Cron Trigger already writes each daily and snapshot. After compaction, the same run copies every daily, snapshot, void record and `auth/` object that has no marker yet:
  1. stream the R2 object into one signed `PUT` to the target, under the same key;
  2. on success, write an empty marker object at `offsite/<key>` in the backup bucket.

  A crash between the two repeats the `PUT`, which only adds a second version. The `offsite/` prefix has no bucket lock, and a marker is retired with the object it marks.
- **Every `PUT` carries a compliance-mode retention of 90 days,** the in-account lock's length. A bucket without Object Lock rejects the request, so a misconfigured target fails loudly and can't be written to unlocked.
- **The target expires objects 120 days after upload,** by a lifecycle rule the Operator sets by hand. A new snapshot arrives every month, so the copy always holds a complete set.
- **No client-side encryption.** A lost key would lose the backup. Short URLs are public, and `auth/` holds only hashes of 256-bit keys ([ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)). The target's own encryption at rest is enough.
- **The target's bucket, lock and lifecycle rule are created by hand,** from a runbook. No OpenTofu owns them: a credential that could manage the bucket could also damage it.

### Credentials on the target

| Credential | Held by | Can |
|---|---|---|
| The target account's login | The Operator only | Everything. It is an identity root (below). |
| The write key | `links-data`, as Worker secrets `OFFSITE_KEY_ID` and `OFFSITE_SECRET`, delivered from the `production-admin` environment | Upload, and set retention on its own uploads. It cannot read, list, or delete a version. |
| A read key | Nobody, until a restore | Minted by the Operator for the restore, and deleted after it. |

- **A thief with the write key can add objects and hide files, and can remove nothing.** Hidden files keep their versions. The Operator sets a spending cap or billing alert on the target to bound added junk.
- **The write key joins ADR 0024's annual rotation,** with an expiry where the target supports one.
- **The two secret names join [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md)'s secret contract.**

### Noticing a stalled copy

- **`links-data` writes `offsite:<utc-date>` to `FLAGS`** at the end of each run in which every pending object was copied, including a run with nothing to copy. The key expires by KV's native `expiration`.
- **The Status Worker emails "Off-account copy stale"** when neither of the last two UTC days has a key. It already binds `FLAGS` (ADR 0023).
- **`doctor` probes the write key,** which the Operator supplies once when creating it: an upload with a one-day compliance retention must succeed, and deleting that version and reading it back must both be refused.

### Required before the first real Creator

- **`creators add` refuses a first real Creator** until `offsite_backup` is configured and its heartbeat is fresh. This joins [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)'s account-split check, in the same Workflow (ADR 0024).
- **`offsite_backup: "none"` opts out.** `creators add` then proceeds, and `doctor` reports "no off-account copy: accepted risk" on every run.

### Rebuilding in a fresh account

A runbook, `docs/runbooks/rebuild-in-a-fresh-account.md`:

1. Bootstrap a new Cloudflare account and its zone. Point the registrar's nameservers at it and replace the DS record.
2. Mint a read key on the target. Copy the latest snapshot, the dailies since, every void record, and the latest `auth/` export into the new backup bucket, by hand with the broad token.
3. Deploy, then run ADR 0008's "namespace deleted" restore: replay each shard from the snapshot and dailies, then re-drive `kv` and `creator`.
4. `restore` `AUTH` from the export. Creators keep their API keys.
5. Delete the read key. Create new tokens, update the ops repo's secrets and `deployment.json`, and reconfigure the push.

- **There is no reconcile.** `LINKS` is gone with the account, so nothing records the Short codes claimed since the last copied daily. Those Links answer 404, and their Short codes can be reissued. This is the second case where [ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)'s guarantee doesn't hold, after ADR 0008's last-minute case.
- **The window is about a day,** and two if one run fails.
- **Audit records and Status history are lost.** `ops/` isn't copied, and the Status database holds only rollups.

### Proving it

- **The monthly restore drill gains a seventh case.** `links-data-drill` pushes to an R2 bucket in the drill environment through R2's S3 API, the account is "lost" by deleting the Workers, `LINKS` and the drill's backup bucket, and the rebuild runs from the stand-in. The usual assertions follow, except that Links seeded after the last copy must answer 404.
- **The drill sets `object_lock: false`,** because R2's S3 API has no Object Lock. The render script refuses that setting in prod.
- **The real target is proven once by hand,** as a launch step: push, mint a read key, and restore one shard into the drill environment.

### The domain

- **Required of every Operator, in the slice 1.5 checklist:**
  - a registrar lock (`client transfer prohibited`);
  - auto-renew, with a payment method that won't lapse.
- **`doctor` reads the Short domain over RDAP,** without credentials. It fails when the lock is missing or the expiry is under 60 days away.
- **The Status Worker repeats the check daily.** `doctor` runs only when someone runs it. It emails:
  - "Short domain expires in N days", weekly under 60 days and daily under 14;
  - "Registrar lock removed", when `client transfer prohibited` disappears;
  - "Domain check blind", after seven days of failed lookups.
- **Many ccTLDs publish no RDAP server,** `.io`, `.co`, `.me`, `.de`, `.us` and `.eu` among them. For those, `doctor` says the check is unavailable, the Status Worker skips it, and both obligations rest on the Operator.
- **Keep the registrar outside the prod Cloudflare account.** This is advice in *Getting started*, not a rule, and it reverses ADR 0013's recommendation of Cloudflare Registrar:
  - a domain registered there must use Cloudflare's nameservers, and can't transfer out for 60 days after registration or a transfer;
  - what happens to it when the account is suspended is not documented;
  - so one suspension could take the data, the DNS and the domain together, leaving the off-account copy nowhere to be restored to.
- **Losing the domain has no restore.** *Getting started* and the PRD say so in those words.

### The identity roots

Six accounts: GitHub, Cloudflare, the registrar, Grafana, the alert mailbox and the off-account target. The mailbox is the recovery path for the other five.

- **2FA on all six,** as a documented obligation:
  - TOTP as the base factor, with SMS never enrolled as a factor or a recovery method;
  - a security key or passkey added wherever the provider supports one. GitHub can't be security-key-only: it requires TOTP or SMS first.
  - recovery codes kept offline.
- **`doctor` checks what an API exposes:** GitHub's and Cloudflare's `GET /user` both report whether 2FA is on. The `operator` token gains User Details Read for it. The other four print "confirm by hand".
- **The ops repo's `main` has a ruleset,** shipped as `examples/ops-repo/rulesets/main.json` and imported by hand in slice 1.5:
  - no force pushes;
  - no deletion;
  - changes arrive by pull request, with no required approvals.
- **`doctor` reads the ruleset** through GitHub's rules API, which answers without credentials on a public repo. It must be a ruleset: classic branch protection can't be read that way.
- **The ruleset guards against accidents and narrow tokens, not against a taken-over account.** One Operator can't approve their own pull request, and an admin can remove the rule. The GitHub account is protected by its 2FA alone.
- **Every reusable workflow and example caller declares a minimal top-level `permissions:` block,** and a lint in this repo's CI fails one that doesn't. An explicit block overrides the repo's default, and anything unlisted becomes none.
- **The slice 1.5 checklist also sets the repo's default `GITHUB_TOKEN` to read-only.** Reading that setting needs admin rights, so nothing checks it.

### Who enforces what

One *Operator obligations* page in the docs carries this table, linked from the slice 1.5 checklist.

| Enforced by | Items |
|---|---|
| Code | `permissions:` blocks and their lint; a push that can't delete; compliance retention on every `PUT`; `creators add`'s gate |
| `doctor` | The `main` ruleset; the registrar lock and expiry over RDAP; 2FA on GitHub and Cloudflare; the write key's reach |
| A Status Worker alert | Domain expiry; registrar lock removed; off-account copy stale |
| The Operator's word | Auto-renew and its payment method; a registrar outside the prod account; 2FA on the registrar, Grafana, the mailbox and the target; no SMS; the target's lifecycle rule and spending cap; the read-only default `GITHUB_TOKEN` |

## Cost

**Today:** $0. The copy fits B2's free 10 GB, B2 doesn't charge for uploads, and R2 doesn't charge egress. One RDAP lookup a day is free.

**Peak** (1B Links): about 0.7 TB on the target, which is four snapshots and 120 days of dailies: about $5/mo at B2's $6.95 per TB.

## Considered options

- **Re-accepting the risk.** Honest and free, but suspension over abusive Links is the likeliest way a shortener dies, and the fix costs nothing today.
- **A standby account kept warm.** Far outside $20/mo, and it doubles every operation.
- **Naming one provider.** It would put a deployment value in the spec for no saving: B2 and S3 speak the same API.
- **A second Cloudflare account,** such as the preview account. No new provider, but it may fall to the same suspension, and previews run pull-request code there.
- **A scheduled GitHub job that pulls.** No Worker code, but it puts an R2 read credential in GitHub, public-repo schedules stop after 60 days without activity, and [ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md) keeps prod operations out of Actions.
- **The Operator's laptop, by hand or cron.** It would be skipped.
- **Copying minute objects.** It cuts the loss to minutes, but multiplies uploads and needs a run every minute.
- **Copying `ops/` audit records.** They are never retired, so they'd need a second retention rule on the target, and they keep taken-down Target URLs.
- **Keeping the copy forever.** It would break [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md)'s erasure.
- **Client-side encryption.** One more secret that, once lost, makes the backup worthless.
- **Drilling against the real target.** It puts a read key for the off-account copy in CI and leaves locked drill objects behind.
- **Forbidding Cloudflare Registrar.** Tooling can't know why an Operator chose a registrar, and a domain already there can't move for 60 days.
- **Required reviews on the ops repo's `main`.** Impossible for one Operator.
- **Requiring security-key-only 2FA.** GitHub doesn't offer it, and whether Cloudflare does is not documented.

## Consequences

- **Reverses ADR 0008's accepted risk.** Losing the prod account, or every in-account backup, no longer loses everything. `FLAGS` gains `offsite:<utc-date>`, and the bucket gains an unlocked `offsite/` prefix of markers.
- **Amends ADR 0007:** `creators add` also checks the off-account copy.
- **Amends [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md):** four new Status Worker emails: off-account copy stale, Short domain expiring, registrar lock removed, and domain check blind.
- **Amends ADR 0013:** a registrar lock and auto-renew are required; the advice on Cloudflare Registrar is reversed; the Status Worker looks the domain up daily.
- **Amends ADR 0015:** the ops repo's `main` carries a ruleset from `examples/ops-repo/`, and every workflow declares `permissions:`.
- **Amends ADR 0016:** `deployment.json` gains `offsite_backup`; the secret contract gains `OFFSITE_KEY_ID` and `OFFSITE_SECRET`; the drill gains a seventh case; `doctor` gains the checks above.
- **Amends ADR 0019:** a deleted Link's Target URL leaves every copy in about four months, not three, counting the off-account copy.
- **Amends ADR 0024:** the `operator` token gains User Details Read, and the write key joins the annual rotation.
- **A deployment now depends on a second provider** for durability, though not for serving.
- **`links-data` gains an S3 request signer.** At peak a snapshot is under 2 GB per shard, inside a single `PUT`'s 5 GB limit. Past that, the push needs multipart upload.
- **Milestones:** a new slice 6.6 carries the push, the markers, the heartbeat and its alert, the drill case and the rebuild runbook. Slice 7.3's human steps gain creating the target and proving one real restore. Slice 1.5's checklist gains the domain and identity obligations, and the Status slice that ships alerts gains the domain check.
- **New `doctor` checks or early spikes,** for facts nobody documents:
  - whether S3 credentials derived from the `preview` token work for the drill's stand-in bucket (the fallback is a dedicated R2 key in `preview`);
  - whether Cloudflare's `GET /user` reports 2FA to a token with User Details Read;
  - whether the target accepts a compliance retention set by a key that can't read.
