---
status: accepted
---

> Amended by [ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md): `deployment.json` gains `location_hints`; the `admin` job touches all 256 shards after deploying `links-data` and reports where each landed; the `plan` job fails when a hint differs from the one first applied.
>
> Amended by [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md): the `production-plan` token takes Metadata Read-Only in place of Workers Scripts Read and gains R2 read. The weekly drift job also plans the hand-applied backup bucket configuration, and fails when its own token has under 30 days left.
>
> Amended by [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md): `deployment.json` gains `offsite_backup`; the secret contract gains `OFFSITE_KEY_ID` and `OFFSITE_SECRET`; the restore drill gains a seventh case, a rebuild from the off-account copy against an R2 stand-in; `doctor` gains checks of the ruleset, the domain, 2FA and the write key.

# Deliver through reusable workflows called from each ops repo: plan read-only, apply behind at most one approval, and drill restores in a throwaway environment

[ADR 0015](./0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md) puts every deployment in its own ops repo, which calls this repo's reusable workflows at a pinned ref and holds the `production`, `production-admin` and `preview` GitHub environments. [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md) fixes what each credential can do and that `production-admin` and `preview` need the Operator's approval. This ADR decides the pipeline between them.

Three facts shaped it:
- **A reusable workflow can check out its own code at the exact commit the caller pinned,** through `job.workflow_repository` and `job.workflow_sha`. So an ops repo pins one ref, on its `uses:` lines, and nothing else.
- **Applying a pull request's `infra/env` runs that pull request's code with the `preview` token.** OpenTofu's `local-exec` and `terraform_data` are built in, so no provider allowlist can stop them. The "trusted deploy" of ADR 0015 protects the workflow's logic, not the token, and the Operator's review of the diff remains the gate until the account split.
- **Approval happens before a job runs.** Without a separate plan, every prod deploy would wait for an approval given blind.

