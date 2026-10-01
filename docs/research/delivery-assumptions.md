# Delivery assumptions: what GitHub and OpenTofu actually document

Research for [#46](https://github.com/andrewferk/url-shortener/issues/46), a child of the map in [#1](https://github.com/andrewferk/url-shortener/issues/1). It checks the GitHub Actions and OpenTofu assumptions behind [ADR 0016](../adr/0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md), [ADR 0015](../adr/0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md) and the state section of [ADR 0007](../adr/0007-opentofu-wrangler-split-links-data-worker-account-isolation.md), raised by the [provider review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5941721651) and the [security review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5942073170).

This document states facts only. The choice is made in "How does delivery change: Durable Object `exports`, retention-proof gates, state encryption and OpenTofu version?" ([#58](https://github.com/andrewferk/url-shortener/issues/58)).

**Checked 2026-10-01.** Every source was fetched that day, directly: GitHub docs as raw Markdown through `docs.github.com/api/article/body?pathname=…` (and the HTML page where the "Who can use this feature?" box was needed), changelog posts with `curl`, OpenTofu docs from the `v1.13` and `v1.12` branches of `opentofu/opentofu`, Cloudflare docs as `index.md`, and issues and source through `gh`. Nothing came through a summarising fetcher.

Each claim carries one label:

- **Confirmed**: the source says so, quoted.
- **Contradicted**: the source says otherwise, quoted.
- **Not documented**: no source found, with what a `doctor` check or spike would have to test.
- **Inference**: reasoned from a named source, not stated by it.

## Summary

| # | Assumption or review claim | Finding | Review right? |
|---|---|---|---|
| G1 | Since 2026-10-01 the Actions retention setting also deletes checks and commit statuses | **Confirmed.** Also deletes workflow runs, and covers statuses from third-party Apps | Yes |
| G2 | Retention periods | **Confirmed.** Default 90 days, minimum 1 day, maximum 90 days for a public repo and 400 for a private one. The docs split by repo visibility, not by plan | n/a |
| G3 | A job that names an `environment` in a reusable workflow reads the caller repo's environment secrets | **Confirmed** for the mechanism. **Not documented** for a caller in another account | Yes ("docs agree with the ADR") |
| G4 | actions/runner#4453 | Open, unlabelled, unassigned, no maintainer reply. One report, one outside commenter disputing it. Same-repo reproduction only | Yes, as stated |
| G5 | `secrets: inherit` doesn't cross personal accounts | **Inference.** Docs name only "the same organization or enterprise" | n/a |
| G6 | Dependabot needs at least one version tag in the code repo before it bumps a SHA pin | **Inference from source, and it holds.** With no version tag the SHA pin is never updated. The docs sentence on untagged commits doesn't mention this | Yes |
| G7 | Immutable releases close most of the gap for an Operator who pins a tag | **Confirmed** that the tag can't be moved or deleted while the release exists. GitHub's hardening page still calls a SHA "the only way" | Mostly; see G7 |
| G8 | Hardening: SHA pins, read-only `GITHUB_TOKEN`, private vulnerability reporting, rulesets on a free public repo | **Confirmed**, all available at $0 | Yes |
| G9 | `tofu_wrapper: false` | **Confirmed** as the README's advice for exit-code trouble. **Inference from source:** with the wrapper on, `-detailed-exitcode`'s exit 2 does not fail the step, so ADR 0016's drift plan would not fail | Yes |
| O1 | The design omits `enforced` | `enforced` is **confirmed** as an optional setting that stops unencrypted writes when the environment configuration is missing | Yes |
| O2 | "The docs suggest a key per state" | **Partly.** The recommendation is new in the 1.13 docs and is worded for key management systems only. Nothing is said about a shared `pbkdf2` passphrase | Overstated |
| O3 | Rotation with `fallback` | **Confirmed** as documented, in generic form. No worked `pbkdf2` example, and nothing on when every state has been re-encrypted | Yes |
| O4 | `tofu plan -lock=false` with a read-only state credential is undocumented | **Not documented.** The backend docs list only the full read-write-delete permission set | Yes |
| O5 | `use_lockfile` on R2 is documented by neither vendor | **Confirmed as undocumented for the pair.** Each half is documented: OpenTofu uses `If-None-Match`, R2 lists it as supported on `PutObject`. An OpenTofu maintainer declined an R2 lock bug as possibly "partial compatibility on the R2 backend" | Yes |
| O6 | 1.12.x support ends 2027-02-01; 1.13 is out | **Confirmed** | Yes |
| O7 | Committing `.terraform.lock.hcl` hash-checks provider binaries | **Confirmed**, as trust on first use, with hashes for all platforms since 1.12 | Yes |

**No review claim was found to be wrong.** One was overstated (O2), and two findings go beyond what the reviews said: the wrapper swallowing exit code 2 (G9), and OpenTofu issue #4405 (O5).

---

## GitHub

### G1. The retention change of 2026-10-01

**Confirmed: the setting now deletes checks, workflow runs and commit statuses as well as artifacts and logs.**

- Changelog, 2026-10-01, ["Actions retention now covers checks, runs, and statuses"](https://github.blog/changelog/2026-10-01-actions-retention-now-covers-checks-runs-and-statuses/):
  > "checks, workflow runs, and statuses are now governed by the same GitHub Actions retention setting that controls how long artifacts and logs are kept. These records are automatically cleaned up when they exceed the retention period configured for your enterprise, organization, or repository. This applies to checks and statuses created by GitHub Actions and third-party applications."
- The announcement, dated 2026-08-27 ([changelog](https://github.blog/changelog/2026-08-27-actions-retention-will-cover-checks-workflow-runs-and-statuses/); the 2026-07-17 URL the docs link to redirects to it):
  > "Until now, checks, workflow runs, and statuses were retained for 400+ days regardless of your retention configuration."

  > "The change is not retroactive. Adjusting your retention setting will not restore data that was previously evicted due to a retention policy."
- Docs, [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-repository):
  > "These retention policies apply to checks data, including check suites and check runs, and to commit statuses, including those created by third-party integrations. The policies are not limited to data created by GitHub Actions."

The review's "stale fact" row for ADR 0016 was right.

**What it means for the three things ADR 0016 reads.** These are inferences from the quotes above; GitHub documents no behaviour specific to them.

- **The teardown `find` job** lists the ops repo's `preview pr-<n>` workflow runs. Workflow runs are now deleted at the ops repo's retention period. ADR 0016 sets that repo to keep logs for 30 days, and the same setting now covers runs. A preview whose last run is older than the period has no run left to list.
- **The release gate** "refuses unless `main`'s CI is green". CI's check runs on `main`'s HEAD are deleted at the code repo's retention period (90 days at most for a public repo). If HEAD is older than that, there is no check to read.
- **The `preview` commit status** is set by a GitHub App. Statuses from third-party Apps are covered, so it is deleted at the code repo's retention period.

**Not documented:**

- How soon after the period a record is removed, and whether the REST API returns 404 or an empty list for a commit whose checks and statuses are gone.
- How a required status check behaves on a pull request whose checks have been deleted.
- Whether a workflow run is deleted while its environment deployment record survives.

A spike would set a test repo's retention to 1 day and read `GET /repos/{owner}/{repo}/actions/runs`, `/commits/{ref}/check-runs` and `/commits/{ref}/status` two days later.

### G2. Minimum, default and maximum periods

**Confirmed**, same docs page:

> "By default, checks, workflow runs, commit statuses, and the artifacts and log files generated by workflows are retained for 90 days before they are automatically deleted."

> "For public repositories: you can change this retention period to anywhere between 1 day or 90 days. For private repositories: you can change this retention period to anywhere between 1 day or 400 days."

> "When you customize the retention period, it only applies to new checks, workflow runs, commit statuses, artifacts, and log files, and does not retroactively apply to existing objects. For managed repositories and organizations, the maximum retention period cannot exceed the limit set by the managing organization or enterprise."

| Repo | Minimum | Default | Maximum |
|---|---|---|---|
| Public (any plan) | 1 day | 90 days | 90 days |
| Private | 1 day | 90 days | 400 days, or the organisation's or enterprise's cap |

**The docs do not split these by plan** (Free, Pro, Team). The only axes are repo visibility and an organisation or enterprise cap. Both the code repo and a public ops repo are capped at 90 days.

A related change, 2026-09-25 ([changelog](https://github.blog/changelog/2026-09-25-changes-to-query-results-in-the-github-actions-api-and-ui/)): workflow-run queries filtered by workflow, event, status, branch or actor still page up to 1,000 items, and report "2,500+" instead of an exact count above 2,500.

### G3. Environment secrets in a reusable workflow

**Confirmed for the mechanism.** [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-inputs-and-secrets-in-a-reusable-workflow):

> "Environment secrets cannot be passed from the caller workflow as `on.workflow_call` does not support the `environment` keyword. If you include `environment` in the reusable workflow at the job level, the environment secret will be used, and not the secret passed from the caller workflow."

[Reusing workflow configurations](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations) adds that the run belongs to the caller:

> "When a reusable workflow is triggered by a caller workflow, the `github` context is always associated with the caller workflow."

And the [Secrets reference](https://docs.github.com/en/actions/reference/security/secrets):

> "Organization and repository secrets are read when a workflow run is queued, and environment secrets are read when a job referencing the environment starts."

So the review's "GitHub's docs agree with the ADR" is right.

**Not documented:** that this works when the reusable workflow lives in a public repo owned by a *different account* from the caller. No page states it either way. The sentence quoted in runner#4453 ("If a called workflow needs to access environment secrets, the environment must be defined in the called workflow") is not on the page today; the warning above is the current wording.

A spike would be two throwaway public repos under two personal accounts: the caller with an environment `e` holding `MY_SECRET` and no `secrets:` block on the calling job, the reusable workflow with a job `environment: e` that prints the secret's length. Then repeat with a required reviewer on `e`. ADR 0015 already says "the delivery pipeline confirms how this resolves for a caller in another account".

### G4. actions/runner#4453

Read with `gh issue view 4453 --repo actions/runner --comments` on 2026-10-01. [Issue](https://github.com/actions/runner/issues/4453).

- **Title:** "[BUG] Environment-scoped secrets unreachable from reusable workflow without secrets: inherit, despite called job declaring environment".
- **State:** open. Opened 2026-05-26, last updated 2026-05-28. No labels, no assignee, no linked pull request.
- **Report:** caller and reusable workflow in the *same* repo, with the environment name passed as an input (`environment: ${{ inputs.target_environment }}`). Every environment secret resolved to an empty string until the caller added `secrets: inherit`. The reporter notes that protection rules and `vars` did take effect.
- **Replies:** one, from a user with no association to the repo, who argues this is by design ("The secrets are always defined by the caller") and cites the `secrets: inherit` syntax entry. No GitHub maintainer has replied.

So the issue is one unconfirmed report, contradicted by one outside commenter, with no word from GitHub. The review described it accurately. Its bearing on ADR 0016 is an **inference**: the reported workaround, `secrets: inherit`, is documented only for one organisation or enterprise (G5), so if the report is accurate there is no documented fallback for a caller in another account. The cross-account case is not what the issue reproduces. The G3 spike settles it.

### G5. `secrets: inherit` across personal accounts

[Workflow syntax, `jobs.<job_id>.secrets.inherit`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idsecretsinherit):

> "Use the `inherit` keyword to pass all the calling workflow's secrets to the called workflow. This includes all secrets the calling workflow has access to, namely organization, repository, and environment secrets. The `inherit` keyword can be used to pass secrets across repositories within the same organization, or across organizations within the same enterprise."

**Inference:** two personal accounts are neither. The docs never mention personal accounts, including the case where one user owns both repos, which is the reference deployment's. ADR 0016's "`secrets: inherit` doesn't cross personal accounts" is therefore an inference, not a quoted fact. The G3 spike can test it in the same run.

### G6. Dependabot bumping a SHA pin that tracks `main`

**Confirmed: Dependabot updates `uses:` lines for reusable workflows, and SHA pins.** [Supported ecosystems, GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories#github-actions):

> "Dependabot only supports updates to GitHub Actions using the GitHub repository syntax, such as `actions/checkout@v6` or `actions/checkout@<commit>`. Dependabot will ignore actions or reusable workflows referenced locally (for example, `./.github/actions/foo.yml`)."

> "If the commit you use is not associated with any tag, Dependabot will update the GitHub Actions to the latest commit (which might differ from the latest release)."

**Not documented:** that the repo must have at least one version tag. The second sentence reads as if an untagged SHA pin always follows the latest commit.

**Inference from source: the review was right.** In `dependabot/dependabot-core` at `main` (HEAD `1cba13e`, 2026-10-01), [`github_actions/lib/dependabot/github_actions/package/package_details_fetcher.rb`](https://github.com/dependabot/dependabot-core/blob/main/github_actions/lib/dependabot/github_actions/package/package_details_fetcher.rb):

```ruby
if git_commit_checker.pinned_ref_looks_like_commit_sha? && latest_version_tag
  latest_version = tag_version(T.must(latest_version_tag))
  return unless latest_version.is_a?(Dependabot::Version)
  return latest_commit_for_pinned_ref unless git_commit_checker.local_tag_for_pinned_sha

  return latest_version
end
```

and [`update_checker.rb`](https://github.com/dependabot/dependabot-core/blob/main/github_actions/lib/dependabot/github_actions/update_checker.rb):

```ruby
def latest_commit_sha(source_checker, finder)
  latest_tag = finder.latest_version_tag
  return unless latest_tag
```

Reading these:

- **No version tag in the code repo:** `latest_version_tag` is nil, both paths return nothing, and the SHA pin is never bumped.
- **At least one version tag, pinned SHA not itself tagged:** the bump goes to the head of the branch that contains the pinned commit. That is the daily `main` bump ADR 0016 wants.
- **Pinned SHA is itself the commit of a version tag:** `local_tag_for_pinned_sha` is set, so the bump goes to the newest version tag's commit, not to `main`'s head. ADR 0016's `release.yml` "tags `main`'s HEAD", so after a release the reference ops repo's pin can be a tagged commit. It would then wait for the next tag instead of following `main`.

All three are readings of source, not documented behaviour. A spike would be a throwaway code repo and ops repo: check for a bump with no tag, with one tag behind the pin, and with the pin on the tagged commit.

### G7. Immutable releases, for an Operator who pins a tag

**Confirmed.** [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases):

> "**Git tags cannot be moved**: Once an immutable release is published, its associated Git tag is locked to a specific commit, cannot be changed, and cannot be deleted while the release exists. If you delete the immutable release, you can delete the tag, but you cannot reuse the same tag name."

> "Only the assets and tag are locked. You can still edit the title and release notes of a published immutable release, and change whether it is marked as a pre-release or as the latest release."

> "creating an immutable release automatically generates a **release attestation**, which is a cryptographically verifiable record of a release containing the release tag, commit SHA, and release assets."

> "Even if you delete a repository and create a new one with the same name, you cannot reuse tags that were associated with immutable releases in the original repository."

[Preventing changes to your releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes): it is a repository setting, "Enable release immutability", and "immutability will only apply to future releases".

What the guarantee does not cover:

- **A tag without a published release.** The lock starts when the release is published. ADR 0016's `release.yml` tags first and creates the release second, so the tag is movable in between (inference from "Once an immutable release is published").
- **Releases published before the setting was switched on.**
- **GitHub's own hardening advice still names only SHAs.** [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions):
  > "Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release."

  > "Note that there is risk to this approach even if you trust the author, because a tag can be moved or deleted if a bad actor gains access to the repository storing the action."

  That page does not mention immutable releases. The review's "enabling immutable releases closes most of the gap" is consistent with the immutable-releases page, and is not a statement GitHub makes.
- **The Operator can't require it from their side.** The repository policy "Require actions to be pinned to a full-length commit SHA" exempts reusable workflows: "Reusable workflows can still be referenced by tag." ([docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#managing-github-actions-permissions-for-your-repository))

### G8. Hardening for jobs that hold secrets

**Pin third-party actions by SHA. Confirmed** as GitHub's recommendation, quoted in G7. [Find and customize actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/find-and-customize-actions#using-release-management-for-your-custom-actions) adds: "We recommend that you use a SHA value when using third-party actions. However, it's important to note Dependabot will only create Dependabot alerts for vulnerable GitHub Actions that use semantic versioning." The security review's finding 5 was right that this is the recommended practice. The repository policy that enforces it covers actions and exempts reusable workflows (G7).

**Default `GITHUB_TOKEN` permission. Confirmed.**

- [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use): "It's good security practice to set the default permission for the `GITHUB_TOKEN` to read access only for repository contents. The permissions can then be increased, as required, for individual jobs within the workflow file."
- [Repository settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#setting-the-permissions-of-the-github_token-for-your-repository): "By default, when you create a new repository in your personal account, `GITHUB_TOKEN` only has read access for the `contents` and `packages` scopes." The same section: "Anyone with write access to a repository can modify the permissions granted to the `GITHUB_TOKEN` ... by editing the `permissions` key in the workflow file."
- [Reusing workflow configurations](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations): "If `jobs.<job_id>.permissions` is not specified in the calling job, the called workflow will have the default permissions for the `GITHUB_TOKEN`." and "The `GITHUB_TOKEN` permissions passed from the caller workflow can be only downgraded (not elevated) by the called workflow."

So a new ops repo on a personal account already defaults to the restricted setting. An older repo may not; the setting is under Settings, Actions, General, "Workflow permissions".

**Private vulnerability reporting. Confirmed** as available. [Configuring private vulnerability reporting for a repository](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository): "Owners and administrators of public repositories can allow security researchers to report vulnerabilities securely in the repository by enabling private vulnerability reporting." It is off until enabled, under Settings, Advanced Security. ADR 0015's `SECURITY.md` sends reports there, so the setting has to be on for that route to exist (inference).

**Branch protection and rulesets on a public repo on a personal account. Confirmed** as available on GitHub Free.

- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets): "Rulesets are available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, and GitHub Enterprise Cloud." and "Push rulesets are available for the GitHub Team plan in internal and private repositories".
- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): "Protected branches are available in public repositories with GitHub Free and GitHub Free for organizations."
- Limits on a personal account, same page: "You can enable branch restrictions in public repositories owned by a GitHub Free organization and in all repositories owned by an organization using GitHub Team or GitHub Enterprise Cloud." Restricting who can push is an organisation feature. And: "By default, the restrictions of a branch protection rule do not apply to people with admin permissions to the repository".

Environment features, re-checked because ADR 0015 leans on them. [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments): "If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, required reviewers are only available for public repositories." and "If you are using GitHub Free, environment secrets are only available in public repositories." ADR 0015's plan table holds.

Two newer items that touch the same surface:

- **Artifacts in a public repo.** [Downloading workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts): "People who are signed into GitHub and have read access to a repository can download workflow artifacts." For a public ops repo that is any signed-in user, which confirms the security review's "Encrypted plans are public downloads".
- **`pull_request_target` default rule**, 2026-09-17 ([changelog](https://github.blog/changelog/2026-09-17-workflow-execution-protections-in-github-actions-generally-available/)): "For public repositories that do not already have an applicable event policy, GitHub is introducing a default rule that disables `pull_request_target`", enforced from 2026-11-02. ADR 0015 uses no such trigger.

### G9. `tofu_wrapper: false` in `setup-opentofu`

**Confirmed** as the action's own advice. [`opentofu/setup-opentofu` README](https://github.com/opentofu/setup-opentofu#readme) (latest release v2.0.2, 2026-06-29):

> "Having trouble with exit codes or the output format? Try setting the `tofu_wrapper` setting to `false`."

> "`tofu_wrapper` - (optional) Whether to install a wrapper to wrap subsequent calls of the `tofu` binary and expose its STDOUT, STDERR, and exit code as outputs named `stdout`, `stderr`, and `exitcode` respectively. Defaults to `true`."

The README gives no security reason. Two consequences follow from the above and from the wrapper's source, [`wrapper/tofu.js`](https://github.com/opentofu/setup-opentofu/blob/main/wrapper/tofu.js); both are **inferences**:

- **The drift plan would not fail.** The wrapper treats exit code 2 as success:
  ```js
  if (exitCode === 0 || exitCode === 2) {
    // A exitCode of 0 is considered a success
    // An exitCode of 2 may be returned when the '-detailed-exitcode' option
    // is passed to plan. This denotes Success with non-empty
    // diff (changes present).
    return;
  }
  ```
  ADR 0016's weekly drift plan relies on `-detailed-exitcode` failing the job. With the default wrapper it would pass, and `exitcode` would only be a step output. [setup-opentofu#42](https://github.com/opentofu/setup-opentofu/issues/42), "Does not honor -detailed-exitcode", is open.
- **Every `tofu` call's full stdout and stderr become step outputs.** ADR 0016 keeps plan text out of the log.

---

## OpenTofu

Docs quoted are the `v1.13` branch of [`opentofu/opentofu`](https://github.com/opentofu/opentofu/tree/v1.13/website/docs), which is what opentofu.org serves by default. Differences from the `v1.12` branch are called out.

### O1. `enforced`

**Confirmed** as an optional setting. [State and plan encryption](https://opentofu.org/docs/language/state/encryption/):

> "If you use environment configuration, you can include the following code configuration to prevent unencrypted data from being written in the absence of an environment variable:"
> ```hcl
> terraform {
>   encryption {
>     state {
>       enforced = true
>     }
>     plan {
>       enforced = true
>     }
>   }
> }
> ```

The sample for a new project lists it as a step: "Step 5: Consider adding the \"enforced\" option". That is all the page says about it. `state` and `plan` are separate blocks, and each takes its own `method`, `fallback` and `enforced`.

Two related statements on the same page:

> "You can configure encryption in OpenTofu either by specifying the configuration in the OpenTofu code, or using the `TF_ENCRYPTION` environment variable. Both solutions are equivalent and if you use both, OpenTofu will merge the two configurations, overriding any code-based settings with the environment ones."

> "encryption does not protect against data loss (your state file getting damaged) and it also does not protect against replay attack (an attacker using an older state or plan file and tricking you into running it)."

The review's claim that ADR 0007 and ADR 0016 don't mention `enforced` is right: neither does.

### O2. Key providers, and one key per state versus a shared passphrase

**Confirmed for `pbkdf2`:**

> "The PBKDF2 key provider allows you to use a long passphrase as to generate a key for an encryption method such as AES-GCM."

| Option | Minimum | Default |
|---|---|---|
| `passphrase` | 16 characters | none |
| `iterations` | 200,000 | 600,000 |
| `key_length` | 1 | 32 bytes |
| `salt_length` | 1 | 32 bytes |
| `hash_function` | `sha256` or `sha512` | `sha512` |

The built-in key providers on the page are `pbkdf2`, `aws_kms`, `gcp_kms`, `azure_vault`, `openbao` and `external`. Only `pbkdf2` and `external` need no cloud key service.

**Confirmed for AES-GCM**, the only method:

> "AES-GCM is a secure, industry-standard encryption algorithm, but suffers from \"key saturation\". In order to configure a secure setup, you should either use a key-derivation key provider (such as PBKDF2) with a long and complex passphrase, or use a key management system that automatically rotates keys regularly. Using short, static keys will degrade your encryption."

**The per-state recommendation is scoped to key management systems.**

> "If you use a key management system (AWS KMS, GCP Cloud KMS, Azure Key Vault, or OpenBao), use a separate key for each state file rather than sharing one key across many states."

> "We recommend provisioning a dedicated key management key per state file rather than sharing a single key across many states. A distinct key per state keeps the states cryptographically isolated from one another and lets you scope access to each state independently through your key management system's access controls, which limits the blast radius if any single key or credential is compromised."

- Both passages are **new in the 1.13 docs**. A diff of `encryption.mdx` between the `v1.12` and `v1.13` branches shows them added; the 1.12 page has no per-state advice at all.
- **Not documented:** any advice for or against one `pbkdf2` passphrase across several states. The page doesn't say whether each file gets its own salt, though a `salt_length` option exists.

So the review's "the docs suggest a key per state" is **overstated** for this design. The docs suggest it for KMS keys. Applying the same reasoning to a passphrase shared by `env/prod`, every `env/pr-<n>` and `infra/zone` in one bucket is an inference.

On the security review's "Encrypted plans are public downloads ... the passphrase is the only barrier": confirmed in substance. The artifact is downloadable (G8), and the plan file "does contain your full configuration, all of the values associated with planned changes, and all of the plan options including the input variables" ([`tofu plan`](https://opentofu.org/docs/cli/commands/plan/)). The docs' requirement is a "long and complex passphrase", 16 characters at least. They give no entropy figure.

### O3. Rotation with `fallback`

**Confirmed** as the documented procedure, "Key and method rollover":

> "In some cases, you may want to change your encryption configuration. This can include renaming a key provider or method, changing a passphrase for a key provider, or switching key-management systems. OpenTofu supports an automatic rollover of your encryption configuration if you provide your old configuration in a `fallback` block"

> "If OpenTofu fails to **read** your state or plan file with the new method, it will automatically try the fallback method. When OpenTofu **saves** your state or plan file, it will always use the new method and not the fallback."

> "Once your data is encrypted, do not rename key providers and methods in your configuration! The encrypted data stored in the backend contains metadata related to their specific names. Instead, use a fallback block to handle changes to key providers. Alternatively, you can specify a unique metadata storage key in the `encrypted_metadata_alias` field on the key provider"

The documented example is generic: a new method as `method`, the old one inside `fallback`, in both `state` and `plan`.

**Inference:** a passphrase change needs two `key_provider "pbkdf2"` blocks and two `method "aes_gcm"` blocks under different names, the old pair referenced from `fallback`.

**Not documented:**

- A worked `pbkdf2` rotation.
- When the `fallback` can be removed. Each state is re-encrypted only when OpenTofu next saves it, so with one passphrase per bucket every state in the bucket has to be written once first. Whether an `apply` with no changes rewrites the state object is not stated.
- That a saved plan encrypted with the old passphrase still applies after rotation. The `plan` block's `fallback` implies it.

A spike would rotate the passphrase on a two-state bucket and check each object decrypts with the new passphrase alone.

### O4. `tofu plan -lock=false` with a credential that can only read the state object

**Not documented.** The review was right.

What is documented:

- [`tofu plan`](https://opentofu.org/docs/cli/commands/plan/): "`-lock=false` - Don't hold a state lock during the operation. This is dangerous if others might concurrently run commands against the same workspace."
- [State locking](https://opentofu.org/docs/language/state/locking/): "OpenTofu will lock your state for all operations that could write state." and "You can disable state locking for most commands with the `-lock` flag but it is not recommended."
- [S3 backend](https://opentofu.org/docs/language/settings/backends/s3/), "S3 Bucket Permissions": "OpenTofu will need the following AWS IAM permissions on the target backend bucket: `s3:ListBucket` ... `s3:GetObject` ... `s3:PutObject` ... `s3:DeleteObject`". No reduced set for planning is given.
- [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/): "Object Read only: Allows the ability to read and list objects in specific buckets."

**Inference:** with locking on, a read-only key would fail at the lock's `PutObject`, which is why ADR 0016 plans with `-lock=false`. Nothing documents that `tofu init` and `tofu plan -out` make no other write to the backend.

A `doctor` check or spike would run, with an Object Read only key scoped to the state bucket: `tofu init`, then `tofu plan -lock=false -out=…` against an existing encrypted state, then `tofu plan -lock=false -detailed-exitcode`. It should also cover a state last written by an older OpenTofu patch release, and a first plan where no state object exists yet.

### O5. `use_lockfile` on the S3 backend against R2

**Each half is documented. The combination is documented by neither vendor.** The review was right, and ADR 0007's "R2 supports the conditional writes that locking needs" is accurate as far as the header goes.

- **OpenTofu, confirmed.** [S3 backend](https://opentofu.org/docs/language/settings/backends/s3/):
  > "This backend supports multiple locking mechanisms. The preferred one is a native S3 locking via conditional writes with `If-None-Match` header. This can be enabled by setting `use_lockfile=true`."

  The page names only Amazon S3. The design RFC, [`rfc/20250211-s3-locking-with-conditional-writes.md`](https://github.com/opentofu/opentofu/blob/main/rfc/20250211-s3-locking-with-conditional-writes.md), warns:
  > "When OpenTofu S3 backend is used with an S3 compatible provider, it needs to be checked that the provider supports conditional writes in the same way AWS S3 is offering."
- **Cloudflare, confirmed.** [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) lists, under `PutObject`: "✅ Conditional Operations: ✅ If-Match ✅ If-Modified-Since ✅ If-None-Match ✅ If-Unmodified-Since". The same row lists `x-amz-tagging` as not implemented, so the backend's `lock_tags` option can't work on R2 (inference).
- **Cloudflare's backend guide doesn't mention locking.** [Remote R2 backend](https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/) (last updated 2026-04-21) gives the flags ADR 0007 calls "Cloudflare's documented R2 flags": `region = "auto"`, `skip_credentials_validation`, `skip_metadata_api_check`, `skip_region_validation`, `skip_requesting_account_id`, `skip_s3_checksum`, `use_path_style` and `endpoints`. It has no `use_lockfile`, and it tells the reader to create a token with "Object Read & Write".

**OpenTofu issue #4405**, which the reviews did not cite. ["s3 backend with `use_lockfile`: a lock acquisition can 412 against the lock it just created, and never releases it"](https://github.com/opentofu/opentofu/issues/4405):

- Reported on OpenTofu 1.12.1 against R2 with the configuration above. A scheduled `tofu plan` got `412 PreconditionFailed` on its own lock and left a `.tflock` object behind. The reporter saw it once in 34 runs over three weeks, and the orphaned lock blocked every later operation for two days until someone deleted it by hand.
- A maintainer first replied: "per the R2 docs, it does not support the required Lock API endpoints". The reporter answered that the code uses `If-None-Match`, which R2 lists as supported.
- Closed as not planned on 2026-09-09, with the fix pull requests closed unmerged: "Maintainers discussed this and agreed that this is not an issue that should be fixed on our side ... the issue might be in the aws-sdk or might be given by a partial compatibility on the R2 backend."

Facts that follow for ADR 0016, as **inference**: locking on R2 works in the common case, per that report; a lost response can orphan the lock; clearing it needs a write-capable key, which `production-plan` doesn't hold; and plans run with `-lock=false` are not blocked by an orphaned lock, while the `admin` and `prod` applies are.

**Not documented:** that R2's conditional `PutObject` is atomic under concurrent writers in the way the lock needs. A spike would race two `tofu apply` runs on one state, and check `tofu force-unlock`.

### O6. Release support policy, 1.12.x and 1.13

**Confirmed.** OpenTofu states support per series at the top of each branch's `CHANGELOG.md`. Its [`RELEASE.md`](https://github.com/opentofu/opentofu/blob/main/RELEASE.md) says: "The support period will be documented in CHANGELOG.md for the corresponding version by OpenTofu Maintainers." and "We do not currently have a fixed release cycle."

| Series | Supported until | Latest release |
|---|---|---|
| 1.12.x ([changelog](https://github.com/opentofu/opentofu/blob/v1.12/CHANGELOG.md)) | "February 1 2027" | 1.12.7, 2026-10-01 |
| 1.13.x ([changelog](https://github.com/opentofu/opentofu/blob/v1.13/CHANGELOG.md)) | "August 1 2027" | 1.13.1, 2026-10-01; 1.13.0 was 2026-09-30 |
| 1.14.x ([`main`](https://github.com/opentofu/opentofu/blob/main/CHANGELOG.md)) | "February 1 2028" | unreleased |

The review's "1.12.x support ends 2027-02-01, and 1.13 is out" is right. ADR 0007 pins 1.12.x.

**What 1.13.0 changes that touches this stack**, from its changelog:

- "Saved plan files now include the provider schemas needed to render the plan, so `tofu show` on a plan file no longer needs to launch the providers where possible." ADR 0016's runbook shows an encrypted plan with `tofu show`.
- "`tofu plan` no longer prints the explanatory paragraph that followed the \"No changes. Your infrastructure matches the configuration.\" message". This matters only to anything that parses plan text.
- "`errored.tfstate` is now produced if OpenTofu encounters a Go runtime panic."
- "Using `-backend=false` during `tofu init` now skips reading the local encrypted state". This is the `tofu validate` path in the code repo's CI.
- "The `local-exec` provisioner now automatically sets the `TRACEPARENT` environment variable in child processes when OpenTelemetry tracing is active".
- Encryption: new optional arguments on `aws_kms`, `gcp_kms` and `openbao` only. Nothing changes for `pbkdf2` or `aes_gcm`. The per-state key advice in O2 arrived with the 1.13 docs.
- Upgrade notes: `base64gzip` output changes; WinRM provisioner connections are removed; macOS 13 or later is required; 1.13 is the last series with 32-bit builds.
- **The changelog lists no change to the S3 backend or to `use_lockfile`.**
- 1.13.1 fixes "`tofu show -json <planfile>` now works again when ephemeral resources are present in the configuration."

The encryption page's compatibility guarantee: "We will support all key providers and methods as documented for +1 minor version ... If we deprecate a key provider or method, you will receive a warning on the console when running `tofu plan` or `tofu apply`."

### O7. `.terraform.lock.hcl`

**Confirmed.** [Dependency lock file](https://opentofu.org/docs/language/files/dependency-lock/):

- **Commit it:** "You should include this file in your version control repository so that you can discuss potential changes to your external dependencies via code review".
- **Scope:** "At present, the dependency lock file tracks only *provider* dependencies. OpenTofu does not remember version selections for remote modules".
- **Version pinning:** "If a particular provider already has a selection recorded in the lock file, OpenTofu will always re-select that version for installation, even if a newer version has become available."
- **Hash check:** "OpenTofu will also verify that each package it installs matches at least one of the checksums it previously recorded in the lock file, if any, returning an error if none of the checksums match".
- **It is trust on first use:** "This checksum verification is intended to represent a *trust on first use* approach."
- **Across platforms:** "If you install a provider from an origin registry which provides checksums, OpenTofu will treat all of the checksums as valid as long as one checksum matches the installed package. The lock file will therefore include checksums for both the package you installed for your current platform *and* any other packages that might be available for other platforms."

  > "When installing a particular provider for the first time ... OpenTofu will pre-populate the `hashes` value with all checksums reported by the registry, which usually covers all of the available packages for that provider version across all supported platforms. The OpenTofu Registry (as of OpenTofu v1.12) provides a comprehensive set of `zh` (Zip Hash) and `h1` (Hash Scheme 1) hashes."

  The 1.12 changelog says the same: "`tofu init` now includes a full set of checksums for all supported platforms when updating a dependency lock file ... This should remove the need to run `tofu providers lock` in many situations where it was previously required."
- **Signatures are optional:** "If you wish to restrict this behavior to only providers that are signed with a cryptographic signature, you can set `OPENTOFU_ENFORCE_GPG_VALIDATION` to `true`."
- **In CI:** [`tofu init -lockfile=readonly`](https://opentofu.org/docs/cli/commands/init/): "suppress the lockfile changes, but verify checksums against the information already recorded. It conflicts with the `-upgrade` flag."

Both reviews were right: no ADR mentions the file, and committing it makes `tofu init` reject a provider package whose hash isn't recorded. The lock file lives in each root's directory, so `infra/bootstrap`, `infra/zone` and `infra/env` each have one.

---

## Open questions for a spike or `doctor`

None of these is answered by a vendor's docs.

1. **Environment secrets across accounts** (G3, G4, G5): does a job with `environment:` in a reusable workflow from account A read that environment's secrets in a caller repo owned by account B, with no `secrets:` block? Does `secrets: inherit` work when one user owns both repos?
2. **Retention behaviour** (G1): what the runs, check-runs and status endpoints return after the period, and how soon.
3. **Dependabot** (G6): the three tag cases, on real repos.
4. **Read-only planning** (O4): `tofu init` and `tofu plan -lock=false -out` with an R2 Object Read only key.
5. **R2 locking** (O5): two concurrent applies, and recovery from an orphaned `.tflock`.
6. **Passphrase rotation** (O3): whether an `apply` with no changes re-encrypts the state, across every state in a bucket.
7. **Wrapper and exit codes** (G9): confirm that a drift plan with `-detailed-exitcode` fails the job only with `tofu_wrapper: false`.

## Sources

All fetched 2026-10-01.

**GitHub**

- Changelog: [2026-10-01 retention now covers checks](https://github.blog/changelog/2026-10-01-actions-retention-now-covers-checks-runs-and-statuses/), [2026-08-27 announcement](https://github.blog/changelog/2026-08-27-actions-retention-will-cover-checks-workflow-runs-and-statuses/), [2026-09-25 query results](https://github.blog/changelog/2026-09-25-changes-to-query-results-in-the-github-actions-api-and-ui/), [2026-09-17 execution protections](https://github.blog/changelog/2026-09-17-workflow-execution-protections-in-github-actions-generally-available/)
- Docs: [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [retention for an organization](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization), [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [Reusing workflow configurations](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [Secrets reference](https://docs.github.com/en/actions/reference/security/secrets), [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use), [Find and customize actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/find-and-customize-actions), [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Manage environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [Downloading workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts), [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases), [Preventing changes to your releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes), [Dependabot supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories), [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- Issues and source: [actions/runner#4453](https://github.com/actions/runner/issues/4453); `dependabot/dependabot-core` at `1cba13eb9dd75447fcb6e2d11541b0aab1f4490a`: `github_actions/lib/dependabot/github_actions/update_checker.rb`, `package/package_details_fetcher.rb`, `containing_branch_finder.rb`, `common/lib/dependabot/git_commit_checker.rb`

**OpenTofu**

- Docs, `v1.13` branch, with `v1.12` diffed for the encryption page: [State and plan encryption](https://opentofu.org/docs/language/state/encryption/), [S3 backend](https://opentofu.org/docs/language/settings/backends/s3/), [`tofu plan`](https://opentofu.org/docs/cli/commands/plan/), [`tofu init`](https://opentofu.org/docs/cli/commands/init/), [State locking](https://opentofu.org/docs/language/state/locking/), [Dependency lock file](https://opentofu.org/docs/language/files/dependency-lock/)
- Repo: `CHANGELOG.md` on [`v1.12`](https://github.com/opentofu/opentofu/blob/v1.12/CHANGELOG.md), [`v1.13`](https://github.com/opentofu/opentofu/blob/v1.13/CHANGELOG.md) and [`main`](https://github.com/opentofu/opentofu/blob/main/CHANGELOG.md); [`RELEASE.md`](https://github.com/opentofu/opentofu/blob/main/RELEASE.md); [S3 locking RFC](https://github.com/opentofu/opentofu/blob/main/rfc/20250211-s3-locking-with-conditional-writes.md); [issue #4405](https://github.com/opentofu/opentofu/issues/4405); the [releases list](https://github.com/opentofu/opentofu/releases)
- `opentofu/setup-opentofu`: [README](https://github.com/opentofu/setup-opentofu#readme), [`wrapper/tofu.js`](https://github.com/opentofu/setup-opentofu/blob/main/wrapper/tofu.js), [issue #42](https://github.com/opentofu/setup-opentofu/issues/42)

**Cloudflare**

- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/), [Remote R2 backend](https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/)

**Could not be fetched or found**

- A GitHub docs page stating how environment secrets resolve for a reusable workflow called from another account. None was found.
- `gh search issues` returned nothing for Dependabot issues about SHA pins in a repo without tags, so no issue is cited for G6; the finding rests on the source alone.
