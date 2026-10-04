# Audit gap premises: what Cloudflare, Wrangler and OpenTofu actually do

Research for [Confirm the Cloudflare and Wrangler behaviour three audit gaps rest on](https://github.com/andrewferk/url-shortener/issues/77). It blocks [#79](https://github.com/andrewferk/url-shortener/issues/79) (gaps 3 and 11) and [#81](https://github.com/andrewferk/url-shortener/issues/81) (gap 9).

Researched 2026-10-04. Nothing here was run against a Cloudflare account. Every answer carries one of three labels:

- **Documented**: a primary source says it; the URL and the quoted line are given.
- **Inferred from source**: read off source code or an API schema, not stated in prose anywhere.
- **Unknown, needs a spike**: no primary source settles it.

## Summary

| Gap | Premise | Verdict |
| --- | --- | --- |
| 3 | A plan reports nothing for a rule in an undeclared ruleset phase, or for an undeclared Workers Route | **Holds** (inferred from documented plan semantics; no source says it in so many words) |
| 11 | A token with Email Routing edit can add a destination address and get it verified without the account owner | **Partly holds, one step undetermined.** Adding the address and pointing a rule at it are documented. Whether the emailed link verifies without a Cloudflare login is not documented. A second path the gap didn't name, routing to a Worker, needs no verified address at all. |
| 9 | `links-data` can no longer carry `--tag` once it declares `exports` | **Fails** (inferred from Wrangler source plus the documented upload API). `wrangler deploy --tag` sends the tag on the same request that carries `exports`. An end-to-end spike is still worth its few minutes. |
| (9) | ADR 0027: "`wrangler versions upload` fails on a config with `exports` entries" | **Documented, and contradicted by Wrangler's source and changelog.** Cloudflare's own pages disagree with each other. |

## Sources and versions

- Cloudflare docs, fetched 2026-10-04 as `…/index.md` from developers.cloudflare.com.
- Cloudflare API schema: `openapi.json` on `main` of [cloudflare/api-schemas](https://github.com/cloudflare/api-schemas), fetched 2026-10-04. Token permissions below are each operation's `x-api-token-group`, which is what the API reference prints as "Accepted Permissions (at least one required)".
- Wrangler: [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk) at commit `f025bbfddcdab0193bffffc9fe5a9bf143f2fa65` (2026-10-03), `wrangler` 4.147.0.
- Cloudflare Terraform provider docs on `main` of [cloudflare/terraform-provider-cloudflare](https://github.com/cloudflare/terraform-provider-cloudflare).
- OpenTofu docs at opentofu.org.

## 1. Rulesets and routes outside the declared set (gap 3)

### Does `tofu plan` report an undeclared ruleset or route?

**No. Inferred from documented plan semantics.** A plan refreshes the objects already in state and compares configuration with that state. It never lists what else exists on the zone.

> By default, when OpenTofu creates a plan it: Reads the current state of any already-existing remote objects to make sure that the OpenTofu state is up-to-date. Compares the current configuration to the prior state and noting any differences. Proposes a set of change actions that should, if applied, make the remote objects match the configuration.
>
> [opentofu.org/docs/cli/commands/plan](https://opentofu.org/docs/cli/commands/plan/)

The OpenTofu page says nothing about objects that are in neither state nor configuration, so "reports nothing" is a reading of that description, not a quoted statement.

What that means per resource:

- **A rule added to a phase the configuration declares** shows as drift. The rule list is an attribute of the declared `cloudflare_ruleset`, and Cloudflare allows one entry point ruleset per phase: "Each phase has at most one entry point ruleset at the account level and at the zone level." ([Ruleset Engine: rulesets](https://developers.cloudflare.com/ruleset-engine/about/rulesets/))
- **A rule added in a phase the configuration doesn't declare** lives in a different ruleset object, which is not in state. The plan shows nothing.
- **A Workers Route the configuration doesn't declare** is a separate object, not in state. The plan shows nothing. A declared route that is edited or deleted does show.

So the redirect phases matter most: Single Redirects are the zone entry point of `http_request_dynamic_redirect`. Declaring that phase's ruleset, even empty, puts it in state. Whether an empty `cloudflare_ruleset` applies cleanly and then reports an added rule as drift is **unknown, needs a spike** (the provider docs don't say).

### Which calls list everything, and with what permission?

**Documented** (API schema and API reference).

| What | Call | Accepted permissions (any one) |
| --- | --- | --- |
| Every ruleset on the zone, all phases | `GET /zones/{zone_id}/rulesets` | Any Read or Write group of a rulesets product. The list includes `Dynamic URL Redirects Read`, `Zone WAF Read`, `Config Settings Read`, `Cache Settings Read`, `Origin Read`, `Zone Transform Rules Read`, `Transform Rules Read`, `Custom Errors Read`, `Response Compression Read`, `Managed headers Read`, `Sanitize Read`, `HTTP DDoS Managed Ruleset Read`, `Bot Management Read`, `Mass URL Redirects Read`, `Account Rulesets Read`, `Account WAF Read`, `Select Configuration Read`, `Magic Firewall Read`, `L4 DDoS Managed Ruleset Read`, `Logs Read`, and each one's Write twin. `Zone Read` is not in the list. |
| One phase's rules | `GET /zones/{zone_id}/rulesets/phases/{ruleset_phase}/entrypoint` | Same list |
| One ruleset's rules | `GET /zones/{zone_id}/rulesets/{ruleset_id}` | Same list |
| Every Workers Route on the zone | `GET /zones/{zone_id}/workers/routes` | `Workers Routes Read` or `Workers Routes Write` |

Two details the hourly job would need:

- The list call returns no rules. "A list of rulesets. The returned information will not include the rules in each ruleset." ([List zone rulesets](https://developers.cloudflare.com/api/resources/rulesets/methods/list/)) Each ruleset's `id`, `kind`, `phase`, `version` and `last_updated` come back, so the job either fetches each ruleset, or compares the set of `(phase, id, version)` with what `main` expects. It is paginated with `cursor` and `per_page` (1 to 50).
- The route list returns `id`, `pattern` and `script` for each route. ([List Worker Routes](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/))

The provider wraps both as data sources, so the comparison could live in OpenTofu instead of a script: [`cloudflare_rulesets`](https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/data-sources/rulesets.md) ("The returned information will not include the rules in each ruleset") and [`cloudflare_workers_routes`](https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/data-sources/workers_routes.md) ("Accepted Permissions: `Workers Routes Read`, `Workers Routes Write`").

**Unknown, needs a spike:** whether one of those permission groups shows every phase, or only the phases of its own product. The schema gives the same list for every phase and says nothing more.

### Not asked, but the same hole

Rulesets and routes aren't the only way to answer for the short domain. Each of these is its own API object, so an undeclared one is as invisible to a plan as an undeclared ruleset. Listed from the API schema; not investigated further.

- Page Rules (forwarding URL): `GET /zones/{zone_id}/pagerules`, `Page Rules Read`.
- Workers Custom Domains: `GET /accounts/{account_id}/workers/domains`, `Workers Scripts Read`.
- Snippets and snippet rules: `GET /zones/{zone_id}/snippets`, `Snippets Read`.
- Bulk Redirects: account-level rulesets (`http_request_redirect`) plus lists, so `GET /accounts/{account_id}/rulesets`.
- DNS records on the zone.

Whether the `production` token can write any of them depends on the exact permission groups ADR 0007 gives it.

### What it means for gap 3

**The premise holds.** ADR 0026's line "The drift plan … catches a redirect rule … whoever made the change" is true only for phases and routes `infra/zone` declares. Both remedies the gap names are available: declare every phase, or list and compare. The list calls exist and need only read permissions. If #79 picks listing, it should say which of the other objects above the job also lists.

## 2. Email Routing destination addresses (gap 11)

### Which permission adds a destination address?

**Documented.** `Email Routing Addresses Write`, an account-level permission.

> Create a destination address to forward your emails to. Destination addresses need to be verified before they can be used.
>
> `POST /accounts/{account_id}/email/routing/addresses`, accepted permission `Email Routing Addresses Write`. [Create a destination address](https://developers.cloudflare.com/api/resources/email_routing/subresources/addresses/methods/create/)

ADR 0011 gives the `production` token "Email Routing permissions … the zone's rules and the account's destination addresses", so it holds this permission.

### How is a new address verified, and can the mailbox owner do it alone?

**Documented:** Cloudflare emails the new address, and the address is verified by a click in that email. No step by the account owner is described.

> Cloudflare sends a verification email to that address. Open the email and select **Verify email address** to activate it.
>
> Until a destination address is verified, any routing rule that points to it stays disabled.
>
> [Email routing rules and addresses](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/)

**Unknown, needs a spike:** whether that link works for someone who is not logged in to the Cloudflare account. No Cloudflare page says either way. A web search turned up a secondary claim that the link lands in the dashboard and wants a login; it is not a primary source and is not relied on here. This is the one fact gap 11 turns on.

**Inferred from the API schema:** the token cannot verify the address itself, with one loose end.

- There is no "verify" operation. The address endpoints are create, list, get, delete, and one `PATCH`.
- `PATCH /accounts/{account_id}/email/routing/addresses/{id}` ("Updates the status of a specific destination address", `Email Routing Addresses Write`) takes a `status` of `unverified` or `verified`, described as: "Destination address status. Non-admin callers may only set verified addresses back to unverified; setting to verified requires admin privileges." The provider's [`cloudflare_email_routing_address`](https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/email_routing_address.md) carries the same sentence.
- What "admin" means there is **unknown, needs a spike**. If it means Cloudflare staff, the token can't self-verify. If it means an account role, an API token made by a Super Administrator might count.

The spike is small: with a token holding only the `production` token's Email Routing permissions, add an address in a mailbox the Operator doesn't use, try the `PATCH` to `verified`, then open the emailed link in a browser with no Cloudflare session.

### Can the same token point a rule or the catch-all at it?

**Documented**, given the zone permission `Email Routing Rules Write`, which ADR 0011 also gives the `production` token.

- `POST /zones/{zone_id}/email/routing/rules` and `PUT /zones/{zone_id}/email/routing/rules/{rule_identifier}`: `Email Routing Rules Write`. "Forward actions require exactly one verified destination address."
- `PUT /zones/{zone_id}/email/routing/rules/catch_all`: `Email Routing Rules Write`. "Enable or disable catch-all routing rule, or change action to forward to a specific destination address. Forward actions require exactly one verified destination address."

So forwarding needs a verified address, as ADR 0026 says. But destination addresses are "shared at the account level and can be reused with any other domain in your account" (same page as above), so any address already verified on the account is a valid target without a new verification.

### A path that needs no verified address

**Documented.** A rule's action isn't only `forward`. The schema's action type is `drop`, `forward` or `worker`, and the docs say "a routing rule pairs an email pattern with a destination — either a verified email address or a Worker". The `production` token deploys `redirect` and `status` and can write routing rules, so it can point `abuse@` or the catch-all at a Worker it controls, and that Worker can read each message and send its contents anywhere with `fetch`. No destination address is added or verified. Whether the `production` token's per-Worker edit permission lets it add an `email` handler to `status` and bind a rule to it is the same question ADR 0024 already asks of that token; it was not tested here.

### Does adding or verifying an address appear in Audit Logs?

**Documented for Audit Logs v1.**

> The following Email Routing actions are recorded: Add, edit, or delete a routing rule. Add or delete a destination address. Change the status of a destination address (for example, from pending to verified). Update the catch-all rule. Enable, disable, or unlock the zone for Email Routing.
>
> [Email Service: audit logs](https://developers.cloudflare.com/email-service/observability/audit-logs/) (the old `/email-routing/get-started/audit-logs/` URL lands here; last updated 2026-06-09)

That page's "Cloudflare audit logs" and "Review audit logs" links both go to [Review audit logs - v1](https://developers.cloudflare.com/fundamentals/account/account-security/review-audit-logs/).

**Unknown for v2, needs a spike.** The [Audit Logs v2](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/) page says only "Audit Logs covers ~95% of Cloudflare products, capturing actions from key endpoints, such as `/accounts`, `/zones`, `/user`, and `/memberships` APIs", with no product list. The address and rule calls are under `/accounts` and `/zones`, so v2 probably records them, but nothing says so. This matches ADR 0026's wording that only v1 documents them.

Both versions are read with `Account Settings Read` (`GET /accounts/{account_id}/audit_logs` for v1, `GET /accounts/{account_id}/logs/audit` for v2).

### What it means for gap 11

**The premise partly holds, and the deciding step is undetermined.**

- Holds: the token can add its own destination address and, once it is verified, point any rule or the catch-all at it.
- Undetermined: whether the attacker can complete verification from the new mailbox alone.
- ADR 0026's claim "can't quietly redirect it" is overstated whichever way the spike goes, because of the Worker action above, and because any address already verified on the account can be used.
- Detection exists and is documented: v1 Audit Logs record the added address, its change to verified, and every rule and catch-all change. ADR 0026 already polls v1 for these. Routing to a Worker also shows as a rule change there.

## 3. `wrangler deploy --tag` with `exports` (gap 9)

### Does `wrangler deploy --tag` work on a Worker with `exports`?

**Yes, inferred from source plus the documented upload API. Not stated end to end anywhere, so a spike is cheap insurance.**

`wrangler deploy` has two upload paths. A Worker with Durable Object `exports` takes the older one-request path, exactly as a Worker with pending `migrations` does:

- [`packages/deploy-helpers/src/deploy/deploy.ts`](https://github.com/cloudflare/workers-sdk/blob/f025bbfddcdab0193bffffc9fe5a9bf143f2fa65/packages/deploy-helpers/src/deploy/deploy.ts), lines 417 to 434: the versions-and-deployments path is used only when, among other things, `migrations === undefined && !hasDurableObjectExports(config.exports)`. Otherwise Wrangler sends one `PUT /accounts/{account_id}/workers/scripts/{script_name}`.
- Same file, lines 380 to 385: the upload metadata gets `annotations: { "workers/message": props.message, "workers/tag": props.tag }` before the path is chosen, so both paths carry the tag.
- The pull request that added the flag says so: "In the 2-step deploy flow, annotations are sent on the version upload and the message is also sent on the deployment. In the legacy 1-step flow, both are sent in the same API request." ([workers-sdk #12560](https://github.com/cloudflare/workers-sdk/pull/12560), merged 2026-02-16, released in Wrangler 4.66.0)

**Documented:** the one-request upload accepts the tag and puts it on the version it creates.

> `annotations` `object` optional: Annotations object for the Worker version created by this upload. … `workers/tag` specifies a custom identifier for the version.
>
> [Multipart upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/)

And the flag itself: "`--tag` `string` optional: A tag for this Worker version. Matches the behavior of `wrangler versions upload --tag`." ([Wrangler commands: deploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy)) The schema limits it: "User-provided identifier for the version. Maximum 100 bytes." A 40-character commit SHA or a 64-character SHA-256 hash fits.

What is not shown anywhere is the server accepting `exports` and `annotations` together. Nothing suggests it wouldn't; the client sends both in one metadata object.

### Can the tag be read back?

**Yes.** A deploy with `exports` still creates a Worker version (the upload doc above calls it "the Worker version created by this upload").

- **Documented:** `GET /accounts/{account_id}/workers/workers/{worker_id}/versions` and `…/versions/{version_id}` return `annotations` with `workers/tag`, `workers/message` and the read-only `workers/triggered_by`. Accepted permissions: `Workers Scripts Read`, `Workers Scripts Write` or `Workers Tail Read`.
- **Inferred from source:** `wrangler versions view <id> --json` and `wrangler deployments status --json` print the version, and their table output reads `version.annotations?.["workers/tag"]` ([`versions/view.ts`](https://github.com/cloudflare/workers-sdk/blob/f025bbfddcdab0193bffffc9fe5a9bf143f2fa65/packages/wrangler/src/versions/view.ts) line 78, [`versions/deployments/status.ts`](https://github.com/cloudflare/workers-sdk/blob/f025bbfddcdab0193bffffc9fe5a9bf143f2fa65/packages/wrangler/src/versions/deployments/status.ts) line 90). They call the older `…/workers/scripts/{script_name}/versions` endpoints, whose published schema doesn't list `annotations`, though Wrangler depends on it being there.

One existing open check bears on this: `production-plan` holds Metadata Read-Only "in place of Workers Scripts Read" (ADR 0024), and ADR 0026 already lists "whether Metadata Read-Only can list a Worker's deployments" as unconfirmed. The schema names only the three groups above for the version and deployment reads.

### If the tag didn't work, what else could carry the hash?

Not needed if the spike passes. For completeness, all from the same upload metadata page and schema:

- `--message` (`workers/message`): documented, "Truncated to 1000 bytes if longer", read back the same way as the tag.
- A plain-text variable in the Worker's config: readable from `GET …/workers/scripts/{script_name}/settings` as a binding.
- Script `tags` ("List of strings to use as tags for this Worker"): script-level, not per version, and Wrangler uses them for its own service and environment tags.

### Does `wrangler versions upload` fail with `exports`? (ADR 0027's claim)

**Documented, and contradicted by Wrangler's source and changelog. Cloudflare's pages don't agree with each other.**

ADR 0027's sentence matches one page:

> **`wrangler versions upload` does not apply lifecycle changes.** Just like the legacy `migrations` array, Durable Object lifecycle changes can only be applied via `wrangler deploy`. If your Wrangler configuration contains `exports` entries, `wrangler versions upload` fails fast with an actionable error.
>
> [Durable Objects migrations: limitations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

The pages it links to say something narrower, about versions that change the class lifecycle:

> Uploading a version that changes Durable Object class lifecycle is not supported. This applies to both the declarative `exports` field and the legacy `migrations` array - any change that creates, deletes, renames, or transfers a Durable Object class must be applied through `wrangler deploy`.
>
> [Deployment management: Durable Object migrations](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/#durable-object-migrations)

Wrangler's source and changelog say `versions upload` sends `exports` and succeeds:

- Changelog, 4.107.0: "`wrangler versions upload` also forwards `exports`. Declarative `exports` lifecycle changes are reconciled when the version is deployed (`wrangler versions deploy` or `wrangler deploy`), so a `versions upload` payload can declare new classes in `exports` without immediately provisioning them. An actor binding (`durable_objects.bindings`) to a class declared only in `exports` on the same `versions upload` is rejected with a clear error (code 100406)". The same entry describes percentage-split deploys: versions that "disagree on declarative `exports`" are rejected, and "Single-version (100%) deploys are unaffected." ([`packages/wrangler/CHANGELOG.md`](https://github.com/cloudflare/workers-sdk/blob/f025bbfddcdab0193bffffc9fe5a9bf143f2fa65/packages/wrangler/CHANGELOG.md))
- [`packages/deploy-helpers/src/deploy/versions-upload.ts`](https://github.com/cloudflare/workers-sdk/blob/f025bbfddcdab0193bffffc9fe5a9bf143f2fa65/packages/deploy-helpers/src/deploy/versions-upload.ts), lines 167 to 185: the only fail-fast is for a pending legacy migration ("This Worker has a pending Durable Object migration, which cannot be applied by `wrangler versions upload`"). With `exports` it builds the payload and uploads.
- The tests agree: `versions.upload.test.ts` has a "durable object exports (declarative)" block whose first case is "sends the `exports` payload (and omits `migrations`)".

So at Wrangler 4.147.0 the client does not fail fast on `exports`. Which is right for a real account, the Durable Objects page or the client, is **unknown, needs a spike**. The likely reading is that the Durable Objects page overstates and the real limits are: no lifecycle change by upload alone, no binding to a class that isn't provisioned yet, no percentage split across versions whose `exports` differ.

The related lines are narrower than ADR 0016 and ADR 0027 put them:

- Rollback: "**Rollbacks cannot cross a lifecycle change.** You cannot roll back to a version deployed before an `exports`-driven lifecycle change." (Durable Objects page) [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/#bindings) lists the same condition for `migrations`. ADR 0016's "`exports` … rules out Worker versions and so `wrangler rollback`" goes further than any source: versions exist, and rollback is blocked only across a lifecycle change.
- Gradual deployments: "**Gradual deployments are not supported with `exports`.**" (Durable Objects page) against the changelog's account of percentage splits working when the versions' `exports` match. Same conflict, same spike.

None of this changes ADR 0027's decision. `links-data` is deployed with `wrangler deploy` and never rolled back, so it doesn't depend on which reading is right.

### What it means for gap 9

**The premise fails.** `--tag` is not a feature of the versions path that `exports` takes away. `wrangler deploy --tag <sha>` sends the tag on the same request that carries `exports`, the upload API documents the tag on the version that request creates, and the version can be read back. ADR 0016's steps 2 and 3 can stand.

What #81 should still do:

- Run the spike before relying on it: on the preview account, deploy a Worker with `exports` using `wrangler deploy --tag <value>`, then read it with `wrangler deployments status --json`. Run `wrangler versions upload` on the same config while there, to settle which Cloudflare page is right.
- Reword ADR 0027's "`redirect` and `status` … keep versions, `--tag` and `wrangler rollback`", which implies `links-data` loses all three. From the sources, it keeps versions and `--tag`, and loses rollback only across a lifecycle change.
- Reword or soften "`wrangler versions upload` fails on a config with `exports` entries" and ADR 0016 step 5's "rules out Worker versions", or cite the Durable Objects page and note the conflict.

## Spikes this research leaves open

1. **Gap 11:** does the destination-address verification link work without a Cloudflare login, and does `PATCH … status: verified` succeed with the `production` token's permissions?
2. **Gap 11:** does Audit Logs v2 record Email Routing address and rule changes?
3. **Gap 9:** `wrangler deploy --tag` on a Worker with `exports`, read back with `wrangler deployments status --json`; and whether `wrangler versions upload` fails on that config.
4. **Gap 3:** does an empty declared `cloudflare_ruleset` for a phase apply cleanly and show an added rule as drift; and does one rulesets Read permission list every phase?