Decided in [How does CI/CD deliver prod and previews?](https://github.com/andrewferk/url-shortener/issues/35).

## Decision

### Reusable workflows

This repo exports four, one per trigger shape. Each has a caller in `examples/ops-repo/`, changed in the same pull request.

| Workflow | Caller triggers | Does |
|---|---|---|
| `deploy.yml` | push to `main`, dispatch | Prod, then preview teardown |
| `preview.yml` | dispatch with `pr` and `sha` | One preview of one pull request commit |
| `preview-teardown.yml` | daily schedule, dispatch with optional `pr` | Removes closed, stale and broken previews |
| `restore-drill.yml` | monthly schedule, dispatch | Every ADR 0008 restore in a throwaway environment |

- **One input, `config-path`,** defaulting to `deployment.json`.
- **Secrets are a documented contract of fixed names.** A job that names an `environment` reads that ops-repo environment's secrets directly, since callers can't pass environment secrets. The names are `CLOUDFLARE_API_TOKEN`, `STATE_R2_KEY_ID`, `STATE_R2_SECRET`, `STATE_PASSPHRASE` and the Status Worker's read tokens.
- **Repo-level secrets are passed explicitly,** because `secrets: inherit` doesn't cross personal accounts. The only one is the status App's private key.
- **Code is checked out at `job.workflow_sha`,** never at a second ref the caller supplies.
- **Every caller sets `cache-mode: none`, and nothing restores a cache.** `workflow_dispatch` and `schedule` runs write to the default branch's cache scope, so untrusted build code could otherwise poison the cache a prod deploy restores.
- **The release workflow is private to this repo.**

### Committed config

- **An ops repo commits one `deployment.json`,** validated against a JSON Schema this repo ships.
- The workflows derive each root's tfvars and the render script's input from it. A bump that changes the contract fails validation before anything is planned.

### The render script

- **TypeScript, run with Node, always from the pinned ref,** previews included.
- **Inputs:**
  - one structured `infra/env` output, `workers`: each Worker's bindings, variables and routes;
  - `deployment.json`;
  - each Worker's checked-in `wrangler.base.jsonc`: `main`, compatibility settings, Durable Object classes and migrations, and Cron Triggers. In a preview it comes from the pull request, as data.
- **Output:** `.rendered/<worker>.<env>.jsonc`, with a do-not-edit header.
- **Guards** fail the run when:
  - a Worker isn't named `<name>`, `<name>-pr-<n>` or `<name>-drill`;
  - a route falls outside that environment's host template;
  - `links-data` has `workers_dev` or `preview_urls` set to anything but `false`;
  - a binding declared in the base config has no value.
- **`--local`** renders the configuration for local development.
- So a pull request that adds a binding previews without touching the script. One that changes the script previews with the pinned version.

### A new `production-plan` environment

- **No approval, `main` only, read-only credentials:**
  - a Cloudflare token with Workers Scripts, KV, D1, DNS and zone Read;
  - a read-only R2 key on the state bucket;
  - the state passphrase.
- **It plans `infra/zone` and `env/prod` with `-lock=false`** and saves both plans, encrypted with OpenTofu's `plan` encryption.
- It can delete nothing, so ADR 0007's rule that nothing unattended can delete holds.

### Prod: `deploy.yml`

1. **`build`** (no secrets): bundles each Worker and records its hash.
2. **`plan`** (`production-plan`): both plans, the `links-data` bundle hash compared with the deployed version's tag, and pending D1 migrations.
3. **`admin`** (`production-admin`), **only if something is pending:** apply the saved `env/prod` plan, then D1 migrations, then `links-data` with `--tag <sha>`. Most deploys skip it and need no approval. When one doesn't, the Operator approves a plan already shown in `plan`'s summary. A saved plan that has gone stale fails to apply.
4. **`prod`** (`production`): apply the saved zone plan, render, then deploy `redirect` and `status` with `--secrets-file` and `--tag <sha>`. Then the Canary link step, and a smoke test for up to 90 s:
   - the apex's Canary link Short URL answers 302 to its Target URL;
   - `status.` answers 200;
   - `api.` answers 401 to a request without a key.
5. **On a failed smoke test,** `wrangler rollback` returns `redirect` and `status` to their previous versions and the run fails. GitHub's failure email is the alert. `links-data` and OpenTofu are never rolled back automatically: Durable Object migrations block rollback, and data changes go forward only.
6. **`teardown`** of previews (below).

- `admin` runs before `prod` because `redirect` calls `links-data` and `status` reads D1.
- **The Canary link step** is ADR 0003's idempotent create through the Link API, as the operations Creator, with the job's GitHub OIDC token (ADR 0005).
- **The whole workflow is one concurrency group per prod account.** The newest pending run replaces an older one, and the latest `main` wins.

### Zone applies

- **Every job that applies a zone root joins the concurrency group `zone-<account_id>`.** OpenTofu's lockfile, with `-lock-timeout=5m`, is the second guard.
- **Today only `deploy.yml`'s `prod` job applies a zone.**
- **After the account split,** `deploy.yml` gains a `preview-zone` job in `preview` that applies the preview account's zone **before** prod's. Ruleset changes are then tried on the preview zone first, as ADR 0007 intended.

### Previews

- **Dispatched with `pr` and `sha`,** for example `gh workflow run preview -f pr=42 -f sha=<head>`. The run refuses if `sha` isn't the pull request's head, both at dispatch and just before deploy. Runs are named `preview pr-<n>`.
- **`build`:** no secrets, `permissions: {}`. It checks out the SHA, runs `npm ci`, and bundles the three Workers *and* the e2e suite into single files. Install scripts never run beside a token.
- **`deploy`:** one job in `preview`, so one approval per preview. In order:
  1. apply the pull request's `infra/env` as `env/pr-<n>`;
  2. render and guard;
  3. `wrangler deploy --no-bundle` the prebuilt bundles;
  4. the Canary link step;
  5. the e2e suite, run with `node` against `pr-<n>`, `pr-<n>-api` and `pr-<n>-status`.

  The suite authenticates as the operations Creator with the job's OIDC token (`environment=preview`, `aud` the preview's API origin), so ADR 0005 is unchanged. Moving it to its own job would isolate it from a token that pull-request code already holds, and would cost a second approval.
