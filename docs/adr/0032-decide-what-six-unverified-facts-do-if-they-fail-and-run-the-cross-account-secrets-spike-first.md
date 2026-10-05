---
status: accepted
---

> Amended in place by [Spike: do environment secrets resolve across accounts inside a reusable workflow?](https://github.com/andrewferk/url-shortener/issues/91): the spike ran on 2026-10-05. Both rungs of the ladder failed. A third shape, not on the ladder, works and is the design: every reusable workflow declares the fixed names, required unless the contract marks one optional, and each ops repo's caller passes them by name. Reusable workflows stay, and the composite-action fallback is not taken.

# Decide what six unverified facts do if they fail, and run the cross-account secrets spike before any workflow is written

The PRD says every spike has its outcome decided in advance in the ADR named. The 2026-10-04 audit found six facts for which that was untrue. Each finding was checked against the ADR text:

- **Cross-account environment secrets. Holds.** [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md) names the spike and no outcome, and the PRD cited ADR 0015 for it. The whole secret contract rests on it.
- **R2 state locking under contention. Partly holds.** [ADR 0027](./0027-declare-durable-objects-with-exports-keep-gates-off-run-history-and-harden-state-encryption.md) has a runbook entry for one orphaned lock, and nothing for a lock that doesn't exclude.
- **Which command re-encrypts an unchanged state. Holds.** ADR 0027's rotation runbook waits on the spike, which has no outcome if no command does.
- **Whether `audit-read` can read Audit Logs v1. Holds.** [ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md) lists it as a `doctor` check. ADR 0016's printed fallbacks cover Audit Logs v2 only, and [ADR 0029](./0029-list-rulesets-and-routes-hourly-move-the-off-account-heartbeat-to-grafana-and-take-email-routing-off-the-production-token.md)'s Email Routing claim rests on the v1 line.
- **Whether a deploy with `--secrets-file` keeps the signing key. Holds.** ADR 0026 lists the check and also states "deploys leave it in place" as fact.
- **Whether the off-account target accepts a compliance retention from a key that can't read. Holds.** [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md) has `doctor` probe the key, and a refusal has no outcome.

The last three are `doctor` checks, not slice 1.6 spikes. So each of the six now has its outcome written down, the cross-account spike moves ahead of the work it could undo, and the `--secrets-file` check also becomes a spike.

The fallbacks rest on how GitHub Actions, OpenTofu, Wrangler and Object Lock are understood to behave. None was run. The spikes and `doctor` are what test them.

Decided in [Give the six spikes without a fallback a decided outcome](https://github.com/andrewferk/url-shortener/issues/82).

## Decision

### Cross-account environment secrets: the ladder failed, a third rung works, and reusable workflows stay

**What the spike found** (2026-10-05, [the write-up](https://github.com/andrewferk/url-shortener/issues/91#issuecomment-6004478902)):

- **Both rungs below failed.** The called job's secret was empty with bare names ([run](https://github.com/dad-incognito/xacct-secrets-spike-ops/actions/runs/37379086579)) and with the name declared as optional ([run](https://github.com/dad-incognito/xacct-secrets-spike-ops/actions/runs/37379179132)). A control, an ordinary job of the caller's own in the same environment, read it ([run](https://github.com/dad-incognito/xacct-secrets-spike-ops/actions/runs/37379025164)). Each job compared a hash of the secret, so a pass means the value arrived.
- **A third rung, which the ladder didn't name, works** ([run](https://github.com/dad-incognito/xacct-secrets-spike-ops/actions/runs/37380423993)), **and it is the design:**
  - the reusable workflow declares each fixed name under `on.workflow_call.secrets`, as in the second rung;
  - the caller passes each by name on its `uses:` line: `NAME: ${{ secrets.NAME }}`. In the caller that names a repo-level secret, which doesn't exist, so it passes nothing of value;
  - a called job that names an `environment` then reads that environment's secret under the name. GitHub's reusable-workflow docs say as much: the environment's secret is used, not the one passed.
- **The names are declared `required: true`,** except any the contract marks optional (`STATE_PASSPHRASE_PREVIOUS`). The third rung ran with the name optional. A fourth run declared it required and passed too ([run](https://github.com/dad-incognito/xacct-secrets-spike-ops/actions/runs/37382817625)): GitHub's required check accepts a name the caller passes with an empty value. GitHub documents that it refuses to start a run whose caller leaves a required secret out; the spike didn't run that case.
- **It is taken over composite actions** because an ops repo still pins one thing and holds no job graph. Everything in ADR 0016 stands except how the names reach the job.
- **What it changes:**
  - every reusable workflow declares the fixed names it reads, required unless the contract marks one optional;
  - every caller in `examples/ops-repo/` carries the same fixed `secrets:` map, and each ops repo copies it;
  - a release that adds a secret name changes the callers too, and says so under **Upgrading**. A caller whose map leaves out a required name doesn't start. A secret missing from the environment still arrives empty, so a job fails on an empty secret it requires and names it.
- **The ops repo holds no repo-level secret under a fixed name.** That was the spike's condition, and it keeps an environment the only source of each value.
- **What the spike didn't test:** it ran one job in one environment. That each job of a workflow which crosses environments reads its own environment's value is expected from the same mechanism, and the first such workflow shows it.
- **The composite-action shape below is not built.** It stays as the recorded alternative if GitHub changes this behaviour.

**The ladder as it was decided in advance:**

- **The spike tries two rungs inside reusable workflows,** with two throwaway public repos under two personal accounts (ADR 0016):
  1. a job that names an `environment` reads that environment's secrets by bare name, as ADR 0016 designs;
  2. the fixed names are also declared under `on.workflow_call.secrets` as optional, and the caller passes nothing.
- **The first rung that works is the design.** The second changes only the workflows' declarations; the secret contract and the ops repo are as ADR 0016 has them.
- **If both fail, this repo ships composite actions in place of reusable workflows.** A composite action runs inside the caller's own job, so the job's `environment` and its secrets resolve as in any workflow.
  - Each ops repo holds the four workflows themselves: the job graph, each job's `environment`, `permissions:` and concurrency group. Each job's steps are one composite action from this repo, pinned by SHA.
  - This repo keeps those workflows as a template in `examples/ops-repo/`, and the reference ops repo is a copy of it. The first job of every run fails if the ops repo's workflow files differ from the template at the pinned SHA.
  - The action's code is what the pin fetched, read from `github.action_path`. That replaces the checkout at `job.workflow_sha`, and there is still no second ref a caller can supply.
  - Dependabot still bumps the `uses:` lines. A release that changes the template says so under **Upgrading**, and the Operator copies the template in the same pull request as the bump.
  - The fixed secret names, `deployment.json`, the environments and the approvals don't change.
- **What the fallback costs:** an ops repo no longer pins one thing. It carries the job graph, so a reviewer of an ops repo reads workflow files and not only `uses:` lines, and the `permissions:` lint ([ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md)) runs against the template.
- **Repo-level secrets are not a fallback.** They would lose required reviewers per environment, which is the approval gate.

### That spike runs first

- **It is the first act of slice 1.4,** before any workflow is written. Slice 1.5 builds `deploy.yml` on the answer, and the fallback changes the shape of every workflow.
- **The other slice 1.6 spikes stay where they are.** None of their fallbacks reshapes work already done.

### R2 locking that fails under contention is removed

- **The spike applies twice at once against one state on R2.** It fails if both applies get the lock, or if a lock is left behind when nothing crashed.
- **If it fails, `use_lockfile` is removed and every job runs with `-lock=false`.** The concurrency groups, which ADR 0027 already calls the first guard, are then the only guard in CI.
- **The runbook then gains one rule:** the Operator never applies a state that CI also applies while a run is in progress. The hand-applied states have their own keys and no CI writer.
- **One orphaned lock is not a failure.** It stays ADR 0027's runbook entry, `tofu force-unlock` from the Operator's machine.

### Re-encrypting a state: the first of three commands that rewrites it

- **The spike tries, in order, against a state whose passphrase has moved to `fallback`:**
  1. `tofu apply -refresh-only`;
  2. `tofu state pull`, then `tofu state push` of the same file;
  3. an apply that changes a rotation marker.
- **The first that leaves the state readable by the new passphrase alone is what `reencrypt` runs,** and the runbook names it.
- **The third always works, because it is a real change.** Every root declares one `terraform_data` resource, the rotation marker, from the start. Its input is a number that `reencrypt` raises, so the apply has something to write. The marker is declared whether or not it turns out to be needed, since adding a resource later is itself a change to plan and approve.
- **`reencrypt` stays behind the usual one approval,** whichever command it runs.

### `audit-read` and Audit Logs v1

- **If `audit-read` can't read v1, it gains the narrowest permission that can,** and [ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md)'s description of the token says so. It stays a read-only, account-owned token.
- **If no account-owned token can read v1, the watch drops its v1 lines:**
  - the hourly integrity job lists the zone's Email Routing rules and destination addresses with `production-plan`'s Email Routing read, and fails on one the hand-applied configuration doesn't declare. This is ADR 0029's listing of rulesets and routes, applied to Email Routing. An added rule is then reported within an hour, plus GitHub's schedule lag, not within five minutes;
  - Data Studio SQL against `links-data` returns to ADR 0012's accepted gaps, beside SQL through `query/v2`.
- **`doctor` prints which of the three holds.**
- **A user-owned token is not a fallback.** It would tie the watch to a personal identity root.

### `--secrets-file` and the signing key

- **It is a spike as well as a `doctor` check.** The fact is about Wrangler and the same for every Operator, which is ADR 0016's rule for a spike. Slice 1.6 deploys a throwaway Worker that holds one hand-set secret with a `--secrets-file` that doesn't name it, and reads the secret list back.
- **If the hand-set secret survives, `links-data` deploys with `--secrets-file`,** carrying the secrets CI holds: `OPERATOR_GATE`, `OFFSITE_KEY_ID`, `OFFSITE_SECRET`.
- **If it is removed, `links-data` deploys without `--secrets-file`,** and the `admin` job pushes those secrets with `wrangler secret bulk` after the deploy, which adds and replaces and removes nothing. The new code runs for a moment with the previous deploy's `OPERATOR_GATE`; any gate works, since caller and callee read the same one. `redirect` and `status` keep `--secrets-file`, because every secret they hold comes from GitHub.
- **`doctor` runs the check only against a preview's `links-data`,** with a stand-in secret. Run against prod, a failure would destroy the key it tests. A Wrangler upgrade that changes the answer is caught there.
- **The signing key stays out of GitHub** either way.

### A target that refuses retention from a key that can't read

- **The fallback is the bucket's default retention:** compliance mode, 90 days, set by the Operator when creating the target. The push then sends no retention header.
- **`doctor` proves whichever mode the target is in:** an upload must succeed, and deleting that version and reading it back must both be refused. With per-`PUT` retention the upload carries one day; with default retention the probe object stays locked for the full 90 days, a few bytes.
- **`offsite_backup` gains an optional `retention` field,** `"per-put"` (the default) or `"bucket-default"`.
- **Default retention loses "a misconfigured target fails loudly":** a bucket whose default was never set accepts every `PUT` unlocked. `doctor`, and the monthly restore drill's rebuild case, are then what catch it.
- **A target that supports neither is not a conforming target.** `doctor` fails it, and `creators add` keeps refusing (ADR 0025).
- **The write key never gains read.** A key stolen from `links-data` could then read every backup.

## Cost

**$0** today and at peak. The spikes use throwaway repos, Workers and state keys. The listing fallback adds two read calls to the hourly integrity job.

## Considered options

- **Composite actions on any failure,** skipping the second rung. The second rung costs one more spike run and keeps ADR 0016 whole.
- **Composite actions once both rungs had failed,** as the ladder said. One more run found a shape that keeps reusable workflows for the price of a fixed `secrets:` map in each caller.
- **Declaring every name optional,** as the third rung ran. A caller that left a name out would then start, and fail only when a job read the empty secret.
- **Leaving the cross-account spike in slice 1.6.** It would run after slice 1.5 had built `deploy.yml` on the assumption.
- **Keeping `use_lockfile` whatever the spike finds.** A lock that doesn't exclude is worse than none, because it reads as a guard.
- **Rotating the passphrase only when an apply happens to be pending.** A rotation is by event (ADR 0027) and can't wait for one.
- **Accepting both v1 lines as gaps.** ADR 0029's claim that an added Email Routing rule is reported would then be false.
- **The signing key in the `production-admin` environment.** It breaks "never in GitHub" to work around a flag.
- **Leaving `--secrets-file` to `doctor` alone.** The first Operator to learn the answer would be one whose check had just removed a secret.
- **Giving the write key read on the target.** See above.

## Consequences

- **Amends ADR 0016:** the cross-account spike has its ladder and its fallback and runs first in slice 1.4; the `--secrets-file` spike joins the two GitHub spikes; the `admin` job's handling of `links-data`'s secrets is stated; the failed-check fallbacks cover Audit Logs v1.
- **Amends ADR 0027:** both spikes have outcomes, and every root declares the rotation marker.
- **Amends ADR 0026:** "deploys leave it in place" becomes a property the design keeps either way, and both `doctor` checks name their fallbacks.
- **Amends ADR 0025:** the retention fallback, `doctor`'s probe in either mode, and the `offsite_backup` field.
- **Amends ADR 0012 and ADR 0029:** what the watch and the Email Routing claim become if v1 can't be read.
- **The PRD:** slice 1.4 starts with the cross-account spike; slice 1.6 gains the `--secrets-file` spike and every fallback; the `doctor` table's three rows name theirs; the citation of ADR 0015 is corrected to ADR 0016.
- **The composite-action fallback is not taken, so ADR 0015's "pins this repo's reusable workflows" stands.** Its bullet on passing secrets, and ADR 0016's secret contract, say what the spike found.
- **No glossary term changes.**
