---
status: accepted
---

> Amended by [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md): applying a pull request's `infra/env` runs arbitrary pull-request code with the `preview` token, because OpenTofu's `local-exec` and `terraform_data` are built in. The trusted deploy protects the workflow's logic, and the Operator's review remains the gate until the split. The render script is generic over `infra/env`'s outputs, so a preview that adds a binding needs no script change. Reusable workflows check out their own code at `job.workflow_sha`, so an ops repo pins only its `uses:` lines. Another account's caller passes repo-level secrets explicitly, and environment secrets resolve by name from the ops repo's own environments.
>
> Amended by [ADR 0025](./0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md): the ops repo's `main` carries a ruleset shipped in `examples/ops-repo/` (no force pushes, no deletion, changes by pull request), and every reusable workflow and example caller declares a minimal `permissions:` block, checked by a lint.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): the test package is `@cloudflare/vitest-plugin`, and `createTestHarness()` replaces `unstable_startWorker()`. Immutable releases are enabled, and tag pins are cited as a deliberate deviation from GitHub's SHA-pin advice. Private vulnerability reporting is switched on. The alert address is an alias.

# License under Apache-2.0, keep this repo free of credentials, and run every deployment from its own public ops repo

The project is headed for open source, and this repo is already public, with no licence. It should be embeddable, and must not foreclose a SaaS built on it. [ADR 0013](./0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md) makes every deployment value an input, and the author's instance a deployment like any other Operator's.

Until now, [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md) put the deploy credentials in GitHub environments of *the* repo, and [ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)'s OIDC trust rule names that repo's `repository_id`. A public repo takes pull requests from forks, and until previews move to their own account, the `preview` token can delete prod. So this repo holds no credentials at all. Each deployment, the author's included, runs from its own **ops repo**, which calls this repo's reusable workflows.

