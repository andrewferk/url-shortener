---
status: accepted
---

> Amended by [ADR 0032](./0032-decide-what-six-unverified-facts-do-if-they-fail-and-run-the-cross-account-secrets-spike-first.md): if `audit-read` can't read Audit Logs v1 under any permission, the hourly integrity job lists Email Routing rules and addresses, and that listing reports an added one.

# List rulesets and routes hourly, move the off-account heartbeat to Grafana, take Email Routing off the `production` token, and check the backup bucket's location hint

The 2026-10-04 audit found four gaps in what detects a change made with a stolen or misused credential, and in what a credential can reach:

- **The hourly plan can't see what isn't declared.** [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md) relies on it to catch a hijack by redirect rule or moved route. A plan compares configuration with the state of managed objects, so a rule added in a ruleset phase that `infra/zone` doesn't declare shows nothing. Workers Routes are worse off: Wrangler owns them ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)), so no plan sees any of them.
- **The off-account heartbeat could be faked.** [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md) had `links-data` write `offsite:<utc-date>` to `FLAGS`, read by the Status Worker and by `creators add`. The `production` token can write `FLAGS` and replace `status`, which is why ADR 0026 sent its own heartbeat to Grafana.
- **The Email Routing claim was overstated.** ADR 0026 said a stolen token "can break the email path but can't quietly redirect it". A rule's action can be a Worker instead of a forward, and any address already verified on the account is a valid target. Whether a token can also verify an address of its own is undetermined.
- **Nothing checked the backup bucket's location hint.** [ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md) has `infra/env` record each hint and the `plan` job fail on a change. [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md) then moved prod's backup bucket to a hand-applied configuration and said nothing about the hint.

