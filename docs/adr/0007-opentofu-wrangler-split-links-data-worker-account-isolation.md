---
status: accepted
---

> Amended by [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md): `infra/env` also owns an R2 backup bucket bound to `links-data`, with a bucket lock and `prevent_destroy` in prod only. So `production-admin` also needs R2 edit.
>
> Amended by [ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md): `infra/bootstrap` also creates the Operator CLI's `operator` token (Editor on `links-data`, Workers Scripts Read, KV Edit) and an R2 key scoped to the backup bucket. ADR 0024 later dropped KV Edit and made the R2 key Object Read only. `links-data` also holds the Operator Workflows, and sets `workers_dev = false` and `preview_urls = false`, which the render script enforces.
>
> Amended by [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md): `infra/zone` also owns Email Routing and the Operator's verified destination address, so the `production` token gains Email Routing permissions. When `probes_enabled`, `infra/env` also owns the Grafana contact point, notification policy and check alerts, plus a Status page check that brings prod to about 93.7k of Grafana Free's 100k monthly executions (about 75.9k since ADR 0021). The Status Worker gains a `send_email` binding.
>
> Amended by [ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md): `infra/bootstrap` also creates an `audit-read` token (Account Settings Read only), pushed only to prod's Status Worker. `infra/env` outputs the protected set of prod resource and token IDs for the render script. The consequence that Cloudflare sends no alert on deletion is answered: the Status Worker polls Audit Logs v2 and emails the Operator.
>
> Amended by [ADR 0015](./0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md): the `production`, `production-admin` and `preview` GitHub environments, with their secrets and approvals, live in each deployment's ops repo, which is public for the reference deployment. The render script and `infra/` roots run from this repo at the ops repo's pinned ref. Previews of pull requests are dispatched from the ops repo for one approved head SHA, built without secrets and deployed by trusted tooling.
>
> Amended by [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md): a fourth GitHub environment, `production-plan` (no approval, `main` only), holds a read-only token created in `infra/bootstrap`. It plans `infra/zone` and `env/prod` unattended, so `production-admin` runs only when something is pending. `infra/env`'s Worker outputs become one structured `workers` output for the render script. The script's guards also accept a throwaway `drill` environment for restore drills. After the account split, `deploy.yml` applies the preview account's zone before prod's.
>
> Amended by [ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md): the D1 database and every R2 bucket, the state buckets included, are created with the deployment's optional `location_hints.d1` and `location_hints.r2`. A hint can't change once applied.
>
> Amended by [ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md): `infra/bootstrap` holds one OpenTofu configuration, applied by hand, that installs Grafana Synthetic Monitoring; its state has its own key and a passphrase only the Operator holds, and is the one state that deliberately holds a secret. `infra/env` owns a Grafana rule group in place of the per-check alerts, and takes `probe_frequency_seconds`, `probe_locations` and `status_check_locations`.

> Amended by [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md): `infra/env` takes `flood_alert_requests_per_second` (default 100), and the cost brake applies one twenty-fourth of `cost_brake_daily_threshold` per UTC hour.

> Amended by [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md): `infra/env` takes `creator_daily_link_ceiling` (default 600) and `abuse_response_hours` (default 24). The Status Worker binds `FLAGS`, and `infra/zone` owns the `abuse@` Email Routing rule.
>
> Amended by [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md): "nothing that runs unattended in prod can delete anything" is replaced by a recoverability claim and a table of what each credential can do to Link data. Prod's backup bucket and its locks move to a hand-applied configuration in `infra/bootstrap`, so `production-admin` loses R2 edit and `production-plan` gains R2 read. Each `links-data` deploy pushes a fresh `OPERATOR_GATE` secret. Every token expires after 13 months, is rotated yearly and uses the narrowest Workers role.
>
> Amended by [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md): `creators add` also refuses a first real Creator until the off-account copy is configured and its heartbeat is fresh, unless `offsite_backup` is `"none"`.