Decided in [How is the project open-sourced: licence, repo contents, and packaging?](https://github.com/andrewferk/url-shortener/issues/34).

## Decision

### Licence and contributions

- **Apache-2.0,** with `LICENSE` and `NOTICE` at the root and no per-file headers. It is permissive, so embedding as a library has no friction, and its patent grant protects embedders.
- **No CLA and no DCO.** Apache-2.0's section 5 already makes contributions inbound = outbound.
- **`CONTRIBUTING.md`**, plus a **`SECURITY.md`** that sends vulnerability reports to GitHub private security advisories. Private vulnerability reporting is switched on in the repo's settings; it is off by default.
- **The name stays `url-shortener`,** with the workspace scope `@url-shortener/*`, until something is published to npm.

### This repo holds no credentials

- **It holds:**
  - the domain core, the three Workers and their adapters;
  - `infra/` (`bootstrap`, `zone`, `env`, `modules`), the render script and the Operator CLI;
  - **reusable workflows** (`on: workflow_call`) for deploys, previews and restore drills;
  - docs, ADRs and the Link API's OpenAPI document;
  - **`examples/ops-repo/`:** the skeleton an Operator copies, with caller workflows and a config file of placeholder values. A change to a reusable workflow and to its example caller lands in one pull request.
- **Its own CI** runs lint, unit tests of the core under Node, the Workers' integration tests in local `workerd` (`@cloudflare/vitest-plugin`, the new name of `@cloudflare/vitest-pool-workers`), and `tofu validate`. A test that needs a whole running Worker starts it with Wrangler's `createTestHarness()`, which replaces the deprecated `unstable_startWorker()`. It does not replace the plugin. It has no secrets, so a fork's pull request can run all of it safely. It is the required check.
- **ADR 0013's ban on deployment values** in code, ADRs and committed config applies to this repo. The README describes the reference deployment without naming it. Its link lives only in the GitHub repo's Website field.

### Every deployment runs from its own ops repo

- **An ops repo** holds:
  - caller workflows, which `uses:` this repo's reusable workflows at a pinned ref;
  - the deployment's **committed, non-secret config:** `base_domain`, `preview_base_domain`, account IDs, the alert address (an alias, not a personal mailbox, because the repo is public), the Grafana stack, Objective and cost-brake overrides;
  - the `production`, `production-admin` and `preview` **GitHub environments**, with their secrets, deployment-branch rules and required reviewers.
- **It is the trust root.**
  - ADR 0005's `repository_id` is the ops repo's, because a reusable workflow's OIDC token carries its caller's repository.
  - The `environment` claim and the `main`-only rule refer to the ops repo's environments and its `main`.
- **The reference ops repo is public.** On GitHub's Free, Pro and Team plans, a private repo can't use required reviewers, and on Free it gets no environment secrets or deployment-branch rules either. Those are what ADR 0005 and ADR 0007 rely on, and a public repo gets all of them for free.
  - **It holds no code.** No workflow in it runs on `pull_request`, only on `push` to `main`, `workflow_dispatch` and `schedule`. So a fork's pull request can't run anything.
  - **Its run logs, artifacts and config are public.** That covers the domain, account and resource IDs, and plan output. None of them are secrets, secrets are masked in logs, and ADR 0007 keeps them out of state. How plans are surfaced, while keeping logs terse, is a delivery decision.
  - An Operator with GitHub Enterprise, which allows required reviewers in private repos, may keep their ops repo private. `examples/ops-repo/` documents the plan constraints.

### Refs

- **Semver tags** (`v0.x.y`), cut from `main`, are the release line for Operators. Dependabot or Renovate opens bump pull requests in an ops repo.
- **Immutable releases are enabled on this repo,** so a released tag can't be moved, and can't be reused if its Release is deleted. That is what makes a tag pin safe. It is a knowing deviation: GitHub says "Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release", and warns that a tag "can be moved or deleted if a bad actor gains access to the repository". Operators get tags because update bots follow them, and an Operator can't enforce SHA pins on a reusable workflow from their side anyway. The lock starts when the Release is published, so `release.yml` publishes the Release in the same run that creates the tag.
- **The reference ops repo tracks `main` by commit SHA,** through automated bump pull requests. Merging one deploys prod, so every change is dogfooded before it's tagged.

### Previews of pull requests

- **A preview is started from the ops repo** for one pull request at one exact head SHA, behind the `preview` environment's approval. A new push is a new SHA, so it needs a new dispatch and a new approval.
- **The build is untrusted:** a job with no secrets checks out that SHA, installs, bundles, and hands the bundle on as an artifact.
- **The deploy is trusted:** a reusable workflow and render script from the ops repo's pinned ref, not from the pull request, apply `env/pr-<n>` and deploy the prebuilt bundle.
- **The pull request's own `infra/env` still runs with the `preview` token.** Until previews have their own account (ADR 0007), the Operator's review of the diff before approving is the gate.
- **Results return to the pull request as a commit status,** through a GitHub App installed on this repo with only `statuses: write`. Its key lives in the ops repo.
- How dispatches are made, the end-to-end suite, and the teardown of closed and stale previews belong to the delivery pipeline.

### Packaging

- **The domain core is its own workspace package,** `@url-shortener/core`:
  - the Workers import it only through its `exports` map, never by deep path;
  - a lint rule blocks `cloudflare:*` imports and Workers types, as [ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md) requires;
  - it never depends on another unpublished workspace package.
- **Nothing is published to npm yet.** Embedders take a git dependency. Publishing later only adds a release job, a semver policy and a name; it breaks no import.

## Cost

$0. Public repos get GitHub Actions minutes, environments and required reviewers free.

## Considered options

- **MIT.** It has no patent grant, which embedders of infrastructure value.
- **AGPL-3.0.** It would deter others' closed SaaS. But it makes library embedding hard, and the author keeps the right to run a SaaS only with a CLA once outside contributions arrive.
- **Source-available licences** (BSL, Elastic, FSL). They aren't open source, and they put embedders off.
- **This repo holds the GitHub environments.** It's free and keeps every feature, but it puts Cloudflare credentials, including one that can delete prod, in the repo that takes forks' pull requests. Fork pull requests get no secrets anyway, so the only gain is automatic previews of the author's own branches.
- **Prod from an ops repo, previews from this repo.** It keeps the most dangerous token in the public repo.
- **A private ops repo on GitHub Pro ($4/mo).** It has environment secrets and branch rules, but no required reviewers, so each dispatch would have to stand in for ADR 0007's approval. The $4 also breaks ADR 0013's worst-month budget.
- **A private ops repo on GitHub Free.** It has no environments, so every workflow would see every secret, and the OIDC `environment` claim would disappear.
- **Pinning by git submodule or a vendored copy.** It's clumsier than a reusable workflow at a ref, and update bots handle it less well.
- **Publishing the core to npm now, or the core and the Cloudflare adapters.** It's release work and a public API to keep stable before anyone has asked to embed.
- **A DCO sign-off.** It adds friction for contributors and gives little a single maintainer needs.

## Consequences

- **Amends ADR 0005:** the OIDC trust rule's `repository_id`, `environment` claim and `main`-only rule all belong to the ops repo.
- **Amends ADR 0007:** the GitHub environments, their secrets and their approvals live in the ops repo. The render script and `infra/` roots run from this repo's code, at the ops repo's pinned ref.
- **Amends ADR 0013:** its ban on committed deployment values covers this repo. An ops repo commits its own non-secret config.
- **The author's own pull requests don't preview on push.** Each preview is a dispatch. The delivery pipeline may add a poll in the ops repo for pull requests by an allowlisted author, without changing the rule that previews start there.
- **Another Operator's ops repo passes secrets to the reusable workflows explicitly.** `secrets: inherit` works only within one organisation or enterprise, and environment secrets aren't passed across `workflow_call` at all: a job in the reusable workflow that names an `environment` uses that environment's secrets. The delivery pipeline confirms how this resolves for a caller in another account.
- **Relicensing later needs every contributor's consent,** because there is no CLA.
