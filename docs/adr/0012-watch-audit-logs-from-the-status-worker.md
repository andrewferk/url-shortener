---
status: accepted
---

> Amended by [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md): the `production-plan` token's ID joins `audit_protected_token_ids`. Bootstrap's checks that `audit-read` can read `/logs/audit`, and that bucket-lock changes are logged, run as the Operator CLI's `doctor`.
>
> Amended by [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md): raw SQL through Data Studio is logged in Audit Logs v1, so "data-level destruction stays unwatched" is no longer true of it; whether the watch reads v1 is left to the hijack ticket. The yearly token rotation produces an expected digest email for every rolled token.

> Amended by [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md): the watch stays in the Status Worker and also polls Audit Logs v1 for Data Studio SQL and Email Routing changes. Logpush is still not used, though it no longer needs Enterprise. Worker deploys, routes, rulesets and zone settings stay out of the watch; the ops repo's hourly integrity job compares them with `main`. "Data-level destruction stays unwatched" no longer holds for `LINKS`, which `links-data` sweeps against the shards.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): Logpush of audit logs is no longer Enterprise-only (self-service on Free, 25 GB a month included; the audit dataset on Free is inferred). Data Studio SQL is logged in Audit Logs v1. The digest carries no links, and goes to an alias.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the execution headroom cited against a separate Worker follows ADR 0021. The two mentions of the `operator` token's KV Edit follow ADR 0024.

> Amended by [ADR 0032](./0032-decide-what-six-unverified-facts-do-if-they-fail-and-run-the-cross-account-secrets-spike-first.md): if `audit-read` can't read Audit Logs v1 it gains the narrowest permission that can; if no account-owned token can, the hourly integrity job lists Email Routing rules and addresses, and Data Studio SQL returns to the accepted gaps.

# Watch Audit Logs v2 from the Status Worker for destructive changes, and email the Operator a digest

Cloudflare sends no alert when a Worker, KV namespace, D1 database, R2 bucket or DNS record is deleted ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)). The guards so far protect against *OpenTofu* deleting things:
- `prevent_destroy`;
- the approval gate on `production-admin`;
- tokens that can't delete.

They don't stop other credentials that can reach prod:
- the `preview` token, which holds Workers Admin, KV and D1 in the prod account until the account split;
- the `operator` token ([ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md)), which held KV Edit when this was decided; ADR 0024 dropped it, and the token can still deploy `links-data`;
- the Operator's broad token and dashboard session.

[ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)'s alerts already catch the deletions that break Redirects. What nothing catches is the silent kind: removing the backup bucket's lock rules, minting a token, or a preview credential touching prod. So the Status Worker polls Audit Logs v2 every 5 minutes and emails the Operator a digest of destructive changes.

