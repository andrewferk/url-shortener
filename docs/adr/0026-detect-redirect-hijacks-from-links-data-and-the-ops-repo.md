---
status: accepted
---

> Amended by [ADR 0027](./0027-declare-durable-objects-with-exports-keep-gates-off-run-history-and-harden-state-encryption.md): in the single-account phase the hourly integrity job also lists preview Workers and fails when one has no active deployment record.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the signing key's rotation gets a trigger, by event. The findings email is tied to ADR 0011's no-links rule.

# Detect Redirect hijacks from `links-data` and the ops repo: sweep `LINKS` against the shards, sign the change log, and compare the live zone and Workers with `main` every hour

Rewriting where Short URLs go is the highest-value attack on a shortener, and nothing in the design would notice it. [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md) says the unattended `production` token can answer Visitors anything and rewrite `LINKS`, and that recovery "depends on someone noticing within the window". [ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md)'s watch covers resources, not data, and skips Worker deploys, routes and Email Routing.

Three facts shape the answer:

- **The watch sits inside the blast radius.** The `production` token deploys `status` as well as `redirect`, and edits Workers Routes, rulesets, zone settings and Email Routing ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md), [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)). A stolen token can replace the audit watch along with the Redirect code.
- **Reporting by actor misses the main case.** "Report deploys by anyone except the expected CI token" is silent when the stolen token *is* the expected CI token.
- **A redirect rule acts whatever the Worker does.** "Requests handled by Workers … will not suppress actions from modern Rules features." So a hijack needs no Worker deploy at all.

So no hijack check lives only in a Worker the `production` token deploys. The data checks run in `links-data`, whose deploys are approved. The code and zone checks run in the ops repo, which a Cloudflare token can't write to. A heartbeat in Grafana watches the checks themselves.