> Amended by [ADR 0027](./0027-declare-durable-objects-with-exports-keep-gates-off-run-history-and-harden-state-encryption.md): `links-data` declares its Durable Objects with `exports`, not tagged `migrations`; the class-delete guard is documented for `exports`, and the restore drill asserts the Worker-delete one. OpenTofu is pinned to 1.13.x. The state passphrase is 32 random bytes, `enforced` is set on state and plan, and rotation is by event, through a runbook.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): Worker Previews are rejected for service bindings, Workflows and `script_name` Durable Objects not being per-Preview; shared KV and D1 applies only when bound to the same ID. The spend alert leaves OpenTofu. Editor on one Worker can bind any KV, R2 or D1 resource. All three Workers set `workers_dev` and `preview_urls` to `false`. Every ruleset rule carries a `ref`; the `production` token holds Bot Management Write; `.terraform.lock.hcl` is committed. Routes instead of Custom Domains, and the single-account phase, are cited as deliberate deviations; the orphaned-DNS reason is dropped. A preview account that runs drills needs Workers Paid.

> Amended by [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md): `links-data` gains an hourly Cron Trigger, its own `send_email` binding and two secrets set by hand, the backup signing key and a Grafana write token. Every deploy run records the live version IDs of all three Workers in a GitHub deployment record, which the ops repo's hourly integrity job compares with what is live.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the body now carries what ADRs 0010, 0011, 0016, 0021, 0024, 0026 and 0027 changed: the recoverability claim, `exports`, OpenTofu 1.13.x, the Probe count, and the credentials table, which gains `production-plan`. The parameters table gains the inputs of ADRs 0022 and 0023, the `status` row lists its later bindings, and Synthetic Monitoring is installed by OpenTofu (ADR 0021).

# Split the stack between OpenTofu and Wrangler, keep the Links in a separately deployed data Worker, and isolate previews by account

Cloudflare has no lock, trash or restore for a deleted Worker, KV namespace, D1 database or Durable Object namespace. Deleting a Worker also deletes the Durable Object namespaces it implements, so under [ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)'s single Worker, one wrong delete loses every Link and tombstone. So the layout is designed around what each credential *can* destroy.

- **Wrangler** deploys the Workers, and **OpenTofu** owns what's stateful or zone-wide.
- The Durable Objects move into their own **Links data Worker**, which only an approval-gated job deploys.
- Nothing that runs unattended in prod can delete a resource. [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md) restates this as a recoverability claim: an unattended credential can still delete Links and corrupt the read copies through the Workers it deploys, and all of that is recoverable.
- Previews will get their own Cloudflare account, as Cloudflare recommends. Until the first real Creator is admitted, they share the prod account behind guards.