Decided in [How are destructive changes to Cloudflare resources detected?](https://github.com/andrewferk/url-shortener/issues/29).

## Decision

### What is watched

- **Resources, not data.** The watch covers Cloudflare's control plane. Writes to shard rows, KV keys and R2 objects never reach the audit log. Link data already has the change log and the `ops/` audit records ([ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md), ADR 0010).
- **Destructive changes** are:
  - every `delete`, on any resource;
  - changes that remove protection, whatever their action type: R2 bucket lock and lifecycle rules, and API tokens being created, rolled, changed or deleted.
- **Not watched:** rulesets, Worker routes, zone settings and Worker deploys. The `production` job changes them on every merge. A bad change breaks Redirects, and ADR 0011's Probes catch that.

### Which events are reported

- **The protected set** is prod's own resources:
  - the three prod Worker names;
  - the `LINKS`, `AUTH` and `FLAGS` namespace IDs;
  - the D1 database ID;
  - the backup bucket and `tofu-state-prod`;
  - prod's DNS record IDs;
  - the IDs of the `production`, `production-admin`, `operator` and `audit-read` tokens.

  The render script writes the resource IDs into the Status Worker's config from `tofu output`. Token IDs aren't secret and OpenTofu doesn't create tokens, so they are `infra/env` variables entered at bootstrap.
- **An event is reported** when any of these holds:
  - it removes protection;
  - its resource is in the protected set;
  - its actor isn't the `preview` token (`actor.token_id` ≠ `audit_preview_token_id`).
- **So the only destructive event left silent is a preview teardown:** the `preview` token deleting something outside the protected set. Matching preview resources by the `pr-<n>` name is unreliable, because a delete event usually carries an ID, not a name. The Operator's own deletes are reported, on purpose: the email asks "was this you?".
- **After the account split** the `preview` token no longer acts in the prod account, so every delete there is reported. No configuration changes.

### The poller

- **The Status Worker polls as the last step of its 5-minute rollup.** It already has:
  - the `send_email` binding;
  - D1 for state;
  - ADR 0011's alert-state pattern;
  - a watchdog outside Cloudflare, Grafana's stale-page check, which fires if the Worker is deleted or stops.
- **Prod only.** The step follows `probes_enabled`, like ADR 0011's other alerts. In the single-account phase a preview's Status Worker would read the same account's log and send duplicate emails. After the split the preview account is unwatched.
- **The token is `audit-read`,** an account-owned token with only **Account Settings Read**. If that can't read Audit Logs v1, it gains the narrowest permission that can ([ADR 0032](./0032-decide-what-six-unverified-facts-do-if-they-fail-and-run-the-cross-account-secrets-spike-first.md)).
  - Cloudflare has no narrower permission for audit logs. This one also reads account membership and settings, and it can't write anything.
  - It is created in `infra/bootstrap` and kept in the `production` GitHub environment and the password manager.
  - It is pushed only to prod's Status Worker. Previews keep reusing only the Analytics Engine read token (ADR 0007).
  - Bootstrap confirms that an account-owned token can read `/logs/audit`. Cloudflare's docs don't say either way.
- **The query:** `GET /accounts/{id}/logs/audit` with `since` and `before`, `action_type.not=view`, `direction=asc` and `limit=1000`, following `cursor`. The Worker classifies each event itself.

### Late events

The API filters on when an action happened, not on when Cloudflare recorded it. Delays of an hour have been reported, and there is no documented upper bound.
- **Every run** reads the last `audit_lookback_hours` (3 hours).
- **A daily sweep** at the 00:05 UTC rollup reads the last `audit_sweep_days` (7 days).
- **Seen event IDs** are kept in D1 for 14 days, so each event is reported once however many windows it appears in.
- **The watch has a start time,** stored in D1 when the step first runs. Events from before it are never reported, so the first sweep doesn't email a week of history.
- **A late event is marked "late by Xh"** in the digest, measured from `action.time` to when it was first seen, so it reads as old news, not a live incident.
- **An event that arrives more than 7 days late is missed.** That would be a Cloudflare incident, not lag. The event stays retrievable for 18 months.

### The email

- **One digest per run** that finds new reportable events, sent to the Operator through the `send_email` binding. It is never shown on the Status page. The page is public and reports Redirect health, and a deletion that hurts Visitors already shows there through the Objectives.
- **Each line** shows:
  - the time and the action;
  - the resource type and ID, flagged if it's in the protected set;
  - the actor's email or token name, its context (`dash`, `api_token`, …) and its IP;
  - the `cf_ray_id`;
  - "late by Xh" where it applies.
- **At most 50 lines,** then "and N more". The digest carries no links. It says in words where the dashboard's audit log is. The alert address is an alias committed in a public repo, and a "was this you?" email with a link is a phishing template.
- **The subject line says whether the digest holds a protected resource or a protection-removing change,** so those stand out from routine emails such as the Operator's own dashboard deletes.

### When the watch is blind

- **An "audit watch blind" alert** fires when every poll for `audit_blind_after_minutes` (60 minutes, 12 runs) has failed. That covers a revoked token, a lost permission or the API failing. Deleting the watch's own token first would otherwise silence it.
- It uses ADR 0011's alert state in D1: one email when it starts firing and one when it resolves.
- A dead Status Worker is Grafana's stale-page check's job, so the two cover each other.

### The bucket lock

- **R2's documentation doesn't list lock changes among its audited actions.** Audit Logs v2 is generated from Cloudflare's API schemas, so they're probably logged anyway.
- **Bootstrap verifies it:**
  1. call `/logs/audit/product_categories`;
  2. toggle the lock on a preview bucket;
  3. confirm the event appears.
- **If lock changes aren't logged,** the gap joins ADR 0008's accepted risk that anyone with R2 write can remove the lock, and it is revisited at the account split with that risk. No direct lock check is built: it would give the Status Worker account-wide R2 read, which also reads every backup.

### Parameters

These are IaC variables, rendered into the Status Worker's config as ADR 0007 describes.

| Variable | Default |
|---|---|
| `audit_lookback_hours` | 3 |
| `audit_sweep_days` | 7 |
| `audit_seen_retention_days` | 14 |
| `audit_blind_after_minutes` | 60 |
| `audit_digest_max_events` | 50 |
| `audit_preview_token_id` | the `preview` token's ID, until the split |
| `audit_protected_token_ids` | the prod tokens' IDs |

## Cost

$0 extra.
- A run is one or two API requests, and the daily sweep is a few pages. The API's limit is 1,200 requests per 5 minutes.
- Email Routing is free.
- The seen-ID table holds at most a few thousand rows.

## Considered options

- **Leave the audit log unwatched,** relying on `prevent_destroy`, approval gates and tokens that can't delete. Those guards don't cover the `preview` token in the single-account phase, the `operator` token (KV Edit then; Editor on `links-data` still, since ADR 0024), or the Operator's own token and session.
- **Report every event, or drop all events from CI and Operator tokens.** The first makes preview teardowns noise. The second hides a stolen CI or Operator token, which is exactly the case worth an email.
- **Match preview resources by their `pr-<n>` name.** Delete events usually carry an ID, not a name.
- **Watch rulesets, routes and zone settings too.** They change on every merge, and a bad change already shows up as failing Probes.
- **A new Worker with no routes and its own Cron Trigger.** It would need its own `send_email`, its own state, and its own external watchdog, which Grafana's roughly 6k of monthly execution headroom could barely afford (about 24k since ADR 0021).
- **A scheduled GitHub Actions job.** GitHub's cron runs late and can be dropped, and the job would put another Cloudflare credential in GitHub.
- **Cloudflare Notifications or Logpush.** No Notification type covers audit events. Logpush is no longer Enterprise-only: it is self-service on Free, with 25 GB a month included. That the `audit_logs_v2` dataset can be selected on a Free account is inferred, not stated. [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md) decides it still isn't used.
- **Adding Account Settings Read to the Analytics Engine read token.** Previews reuse that token, so every preview would hold it.
- **A 3-hour window only.** It misses any event delayed more than 3 hours, silently, and the lag has no documented upper bound.
- **A 24-hour window on every run.** It re-reads a day of events 288 times a day, and it is still blind past a day.
- **Checking the bucket lock directly.** It needs account-wide R2 read, which also reads every backup.
- **Audit Logs v1.** It covers about 75% of products, against v2's 95%, with fewer filters and page-based paging.
- **Showing destructive changes on the Status page.** It would tell an attacker what worked, and it isn't what Visitors come to the page for.

## Consequences

- **ADR 0007's "Cloudflare sends no alert when something is deleted" is answered,** within about 5 minutes when the log isn't delayed, and within a day when it is.
- **Data-level destruction stays unwatched,** such as raw SQL writes through `query/v2`, and KV key writes. Data Studio SQL is the exception: it is logged in Audit Logs v1, two entries per query, and ADR 0026 adds it to the watch, unless no account-owned token can read v1, in which case it stays in this gap (ADR 0032). This is an accepted gap. The change log and `ops/` records are how such damage is found and undone.
- **The public-facing Status Worker holds an account-wide read token.** It reads account membership and settings but can change nothing.
- **Every delete by the Operator sends an email.** That is intended, and it is cheap at the Operator's volume of deletes.
- **Adding a prod resource means adding it to the protected set** through an OpenTofu output. Otherwise its deletion by the `preview` token would go unreported during the single-account phase.
- **Status D1 gains two tables:** seen audit events, and the watch's start time and poll state.
