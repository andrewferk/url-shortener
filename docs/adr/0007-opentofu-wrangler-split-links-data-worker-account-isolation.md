---
status: accepted
---

> Amended by [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md): `infra/env` also owns an R2 backup bucket bound to `links-data`, with a bucket lock and `prevent_destroy` in prod only. So `production-admin` also needs R2 edit.

# Split the stack between OpenTofu and Wrangler, keep the Links in a separately deployed data Worker, and isolate previews by account

Cloudflare has no lock, trash or restore for a deleted Worker, KV namespace, D1 database or Durable Object namespace. Deleting a Worker also deletes the Durable Object namespaces it implements, so under [ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)'s single Worker, one wrong delete loses every Link and tombstone. So the layout is designed around what each credential *can* destroy.

- **Wrangler** deploys the Workers, and **OpenTofu** owns what's stateful or zone-wide.
- The Durable Objects move into their own **Links data Worker**, which only an approval-gated job deploys.
- Nothing that runs unattended in prod can delete anything.
- Previews will get their own Cloudflare account, as Cloudflare recommends. Until the first real Creator is admitted, they share the prod account behind guards.

Decided in [How is the OpenTofu stack laid out and deployed?](https://github.com/andrewferk/url-shortener/issues/13).

## Decision

### Workers

There are three Workers per environment. In prod each is named as below; in a preview they're named `<name>-pr-<n>`.

| Worker | Serves | Holds |
|---|---|---|
| `redirect` | Redirects on the short domain, and the Link API on `api.` | ADR 0004's cost-brake Cron Trigger. No Durable Object classes. |
| `links-data` | No routes | The shard and Creator Durable Object classes and their outbox. `redirect` binds to them with `script_name`. |
| `status` | The Status page on `status.` ([ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md)) | Its D1 binding and rollup Cron Trigger |

Moving the classes out of `redirect` changes no latency: a call to a Durable Object is a network hop either way. It also brings in two Cloudflare guards:
- a non-forced delete of `links-data` is refused while `redirect` binds to it;
- so is a `deleted_classes` migration of its classes.

### Which tool owns what

- **OpenTofu** owns:
  - KV namespaces and D1 databases;
  - DNS records;
  - zone settings and all rulesets ([ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)'s edge ceiling and emergency block, plus the explicit Bot Fight Mode off / Under Attack off / DDoS-defaults settings);
  - the spend alert;
  - the Grafana Synthetic Monitoring checks.

  It uses the `cloudflare/cloudflare` provider (pinned exactly, per ADR 0001) and `grafana/grafana`.
- **Wrangler** owns each Worker: code, bindings, Durable Object migrations, Cron Triggers, routes, secrets and D1 schema migrations (`wrangler d1 migrations apply`).
- **The glue:** a repo script renders each Worker's Wrangler config from `tofu output -json` for the environment. The rendered config holds:
  - resource IDs;
  - routes;
  - the Analytics Engine dataset name;
  - rate limiter namespace IDs;
  - every variable in the parameters table below.

  It is generated, never hand-edited, because `wrangler deploy` drops any binding its config doesn't declare. Local development renders the same config.
- **Routes are plain Worker routes, not Custom Domains.** OpenTofu owns a proxied placeholder DNS record for each hostname, so `tofu destroy` removes it. Custom Domains are avoided for three reasons:
  - each issues an Advanced Certificate that outlives the domain;
  - `wrangler delete` can leave orphaned DNS records behind;
  - in CI, Wrangler silently takes over a hostname already attached to another Worker.
- **Durable Objects use tagged `migrations`.** Cloudflare calls it legacy, but it isn't deprecated, and gradual deploys work with it when no migration is pending. Moving to the newer `exports` stays possible later; moving back from `exports` is not, and its docs and code still disagree.
- **Secrets never go through OpenTofu,** so none are in state. CI pushes them with `wrangler secret bulk`.

### Roots and state

- **`infra/bootstrap`:** a runbook checklist, not applied by CI. It covers:
  - the state buckets and their bucket-scoped R2 keys;
  - the Cloudflare API tokens;
  - creating each Worker once (only product-level Admin can create a Worker);
  - the Grafana stack, with Synthetic Monitoring switched on in the UI (the installation can't be imported);
  - the Status Worker's two read tokens.
- **`infra/zone`:** one state per Cloudflare account, holding everything that exists once per zone or account:
  - zone settings and all rulesets;
  - DNS records that belong to no environment;
  - the spend alert.

  A Free zone has one ruleset per phase and `cloudflare_ruleset` owns the whole rule list, so only this root touches rulesets.
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
  - OpenTofu is pinned to 1.12.x (`use_lockfile` needs ≥1.10).
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
- **Previews get no Probes.** Prod's two locations a minute already use about 86k of Grafana Free's 100k monthly executions. A preview's Status page shows the uptime section as "no Probes in this environment".
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
| `cost_brake_daily_threshold` (ADR 0004) | 3M | **100k** |
| `force_shedding` (ADR 0004) | false | false |
| `creator_burst_per_minute`, `creator_daily_link_cap` (ADR 0004) | 60, 300 | 60, 300 |
| `probes_enabled` | true | false |
| OIDC trust ([ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)): `repository_id`, `environment` claim, `aud` | `production`, the `api.` origin | `preview`, the `pr-<n>-api` origin |
| Rate limiter namespace IDs | a fixed block | derived from `<n>`, disjoint from every other environment |

Rate limiter counters are shared by every Worker in an account that uses the same `namespace_id`. So each environment's IDs are output by `infra/env` and never written by hand.

`force_shedding` is now a Worker variable that the Worker ORs with the cost brake's KV flag. That amends ADR 0004, where OpenTofu wrote the flag, and it means no unattended job needs KV write, which on Cloudflare also grants delete.

### Credentials

Each set of credentials is kept in a separate GitHub environment. Cloudflare API tokens are account-owned, so they work with granular Worker roles.

| GitHub environment | Runs | Cloudflare token can | Approval |
|---|---|---|---|
| `production` (from `main` only) | Deploys `redirect` and `status`, applies `infra/zone`, and creates the Canary link (OIDC `environment=production`) | Edit `redirect` and `status` only. Workers Routes, rulesets, zone settings and the spend alert. **No KV, D1 or Workers Admin**, so it can't delete a Worker or any data. | None |
| `production-admin` (from `main` only) | Applies `env/prod`, deploys `links-data` and runs D1 schema migrations | Edit `links-data`. KV, D1, DNS. The Grafana SM access token. | The Operator approves each run |
| `preview` | Applies `env/pr-<n>`, deploys and tears down previews | Workers Admin, KV, D1, DNS and Workers Routes in the account the previews live in. No rulesets or zone settings. | The Operator approves each run (single-account phase) |

- **The Operator's own broad token** stays in their password manager for bootstrap and emergencies. It is also what ADR 0005's Operator CLI uses.
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

  This is acceptable only while prod holds no Links anyone else relies on.
- **The trigger:** the split happens before the Operator admits the first Creator other than CI's operations Creator. The Operator CLI's `creators add` enforces this against prod: it refuses while `preview_base_domain` still equals the prod domain.
- **The move** changes `account_id` and `preview_base_domain` for previews, to a second domain or the preview account's `workers.dev` subdomain. No code changes. Buying a second domain is deferred until then.

## Cost

**Today:** $0 extra.
- R2 state fits the free tier (10 GB, 1M writes and 10M reads a month).
- Previews run inside Workers Paid's included amounts, and there is no second domain.

**After the split:**
- The preview account runs on Workers Free if every binding previews use is available there; otherwise it's another $5/mo.
- A preview domain costs about $10/yr, or $0 on `workers.dev`.

## Considered options

- **OpenTofu deploys the Workers too** (`cloudflare_workers_script`, secrets as `secret_text`). It would give one plan and a one-command teardown. Rejected because:
  - the provider's Durable Object migration support has a history of drift bugs and an open migrations issue;
  - its `exports` support is unverified;
  - secrets would land in state;
  - `wrangler dev` would still need every binding declared a second time.
- **Cloudflare Worker Previews** (GA 2026-09-22). They create a Preview per branch with its own Durable Objects and delete it automatically. Rejected because:
  - Cron Triggers don't run in Previews, so ADR 0004's cost brake and ADR 0003's rollups would be dead;
  - KV and D1 are shared across every Preview, so PR 41's shards would write into the KV that PR 42 reads, and both would claim `canary`;
  - a Preview lives under the production Worker, so its token can deploy to production.
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
- **Deleting prod data needs the Operator's own token,** except through the `preview` token during the single-account phase. Nothing Cloudflare offers can undo a deletion. How Links and credentials are backed up belongs to [What is the Link data model across shards, KV, and Creator lists?](https://github.com/andrewferk/url-shortener/issues/14).
- **Ruleset and zone-setting changes can't be previewed until the split.** They are checked only by `tofu plan` in the PR.
- **Cloudflare sends no alert when something is deleted.** Audit Logs v2 records deletions for 18 months, but only through its API.
- **Two tools, one generated seam.** Adding a binding means adding an OpenTofu output and a line to the render script, never editing a Wrangler config by hand.
- **Grafana check changes and D1 schema migrations need approval,** because they run in `production-admin`.