Decided in [Settle the audit's detection and credential gaps](https://github.com/andrewferk/url-shortener/issues/79). Facts are from [Confirm the Cloudflare and Wrangler behaviour three audit gaps rest on](https://github.com/andrewferk/url-shortener/issues/77), which read documentation and source and ran nothing against an account.

## Decision

### The hourly integrity job lists rulesets and routes

- **The job lists every ruleset on the zone,** in every phase (`GET /zones/{zone_id}/rulesets`), and fails on a zone-level ruleset that the `infra/zone` state doesn't hold. Cloudflare's own managed rulesets are ignored.
  - The rules inside a declared ruleset stay the plan's to check.
  - A phase Cloudflare adds later needs no change here.
- **The job lists every Workers Route on the zone** (`GET /zones/{zone_id}/workers/routes`). A route passes only if it is one of:
  - an exact (pattern, Worker) pair from prod's rendered configuration ([ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md));
  - in the single-account phase, a pattern that matches ADR 0007's preview hostname template for a preview with an active deployment record ([ADR 0027](./0027-declare-durable-objects-with-exports-keep-gates-off-run-history-and-harden-state-encryption.md)), pointing at that preview's own Worker.

  Any other route fails the job. The preview case ends at the account split.
- **The listing covers what the unattended `production` token can create,** and nothing else. Today that is zone rulesets and Workers Routes.
  - Page Rules, Snippets, Workers Custom Domains and account-level Bulk Redirects are left out because that token holds no permission for them. `production-admin` runs only under approval.
  - **A permission added to `production` brings its object type into the listing,** in the same change.
  - DNS records follow the same rule. ADR 0007's table gives `production` no DNS permission, though `infra/zone` holds the DNS records that belong to no environment. If the token needs DNS edit to apply them, the job also lists the zone's DNS records and fails on one that no state holds.
- **`production-plan` gains Workers Routes Read.**
- **`doctor` checks that the `production-plan` token lists rulesets in every phase.** If one permission doesn't cover a phase, the token gains that phase's read permission. If no read permission covers it, `infra/zone` declares that phase's ruleset empty.

### The off-account heartbeat goes to Grafana

- **The hourly heartbeat `links-data` already pushes (ADR 0026) also carries the time of the last complete off-account copy.**
- **A fifth Grafana rule we own, "Off-account copy stale",** fires when that time is more than two days old. It joins [ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md)'s rule group and follows `probes_enabled`, as the Status Worker's email did. It isn't created when `offsite_backup` is `"none"`.
- **`links-data` keeps a signed record of its last complete copy run** at `offsite/last-complete` in the backup bucket, overwritten at the end of each run in which every pending object was copied, including a run with nothing to copy. The heartbeat reads its time from this record.
- **`creators add` reads that record,** in the Workflow it already runs in. It refuses a first real Creator when the record is missing, unsigned, wrongly signed or more than two UTC days old.
- **`offsite:<utc-date>` leaves `FLAGS`, and the Status Worker's "Off-account copy stale" email is dropped.**
- **A stopped `links-data` is already covered:** "Integrity checks stale or failing" fires after three hours without a heartbeat.

### Email Routing leaves the pipeline

- **Email Routing on the zone, the Operator's destination address and the `abuse@` rule move to a hand-applied OpenTofu configuration in `infra/bootstrap`,** applied with the broad token, as ADR 0024 did for the backup bucket.
  - It is its own configuration with its own key in the prod state bucket, encrypted with the prod passphrase. Applying it never plans the bucket's configuration.
  - Only prod's zone gets it. Alerts and `abuse@` are prod only, so a preview zone after the account split has no Email Routing.
- **The `production` token drops both Email Routing permissions,** the zone's rules and the account's destination addresses. No credential in GitHub can then change where mail to the Short domain goes.
- **`production-plan` keeps Email Routing read** and plans this configuration, in the pull request's `plan` job and in the hourly integrity job.
- **`doctor` checks that `production` can still deploy `status` with its `send_email` binding.** If it can't, the token takes Email Routing Addresses Read and nothing more.
- **The claim becomes:** no unattended credential can change Email Routing. The broad token and a dashboard session can add a rule that sends `abuse@` to a Worker or to any address verified on the account. The audit watch's Audit Logs v1 line ([ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md), ADR 0026) reports an added rule or address, and the hourly plan reports a changed one. If no account-owned token can read Audit Logs v1, the hourly integrity job lists the zone's Email Routing rules and destination addresses and fails on one this configuration doesn't declare, so an added one is reported within the hour ([ADR 0032](./0032-decide-what-six-unverified-facts-do-if-they-fail-and-run-the-cross-account-secrets-spike-first.md)).
- **Two spikes the research left are closed without running.** Whether the verification link works without a Cloudflare login, and whether a token can set an address's status to verified, no longer decide anything. Whether Audit Logs v2 records Email Routing changes is already one of ADR 0016's `doctor` checks.

### The backup bucket takes the location hint, and both plan jobs check it

- **The hand-applied backup bucket configuration takes `location_hints.r2`** from `deployment.json` and records it in its own state the first time it is applied, as `infra/env` does. An omitted hint is recorded as omitted.
- **The pull request's `plan` job plans this configuration too,** not only the hourly integrity job. A changed hint fails the plan before merge.
- **The bucket carries `prevent_destroy`,** so a replacement can't be applied by mistake, whatever the provider would propose.
- **The state buckets go unchecked, and that is accepted.** The bootstrap checklist creates them with the hint, and no state records it. They hold OpenTofu state, which the configuration and the live account can rebuild.
- **`doctor` reports each R2 bucket's actual location beside the hint,** as information. A hint is a request, and Cloudflare may place a bucket elsewhere.

### When

- **Slice 1.4** (the schema file and the `plan` job): the `plan` job also plans the hand-applied configurations once they exist.
- **Slice 2.3** (the hourly integrity job): the ruleset and route listings; Workers Routes Read on `production-plan`; `doctor`'s every-phase check.
- **Slice 4.4** (alerts): the Email Routing configuration in `infra/bootstrap`, applied by hand; `doctor`'s `send_email` deploy check.
- **Slice 6.1** (the backup bucket): the hint, its recorded value and `prevent_destroy`; `doctor`'s location report.
- **Slice 6.6** (the off-account copy): the `offsite/last-complete` record, and `creators add` reading it.
- **Slice 6.8** (integrity checks): the heartbeat's copy time and the fifth Grafana rule.

No slice moves between milestones.

## Cost

**$0.** Two list calls an hour, one more value on a heartbeat series that already exists, and one more Grafana rule. Email Routing costs the Operator one more hand-applied configuration, changed about as often as the alert address.

## Considered options

- **Declare every phase's ruleset, empty where unused.** The plan then needs no new step. Rejected because a phase Cloudflare adds later is undeclared again, it does nothing for routes, and whether an empty declared ruleset applies cleanly and shows an added rule as drift was never tested. It survives as the fallback for a phase the token can't list.
- **List every object type a plan can miss:** Page Rules, Snippets, Custom Domains, Bulk Redirects, DNS records. Each is a call and a permission on `production-plan`, to detect something the unattended token can't do.
- **Derive the off-account heartbeat in the Status Worker from the signed `offsite/` markers.** The Status Worker has no signing key to verify them with, and the stolen token can replace `status` anyway.
- **Accept the fakeable heartbeat and say so.** Defensible: faking it only hides a copy that stalled for another reason, since the token can't stop `links-data`. Rejected because the fix reuses a heartbeat and a rule group that already exist, and ADR 0026 had already refused this design for its own heartbeat.
- **Keep Email Routing on `production` and list rules and addresses hourly.** It detects within the hour what the move prevents outright, for resources that almost never change.
- **Fold Email Routing into the backup bucket's configuration.** One fewer state key, but changing the alert address would then plan the locked bucket.
- **Check the state buckets' hint with a recorded value of their own.** It needs a state for the buckets that hold the state.

## Consequences

- **Amends ADR 0026:** the zone check is the plan plus the two listings; the Email Routing claim is restated; the heartbeat carries the off-account copy's time, and a fifth Grafana rule reads it.
- **Amends ADR 0025:** `offsite:<utc-date>` and the Status Worker's stale-copy email are gone; `offsite/last-complete` and the Grafana rule replace them; `creators add` reads the signed record.
- **Amends ADR 0024:** the backup bucket configuration takes the R2 hint and `prevent_destroy`, and the `plan` job plans it; Email Routing is a second hand-applied configuration; `production` loses Email Routing, and `production-plan` gains Workers Routes Read.
- **Amends ADR 0017:** the backup bucket's hint is recorded and checked by its own configuration; the state buckets' hint is unchecked.
- **Amends ADR 0007 and [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md):** `infra/zone` no longer owns Email Routing, and `production` holds no Email Routing permission.
- **Amends ADR 0016:** the hourly job's two listings; the `plan` job plans the hand-applied configurations.
- **Amends ADR 0021:** a fifth rule in the group.
- **Amends [ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md), [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md), [ADR 0013](./0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md) and [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md):** the Status Worker no longer reads `offsite:<utc-date>`, `FLAGS` no longer holds it, and the `abuse@` rule lives in the hand-applied configuration.
- **Changing the alert address or the `abuse@` rule is now a hand apply,** not a merge.
- **A break-glass route or ruleset added by hand fails the hourly job** until it is declared or removed. That is intended, as it is for a break-glass deploy (ADR 0026).
- **The off-account alert now depends on Grafana,** not on the Status Worker. With `probes_enabled` off there is none, as before.
- **Whether `production` holds a DNS permission is not stated by ADR 0007's table.** The listing rule above covers either answer.