Decided in [How is the OpenTofu stack laid out and deployed?](https://github.com/andrewferk/url-shortener/issues/13).

## Decision

### Workers

There are three Workers per environment. In prod each is named as below; in a preview they're named `<name>-pr-<n>`.

| Worker | Serves | Holds |
|---|---|---|
| `redirect` | Redirects on the short domain, and the Link API on `api.` | ADR 0004's cost-brake Cron Trigger. No Durable Object classes. |
| `links-data` | No routes | The shard and Creator Durable Object classes and their outbox. `redirect` binds to them with `script_name`. |
| `status` | The Status page on `status.` ([ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md)) | Its D1 database, its `FLAGS` binding ([ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md)), its `send_email` binding ([ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)), its read tokens, and the rollup Cron Trigger |

Moving the classes out of `redirect` changes no latency: a call to a Durable Object is a network hop either way. It also brings in two Cloudflare guards:
- a non-forced delete of `links-data` is refused while `redirect` binds to it;
- so is removing its classes. This guard is documented for `exports`, which [ADR 0027](./0027-declare-durable-objects-with-exports-keep-gates-off-run-history-and-harden-state-encryption.md) adopts; the restore drill asserts the first one.

### Which tool owns what

- **OpenTofu** owns:
  - KV namespaces and D1 databases;
  - DNS records;
  - zone settings and all rulesets ([ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)'s edge ceiling and emergency block, plus the explicit Bot Fight Mode off / Under Attack off / DDoS-defaults settings);
  - the Grafana Synthetic Monitoring checks.

  The spend alert is not in this list: no API or provider resource exists for a budget alert, so it is set by hand (ADR 0004).

  It uses the `cloudflare/cloudflare` provider (pinned exactly, per ADR 0001) and `grafana/grafana`.
- **Wrangler** owns each Worker: code, bindings, Durable Object class declarations (`exports`, ADR 0027), Cron Triggers, routes, secrets and D1 schema migrations (`wrangler d1 migrations apply`).
- **The glue:** a repo script renders each Worker's Wrangler config from `tofu output -json` for the environment. The rendered config holds:
  - resource IDs;
  - routes;
  - the Analytics Engine dataset name;
  - rate limiter namespace IDs;
  - every variable in the parameters table below.

  It is generated, never hand-edited, because `wrangler deploy` drops any binding its config doesn't declare. Local development renders the same config.
- **Routes are plain Worker routes, not Custom Domains.** OpenTofu owns a proxied placeholder DNS record for each hostname, so `tofu destroy` removes it. This goes against Cloudflare's guidance, knowingly: "If your Worker is your application's origin, use Custom Domains." Custom Domains are avoided for three reasons:
  - each issues an Advanced Certificate, which "is **not** automatically deleted" with the Custom Domain;
  - Custom Domains don't support per-Worker roles yet, which the deploy tokens rely on;
  - in CI, Wrangler silently takes over a hostname already attached to another Worker. The provider review reported this; research did not verify it.

  An earlier reason, that `wrangler delete` can leave orphaned DNS records behind, is dropped: no source for it was found.
- **Durable Objects are declared with `exports`** (ADR 0027), from the first `links-data` deploy. This ADR first chose tagged `migrations`, which Cloudflare now steers new Workers away from. The switch is one-way, so it is made before anything is deployed.
- **All three Workers set `workers_dev = false` and `preview_urls = false`,** and the render script enforces both. `preview_urls` is set explicitly because `workers_dev = false` does not disable Version or Preview URLs, and an omitted `preview_urls` leaves the stored setting alone.
- **Secrets never go through OpenTofu,** so none are in state. CI pushes them with `wrangler secret bulk`.

### Roots and state

- **`infra/bootstrap`:** a runbook checklist, not applied by CI. It covers:
  - the state buckets and their bucket-scoped R2 keys;
  - the Cloudflare API tokens;
  - creating each Worker once (only product-level Admin can create a Worker);
  - the Grafana stack, with Synthetic Monitoring installed by a hand-applied OpenTofu configuration that lives here ([ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md)), not switched on in the UI;
  - the Status Worker's two read tokens.
- **`infra/zone`:** one state per Cloudflare account, holding everything that exists once per zone or account:
  - zone settings and all rulesets;
  - DNS records that belong to no environment.

  A Free zone has one ruleset per phase and `cloudflare_ruleset` owns the whole rule list, so only this root touches rulesets. Every rule carries a `ref`: without one, the provider may delete and recreate a rule when the ruleset changes.
- **`infra/env`:** one root, with one state per environment (`env/prod`, `env/pr-<n>`) selected by the backend key, not by workspaces. It holds everything that exists once per environment:
  - KV namespaces and the D1 database;
  - the environment's DNS records. A record belongs to the environment whose hostname it is, so the apex, `api.` and `status.` belong to prod.
  - the environment's rate limiter namespace IDs;
  - the Grafana checks when `probes_enabled`;
  - the outputs Wrangler's config is rendered from.

  Prod's KV and D1 carry `prevent_destroy`.
- **Modules** go under `infra/modules/`, and only where both roots actually reuse something.
- **State backend:**
  - OpenTofu's S3 backend on R2, with Cloudflare's documented R2 flags and `use_lockfile` locking. R2 supports the conditional writes that locking needs.
  - Each root commits its `.terraform.lock.hcl`, so provider binaries are hash-checked, and CI runs `tofu init -lockfile=readonly`.
  - OpenTofu is pinned to 1.13.x (ADR 0027; `use_lockfile` needs ≥1.10).
  - There is one bucket per account (`tofu-state-prod`, and `tofu-state-preview` for previews), each reachable only with its own bucket-scoped R2 key.
- **State encryption:** OpenTofu's native `aes_gcm` with a `pbkdf2` passphrase, one per bucket.
  - The passphrase is kept in the GitHub environment secrets *and* the Operator's password manager, because GitHub secrets are write-only and a lost passphrase is lost state.
  - State should hold no secrets anyway. Encryption covers the day one slips in.

### Environments

- **Hostnames:**
  - prod: the apex for Redirects, `api.` and `status.`;
  - a preview: `pr-<n>`, `pr-<n>-api` and `pr-<n>-status` on `preview_base_domain`. Only one subdomain level is used, because Free Universal SSL covers no deeper.
  - ADR 0005's OIDC `aud`, the Wrangler routes and CI's checks all derive from this template. CI refuses to deploy a preview whose routes don't match it, so no preview can claim a prod hostname.
- **A preview is a full copy of the environment-scoped stack:**
  - its own three Workers and Durable Object namespaces;
  - its own KV (as ADR 0005 requires) and D1;
  - its own Analytics Engine dataset, `redirect_events_<env>`;
  - a Canary link, created by the post-deploy step in ADR 0003.
- **Previews get no Probes.** Prod's three locations every 2 minutes, with the Status page check, already use about 75.9k of Grafana Free's 100k monthly executions ([ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md)). A preview's Status page shows the uptime section as "no Probes in this environment".
- **Teardown order:**
  1. `wrangler delete` for `redirect-pr-<n>` and `status-pr-<n>`.
  2. `wrangler delete` for `links-data-pr-<n>`, which is refused while anything still binds to it.
  3. `tofu destroy` of `env/pr-<n>`.
  4. Delete that state object.

  Teardown never passes `--force`, and refuses any name that doesn't match `pr-<n>`.
- **Pre-scaling needs no mechanism.** Cloudflare offers none, and shard capacity is fixed by the shard count.

### Parameters

These are variables of `infra/env`. They reach the Workers through the rendered Wrangler config.

| Variable | Prod | Preview |
|---|---|---|
| `account_id` | prod account | prod account until the split, then the preview account |
| `env_name` | `prod` | `pr-<n>` |
| `base_domain` / `preview_base_domain` | the short domain | the short domain until the split |
| `redirect_event_sample_rate` (ADR 0003) | 1.0 | 1.0 |
| `cost_brake_daily_threshold` (ADR 0004; ADR 0022 applies one twenty-fourth of it per UTC hour) | 3M (125,000 an hour) | **100k** (about 4,167 an hour) |
| `force_shedding` (ADR 0004) | false | false |
| `creator_burst_per_minute`, `creator_daily_link_cap` (ADR 0004) | 60, 300 | 60, 300 |
| `creator_daily_link_ceiling` (ADR 0023) | 600 | 600 |
| `flood_alert_requests_per_second` (ADR 0022; the alert is sent in prod only) | 100 | 100 |
| `abuse_response_hours` (ADR 0023) | 24 | 24 |
| `probes_enabled` | true | false |
| OIDC trust ([ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)): `repository_id`, `environment` claim, `aud` | `production`, the `api.` origin | `preview`, the `pr-<n>-api` origin |
| Rate limiter namespace IDs | a fixed block | derived from `<n>`, disjoint from every other environment |

Rate limiter counters are shared by every Worker in an account that uses the same `namespace_id`. So each environment's IDs are output by `infra/env` and never written by hand.

`force_shedding` is now a Worker variable that the Worker ORs with the cost brake's KV flag. That amends ADR 0004, where OpenTofu wrote the flag, and it means no unattended job's token needs KV write, which on Cloudflare also grants delete. The Workers that token deploys still bind KV read-write (ADR 0024).

### Credentials

Each set of credentials is kept in a separate GitHub environment. Cloudflare API tokens are account-owned, so they work with granular Worker roles.

| GitHub environment | Runs | Cloudflare token can | Approval |
|---|---|---|---|
| `production` (from `main` only) | Deploys `redirect` and `status`, applies `infra/zone`, and creates the Canary link (OIDC `environment=production`) | Edit `redirect` and `status` only. Workers Routes, rulesets, zone settings, Email Routing (ADR 0011), and Bot Management Write so it can turn Bot Fight Mode off. **No KV, D1 or Workers Admin**, so it can't delete a Worker or any data through the API. | None |
| `production-admin` (from `main` only) | Applies `env/prod`, deploys `links-data` and runs D1 schema migrations | Edit `links-data`. KV, D1, DNS; no R2 edit (ADR 0024). The Grafana Synthetic Monitoring token and stack token (ADRs 0016, 0021), and the Grafana write token that `links-data` holds for its heartbeat (ADR 0026). | The Operator approves each run |
| `production-plan` (from `main` only; [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md)) | Plans `infra/zone` and `env/prod`, and runs the hourly integrity job (ADR 0026) | Read only: Metadata Read-Only on Workers, and R2 read (ADR 0024). | None |
| `preview` | Applies `env/pr-<n>`, deploys and tears down previews | Workers Admin, KV, D1, DNS and Workers Routes in the account the previews live in. No rulesets or zone settings. | The Operator approves each run (single-account phase) |

- **A token's permissions don't bound what its Worker can bind.** Cloudflare documents that Editor on one Worker is enough to deploy it with bindings to any KV, R2 or D1 resource: "You do not need separate permissions on the bound resources to deploy the Worker." So "No KV, D1" above describes the token's own API calls, not the data its Worker can reach. [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md) restates the claim on that basis.
- **The Operator's own broad token** stays in their password manager for bootstrap and emergencies. The Operator CLI doesn't use it: it has its own `operator` token ([ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md), ADR 0024).
- **The Status Worker's read tokens** are created once by hand and pushed as Worker secrets from GitHub environment secrets. They are an Account Analytics Read token for the Analytics Engine SQL API and a Grafana `metrics:read` access policy token. No CI credential can create credentials: OpenTofu doesn't mint tokens, which would need token-creation rights and would put the values in state.
- **Previews reuse the Analytics Engine read token**, because each reads only its own dataset. They get no Grafana token.
- **ADR 0005's GitHub OIDC is unaffected.** It proves CI's identity to the Link API. Cloudflare's own API has no OIDC login, so the deploy tokens above stay long-lived secrets.

### Previews move to their own account at the first real Creator

- **The target:** Cloudflare's recommendation, *"use separate Cloudflare accounts with separate domains"*. A preview account gets its own `infra/zone` state, bucket, passphrase and tokens.
  - The `preview` token is then Admin only there, so no preview credential can reach prod.
  - Ruleset changes can be tried on the preview zone before prod.
  - The approval gate on `preview` can then be dropped.
- **Until then**, previews share the prod account and zone, behind these guards:
  - the approval gate;
  - the `pr-<n>` name check;
  - no `--force`;
  - `prevent_destroy`;
  - the `links-data` binding guard.

  This is acceptable only while prod holds no Links anyone else relies on. The single-account phase, and pull-request code running beside the `preview` token ([ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md)), go against Cloudflare's recommendation quoted above and, as the provider review reports it, GitHub Security Lab's guidance on untrusted pull-request code. Both are knowing deviations, and the account split is the fix.
- **The trigger:** the split happens before the Operator admits the first Creator other than CI's operations Creator. The Operator CLI's `creators add` enforces this against prod: it refuses while `preview_base_domain` still equals the prod domain.
- **The move** changes `account_id` and `preview_base_domain` for previews, to a second domain or the preview account's `workers.dev` subdomain. No code changes. Buying a second domain is deferred until then.

## Cost

**Today:** $0 extra.
- R2 state fits the free tier (10 GB, 1M writes and 10M reads a month).
- Previews run inside Workers Paid's included amounts, and there is no second domain.

**After the split:**
- The preview account runs on Workers Free if everything previews and drills use is available there; otherwise it's another $5/mo. Restore drills settle it: a drill is about 51,000 Workflow steps, and Workers Free allows 3,000 a day, so the account that runs drills needs Workers Paid.
- A preview domain costs about $10/yr, or $0 on `workers.dev`.

## Considered options

- **OpenTofu deploys the Workers too** (`cloudflare_workers_script`, secrets as `secret_text`). It would give one plan and a one-command teardown. Rejected because:
  - the provider's Durable Object migration support has a history of drift bugs and an open migrations issue;
  - its `exports` support is unverified;
  - secrets would land in state;
  - `wrangler dev` would still need every binding declared a second time.
- **Cloudflare Worker Previews** (GA 2026-09-22). They create a Preview per branch with its own Durable Objects and delete it automatically. Rejected because:
  - a Preview's service binding goes to the production Worker, and a Workflow binding to the existing Workflow, never to a matching Preview. `redirect` reaches the shards through a `script_name` Durable Object binding; what that resolves to in a Preview is not documented, and we assume it is production's `links-data` too. So every Preview would share one set of shards and Operator Workflows;
  - Cron Triggers don't run in Previews, so ADR 0004's cost brake and ADR 0003's rollups would be dead;
  - KV and D1 are shared by any two Previews bound to the same resource ID, and nothing creates a namespace or database per Preview. PR 41's shards would write into the KV that PR 42 reads, and both would claim `canary`;
  - a Preview lives under the production Worker, so a credential that deploys one can deploy production. Research confirmed the first half only.
- **Durable Objects inside `redirect`** (ADR 0001 as written). Every routine deploy, and any delete, would carry every Link. Cloudflare advises that *"Durable Object lifecycle changes should be deployed independently of other code changes."*
- **One account permanently, protected only by guards.** KV and D1 permissions are account-wide, and creating or tearing down a preview Worker needs account-wide Workers Admin. So a preview credential could always delete prod. Kept only as the phase before the first real Creator.
- **A second domain from day one.** It would allow previewing ruleset changes and make the later move trivial. Deferred on cost.
- **Previews on `workers.dev` from day one.** They'd skip the zone's routes and edge ceiling entirely.
- **Hostnames like `api.pr-42.<domain>`.** Not covered by Free Universal SSL without Advanced Certificate Manager (about $10/mo).
- **OpenTofu mints the Status Worker's read tokens.** Rejected: CI would need token-creation rights, and the values would sit in state.
- **OpenTofu workspaces for environments.** Rejected in favour of one backend key per environment, so a preview's state is a single object that can be deleted.
- **HCP Terraform or another hosted backend** adds a vendor, and its OpenTofu support is a grey area. **Local state** can't serve CI.

## Consequences

- **ADR 0001's "single global Worker" becomes `redirect` plus `links-data`.** Changes to the shard or Creator Durable Objects ship only through the approval-gated `production-admin` job.
- **Deleting prod data needs the Operator's own token,** except through the `preview` token during the single-account phase. ADR 0024 narrows this to resources, locks and backups: an unattended credential can delete Links, recoverably. Nothing Cloudflare offers can undo a deletion. How Links and credentials are backed up belongs to [What is the Link data model across shards, KV, and Creator lists?](https://github.com/andrewferk/url-shortener/issues/14).
- **Ruleset and zone-setting changes can't be previewed until the split.** They are checked only by `tofu plan` in the PR.
- **Cloudflare sends no alert when something is deleted.** Audit Logs v2 records deletions for 18 months, but only through its API.
- **Two tools, one generated seam.** Adding a binding means adding an OpenTofu output and a line to the render script, never editing a Wrangler config by hand.
- **Grafana check changes and D1 schema migrations need approval,** because they run in `production-admin`.