- **`report`:** no environment and no pull-request code. Through a GitHub App the Operator owns, installed only on this repo with only `statuses: write`, it sets the commit status `preview`:
  - `pending` when the run starts, so before approval;
  - `success` or `failure` after the e2e suite;
  - `target_url` points to the run, whose summary lists the preview's hostnames.

  Only the reference deployment's ops repo holds the App's key.
- **No poll yet.** While every preview needs the Operator's approval, a poll saves nothing. The account split adds a poll every 30 minutes for pull requests by allowlisted authors.
- **At most 5 previews are live.** A sixth dispatch is refused.

### Teardown

- **A no-secrets `find` job** lists the ops repo's `preview pr-<n>` runs and the pull requests' state. The teardown job, and its approval, runs only when there's something to remove:
  - a closed or merged pull request;
  - a preview not deployed for 7 days;
  - the leftovers of a failed apply.
- **Teardown follows ADR 0007's order and guards.** In the single-account phase each batch waits for one approval.
- **It runs daily and at the end of `deploy.yml`.** A public repo's schedules are disabled after 60 days without activity, and the end of `deploy.yml` still catches an ops repo that only deploys now and then.

### Plans and logs in a public ops repo

- **No plan is printed to the log.**
  - Each plan job writes a **job summary:** per root, a table of resource addresses and their actions, with replacements and deletions highlighted and no attribute values.
  - Full plans exist only as encrypted plan artifacts. They are kept for 1 day and deleted by the job that applies them. The runbook shows how to `tofu show` one locally with the passphrase.
- **Wrangler's output is left as it is:** version IDs and routes.
- **The ops repo keeps run logs for 30 days.**
- **Drift:** a weekly scheduled plan in `production-plan` with `-detailed-exitcode` fails on any drift, so GitHub emails the Operator.

### Restore drills

- **`restore-drill.yml` creates a fresh environment named `drill`,** from the pinned ref, never from a pull request. Its hostnames are `drill`, `drill-api` and `drill-status` on `preview_base_domain`, and its Workers are `<name>-drill`. It uses the `preview` environment, so it needs one approval in the single-account phase.
- **Seed:** 2,560 Links, 10 per shard, including Deleted links and Expired links.
- **Each ADR 0008 restore runs in turn, through the Operator CLI's Workflows:**
  1. one shard corrupted by break-glass SQL, then point-in-time recovery, the log and a reconcile;
  2. a rebuild from the log alone, standing in for corruption older than 30 days;
  3. `redirect-drill` and then `links-data-drill` deleted, then a redeploy and replay;
  4. `LINKS` destroyed, then a re-drive;
  5. the drill's backup bucket deleted, then a re-seed;
  6. `AUTH` deleted, then `restore`.
- **After each, it asserts that:**
  - every seeded Link answers as before (302 or 410);
  - every seeded Short code is refused as a Custom alias (409), so nothing is reissued;
  - Creator lists are complete;
  - `ops/` audit records exist;
  - no shard is left frozen.
- **Then it tears the environment down.** A failed drill fails the run, which emails the Operator.
- **This is the one exception to ADR 0010's "operations never run from GitHub Actions".** It is scoped to `drill`, with preview credentials. Prod operations still run only from the Operator's machine.

### Releases and bumps

- **`release.yml` in this repo** is dispatched with a `version`:
  - it refuses unless `main`'s CI is green;
  - it tags `main`'s HEAD;
  - it creates a GitHub Release with generated notes and a hand-written **Upgrading** section for any change to the config or secret contract.
- **Before 1.0, a breaking change to that contract bumps the minor version.**
- **Ops repos are bumped by Dependabot's `github-actions` ecosystem.** Operators take weekly tag bumps, and the reference ops repo takes daily `main` SHA bumps. Only the `uses:` lines change. The Operator merges each one by hand, because merging deploys.

### Facts checked at bootstrap

- **The Operator CLI gains `doctor`,** which the bootstrap runbook runs with the `operator` and `audit-read` tokens:
  - `operator` can create and read a Workflow instance of `links-data`. Workflows' create, event and update endpoints document only Workers Scripts Write, and whether a per-Worker scope covers them is undocumented.
  - `audit-read`, an account-owned token, can read `/logs/audit`. That is inferred, not documented.
  - toggling a preview bucket's lock appears in Audit Logs v2. R2's list of logged actions omits it.