Decided in [How is a silent Redirect hijack detected?](https://github.com/andrewferk/url-shortener/issues/56). Facts are from [What can Cloudflare tokens, Worker bindings and audit logs each be narrowed to or see?](https://github.com/andrewferk/url-shortener/issues/42), [Which Cloudflare platform facts in the ADRs have gone stale?](https://github.com/andrewferk/url-shortener/issues/45) and a fact check made for this ticket (2026-10-03, Cloudflare's docs and OpenAPI schema, nothing tested live).

## Decision

### Which attacker detection must survive

- **Designed for:** data tampering by any credential or bug, and a stolen `production` token, which can ship a malicious `redirect` and `status` and change the zone.
- **Accepted:** anyone holding `production-admin`, the `operator` token or the Operator's dashboard session. They can rewrite the shards themselves, so no honest copy is left to compare against.

### `LINKS` is swept against the shards

- **A Cron Trigger on `links-data` sweeps every shard** once per `integrity_sweep_hours` (24), a few shards per hourly run. For each shard it lists the shard's `LINKS` prefix ([ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md)) and compares every value with its shard row, both ways.
- **A row whose value is wrong or missing** is tampering or a stuck outbox. The sweep alerts and heals it by re-driving the row through the outbox. The shard is the truth, and this is what a reconcile does.
- **A `LINKS` key with no shard row** is a forged Link. The sweep alerts and leaves the key alone: after a restore, such a key is a claimed Short code the reconcile must keep (ADR 0008), so only the Operator can tell the two apart.
- **A frozen shard is skipped** ([ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md)).
- **`LINKS` only.** `AUTH` and `FLAGS` are not swept. Tampering there does not re-point a Short URL, and ADR 0024's runbook diffs and restores them.

### The change log is checked and signed

- **Compaction checks [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md)'s invariant** as it merges. On a violation it alerts, stops that shard's compaction and keeps every object involved. A stuck compaction loses nothing (ADR 0008), and merging a tampered entry would launder it into a daily object.
- **Compaction resumes through an Operator operation** that names the objects to drop or keep, with an `ops/` audit record like any other (ADR 0010).
- **`links-data` signs every object it writes to the backup bucket:** minute objects, dailies, snapshots, `auth/` exports, `ops/` records and [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md)'s `offsite/` markers.
  - The signature is HMAC-SHA-256 over the object's key and body, stored with a key ID in the object's custom metadata. Signing the key stops a genuine object being copied to another name.
  - The signing key is a `links-data` Worker secret, set by hand at bootstrap and kept in the password manager. It is never in GitHub, and deploys leave it in place.
  - **Compaction and restores skip an object that is unsigned or wrongly signed,** and alert. This closes what the invariant can't: a forged *delete*, which wins the merge, and a forged new Link.
  - **An unsigned `offsite/` marker is ignored,** so a forged marker can't stop an object being copied off-account.
  - **The signature travels with the object to the off-account copy,** as object metadata on the `PUT`, and a rebuild in a fresh account verifies it.
  - Rotation adds a key under a new ID; old keys stay for verifying. It is by event, not by calendar, like the state passphrase (ADR 0027): the Operator rotates on a suspected exposure of the key, which includes any `links-data` deploy they don't trust, since the Worker can read its own secrets. A restore without the key needs an explicit override, recorded in its audit record.

### Deletes are counted

- **The same cron counts Creator deletes** across the shards for the last hour and alerts above `delete_alert_per_hour` (300, one Creator's whole daily cap). ADR 0024 lets the stolen token mint a key and delete Links as any Creator, and every delete passes through a shard.
- **Takedowns are not counted.** They already write `ops/` records, and [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md)'s daily-ceiling Takedowns are expected bursts.
- **Alert only.** Deletes are recoverable for 30 days, and pausing deletes would give an attacker a way to block real Creators.

### The ops repo compares the live deployment with `main` every hour

[ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md)'s weekly drift job becomes an hourly integrity job (`drift_schedule`), still in `production-plan` with its read-only token. It fails, and GitHub emails the Operator, when either check finds a difference.

- **The zone.** The drift plan runs as before. It catches a redirect rule, a moved route, a changed zone setting or a re-pointed Email Routing rule, whoever made the change.
- **The Workers.** Every deploy run ends by writing the version IDs live for `redirect`, `status` and `links-data` to a GitHub deployment record, after any rollback. The hourly job lists each Worker's live deployment and fails if a live version isn't the recorded one.
  - Any deploy, secret change or binding change makes a new version ID.
  - Version annotations such as `workers/tag` are set by whoever deploys and are not trusted.
  - A break-glass deploy from the Operator's laptop fails the job until the next CI deploy. That is intended.
- **A private ops repo pays Actions minutes for this;** a public one doesn't.
- **GitHub stops scheduled workflows on a public repo after 60 days without activity** (ADR 0025). `doctor` checks that the job is enabled and ran within the last two hours.
- **ADR 0012's watch still doesn't report rulesets, routes or Worker deploys.** They are noise on every merge, and the stolen token is the expected actor.

### Alerts and the heartbeat

- **`links-data` emails the Operator itself,** through its own `send_email` binding restricted to the Operator's verified address. One email per finding kind per run, with the Short URLs or object keys involved. They are identifiers to look up, not links to follow: no email a Worker sends carries a link ([ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)).
- **After each hourly run `links-data` pushes a heartbeat to Grafana:** the time of the run and its count of findings, over Grafana Cloud's HTTPS push endpoint with a write token held as a Worker secret.
- **A fourth Grafana rule we own, "Integrity checks stale or failing",** joins [ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md)'s three. It fires when no heartbeat has arrived for three hours or the last one reports findings. It also answers ADR 0008's "compaction must be monitored".
- **Prod only,** following `probes_enabled`.
- **Email Routing forwards only to a verified address,** so a stolen token can break the email path but can't quietly redirect it. The heartbeat and the hourly job cover a broken path.

### The audit watch stays in the Status Worker

- A malicious `status` deploy is caught by the hourly job, so the watch keeps its place, its D1 state and its alert pattern.
- **It also polls Audit Logs v1** for what only v1 documents: Data Studio SQL against `links-data` and Email Routing rule and address changes. Each is a "was this you?" line in the digest.
- **No Logpush.** It is self-service on Free now, but it adds a job and a bucket the same attacker can delete, alerts on nothing, and the audit dataset on Free is unconfirmed.

### Certificates

- **`infra/zone` publishes no CAA records.** [ADR 0013](./0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md) named Universal SSL's authorities by hand, but Cloudflare changes authority without notice and adds its own records only when the zone already has one. A stale record can block a renewal; whether a minimal record still restricts issuance is untested.
- **Certificate Transparency Monitoring is turned on at bootstrap,** by hand: it has no OpenTofu resource. The Operator is emailed when any certificate is issued for the Short domain. Mis-issuance is detected, not prevented.

### Parameters

| Variable | Default |
|---|---|
| `integrity_sweep_hours` | 24 |
| `delete_alert_per_hour` | 300 |
| `drift_schedule` | hourly |
| `integrity_stale_after_hours` | 3 |

### New `doctor` checks

- Whether Metadata Read-Only can list a Worker's deployments. If not, `production-plan` takes Workers Scripts Read back.
- Whether `audit-read` can read Audit Logs v1, and whether v2 or v1 records SQL through `query/v2`.
- Whether a deploy with `--secrets-file` leaves the signing key in place.
- That Certificate Transparency Monitoring is on, and whether its recipients can be set on Free.
- That the hourly integrity job is enabled and ran within the last two hours.

## Accepted gaps

1. Anyone holding `production-admin`, the `operator` token or the Operator's dashboard session.
2. SQL through the `query/v2` API, unless `doctor` shows it is logged.
3. A rewritten `LINKS` value serving for up to one sweep period.
4. A malicious Worker or zone rule serving for up to an hour, plus GitHub's schedule lag.
5. A mis-issued certificate is detected, not prevented.
6. A compromised ops repo or GitHub account, which belongs to [How does a deployment survive losing its Cloudflare account, its domain or an identity root?](https://github.com/andrewferk/url-shortener/issues/57).

## Cost

- **The sweep is one KV read per Link per sweep** (a list returns names only). It fits Workers Paid's included 10M reads a month for a small deployment. At 1B Links one sweep is about $500, so the period is an input that stretches as Links grow.
- **Everything else is $0:** the heartbeat is one series on Grafana's free tier, Email Routing and Certificate Transparency Monitoring are free, and the hourly job is free on a public ops repo.

## Considered options

- **Sample KV hits inside `redirect` against the shard.** It weights by traffic, but it runs in the Worker the stolen token replaces, and every sample is a shard lookup against the brake's 125,000 an hour ([ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md)).
- **A traffic-weighted pass beside the sweep,** checking recently redirected Short codes more often. It gives `links-data` an Analytics Engine token to shorten a gap the sweep period already bounds.
- **Check the invariant and merge anyway.** The alert would arrive after the tampered entry was already in a daily object.
- **A manifest in each shard of the objects it wrote,** in place of signatures. It is lost in exactly the case the log exists for: rebuilding lost shards.
- **Have the deploy workflow announce its versions to `links-data` with a GitHub OIDC token,** and check live versions from a `links-data` cron. Strong, but it adds an endpoint, token verification and a Workers read token inside Cloudflare, where the hourly job needs none.
- **Report deploys, route changes and Email Routing changes in the audit watch,** by any actor but the CI token. It misses the stolen CI token.
- **Move the audit watch to `links-data`.** Its state would be rebuilt there for a risk the hourly job already covers.
- **A heartbeat key in `FLAGS` read by the Status Worker,** as ADR 0025 does for the off-account copy. The stolen token can write `FLAGS` and replace `status`, so it could fake a healthy run.
- **Grafana alerts only, no email from `links-data`.** A heartbeat can say a check failed but not which Short URLs.
- **Pause deletes above the threshold.** A way to block real Creators.
- **A minimal CAA record that Cloudflare appends to.** That it restricts issuance is inferred, not tested, and it can drift.
- **Logpush of audit logs to R2,** replacing or backing up the poll. See above.

## Consequences

- **ADR 0024's "noticing" is answered:** a rewritten `LINKS` value within a day, a changed Worker or zone within about an hour, a forged or contradicting log object at the next compaction or restore.
- **`links-data` gains** a `send_email` binding, two secrets (the signing key and the Grafana write token) and an hourly Cron Trigger.
- **The signing key joins ADR 0025's identity-root thinking:** it lives in the password manager, and a rebuild in a fresh account needs it to verify the off-account copy.
- **The signing key is permanent state the Operator must not lose.** Without it, restores run only with an override.
- **Every backup-bucket object written before signing ships is unsigned,** so signing lands before prod data is kept (slice 6.1 at the latest; prod data is disposable until `v0.1.0`).
- **The Operator gets a failed-job email after any out-of-band change,** including their own dashboard edits to the zone.
- **The glossary gains Redirect hijack.**
- **The PRD's slices change through the closing ticket,** [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60).