- **Each failed check prints its documented fallback:** Editor over all Workers (ADR 0010), or ADR 0008's accepted risk (ADR 0012).
- **No design here depends on whether one approval covers several jobs waiting on the same environment.** Each run has at most one approved job per environment.

### The account split

A runbook, `docs/runbooks/preview-account-split.md`, carries ADR 0007's move in this order:
1. Tear down every preview with the old `preview` token.
2. Bootstrap the preview account: its state bucket, passphrase and tokens, and a zone or `workers.dev`.
3. Check whether the Rate Limiting binding works on Workers Free. If it does, the account stays Free. If not, it's $5/mo.
4. Update `deployment.json`'s preview section and the `preview` secrets.
5. Run `deploy.yml`, so `preview-zone` applies.
6. Revoke the old `preview` token in the prod account, and clear `audit_preview_token_id` (ADR 0012).
7. Remove `preview`'s required reviewers, and enable the poll.
8. Dispatch one preview to prove it.

ADR 0007's `creators add` check still makes the split happen before the first real Creator.

## Cost

**$0.**
- Public repos get Actions minutes, environments and required reviewers free.
- Previews, drills and the drift plan run within Workers Paid's included amounts and R2's free tier.
- A preview account after the split costs $0 or $5/mo, as ADR 0007 already allows.

## Considered options

- **One reusable workflow per GitHub environment, or one dispatcher with a `mode` input.** Environments don't map to triggers: a prod deploy crosses three of them. A dispatcher would hide which jobs a caller can run.
- **A second ref input for the code checkout.** It duplicates the `uses:` ref, and the two could drift. `job.workflow_sha` makes it unnecessary.
- **`production-admin` on every deploy, or two approvals (plan, then apply).** Approving blind on every deploy, or twice per change.
- **Isolating the e2e suite in a secret-less `preview-e2e` environment.** It would amend ADR 0005's `environment` claim and add a second approval, to keep test code away from a token the pull request's `infra/env` already holds.
- **A provider allowlist to make the pull request's `infra/env` safe.** `local-exec` and `terraform_data` are built in.
- **Running the untrusted build in this repo's own pull-request CI.** That CI builds the merge commit, not the approved head SHA, and fetching its artifact cross-repo needs another credential.
- **Printing full plans to the public log.** Nothing in them is secret, but logs stay terse and the summary is what an approval needs.
- **Gradual rollout of `redirect` gated on the smoke test.** It adds version pinning for little gain at this scale.
- **A poll for previews before the split.** Every preview still waits for the Operator's approval.
- **Running drills by hand.** They'd be skipped. A drill that never runs proves nothing.
- **release-please or changesets.** They need conventional commits, which this repo doesn't use.
- **Renovate.** It can do the same bumps, but Dependabot needs no App and only `uses:` lines change.

## Consequences

- **Amends ADR 0007:**
  - a fourth GitHub environment, `production-plan`, with a read-only token created in `infra/bootstrap`;
  - `infra/env`'s Worker outputs become one structured `workers` output;
  - the render script's guards also accept a `drill` environment;
  - after the split, the preview account's zone is applied by `deploy.yml` before prod's.
- **Amends ADR 0010:** restore drills run Operator operations from GitHub Actions, in `drill` only.
- **Amends ADR 0012:**
  - the `production-plan` token joins the protected token IDs;
  - its bootstrap checks run as `doctor`.
- **Amends ADR 0015:**
  - the pull request's `infra/env` runs arbitrary pull-request code with the `preview` token;
  - the render script is generic over `infra/env`'s outputs, so previews of new bindings need no script change.
- **A pull request that changes the render script, a reusable workflow or a guard can't be previewed as changed.** Those always come from the pinned ref.
- **The secret names and `deployment.json`'s schema are a public contract.** Changing them is a breaking release.
- **Previews of the author's own pull requests stay one command plus one approval** until the split.
