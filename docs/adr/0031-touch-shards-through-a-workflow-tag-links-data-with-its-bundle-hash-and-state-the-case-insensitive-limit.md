---
status: accepted
---

# Touch the shards through a Workflow the `admin` job starts, tag `links-data` with its bundle hash, and state the case-insensitive mode's limit

The 2026-10-04 audit found two gaps in how the prod deploy reaches and tags `links-data`, and one unstated limit of the reserved case-insensitive mode. Each was checked against the ADR text:

- **The shard touch step has no channel. Holds.** [ADR 0017](./0017-place-shards-and-creator-objects-by-a-required-location-hint.md) has the deploy's `admin` job touch all 256 shards "through the stub factory", but `links-data` has no public route, and the stub factory runs in a Worker, not in a GitHub job. The touch is in neither of [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md)'s method lists. The PRD runs it in slice 1.5, before the Workflows channel arrives in slice 6.2.
- **`links-data` may not be able to carry its tag. Fails.** [ADR 0027](./0027-declare-durable-objects-with-exports-keep-gates-off-run-history-and-harden-state-encryption.md) implies a Worker with `exports` loses `--tag`. [Confirm the Cloudflare and Wrangler behaviour three audit gaps rest on](https://github.com/andrewferk/url-shortener/issues/77) found the opposite in Wrangler's source: `wrangler deploy` sets the `workers/tag` annotation before it chooses an upload path, and the tag reads back from the versions API. Nothing was run. Checking it turned up a different fault: [ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md) compares `links-data`'s *bundle hash* with the deployed tag but deploys it with `--tag <sha>`, the same placeholder as the commit SHA on the other two Workers. A commit SHA never equals a bundle hash, so every deploy would have asked for approval.
- **The case-insensitive mode's limit is unstated. Holds.** [ADR 0018](./0018-hash-the-case-folded-short-code-keep-aliases-case-sensitive-reserve-case-insensitive-mode.md) gives the rules ("legacy conflicts tolerated, exact lookup wins") but not what they cost a deployment that turns the mode on late.

So the `admin` job starts a small Workflow in `links-data` that touches the shards, `links-data`'s tag is its bundle hash, and the mode's limit is written down and accepted.

Decided in [Settle the audit's delivery gaps and the case-insensitive limit](https://github.com/andrewferk/url-shortener/issues/81).

## Decision

### The `admin` job touches the shards through a `touch-shards` Workflow

- **`links-data` has a `touch-shards` Workflow.** It calls every shard once through the stub factory (ADR 0017) and returns where each landed, or only that each answered if the spike finds no way for a shard to learn its location.
- **The `admin` job starts one instance over Cloudflare's Workflows REST API** after it deploys `links-data`, and polls it until it ends. The instance's output is the placement report, which the job writes to its summary. As ADR 0017 decided, the report never fails the deploy; an instance that errors or doesn't end within the job's timeout does.
- **`links-data` still has no public route.** This is the channel [ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md) chose for the Operator, used by a second caller.
- **The touch is a gated method.** The Workflow runs in `links-data` and holds `OPERATOR_GATE`, so gating costs nothing, and ADR 0024's ungated list stays exactly what the Link API and the Redirect fallback call.
- **It is not an Operator operation.** It writes no `ops/` audit record and takes no reason; the deploy run's summary is its record. It changes nothing on a re-run.
- **The `production-admin` token starts it.** ADR 0024 gives that token Editor on `links-data`. Whether that role can create and read a Workflow instance is not documented; it is the same question the `doctor` already asks of the `operator` token. An early spike (slice 1.6) settles it. If the role can't, the token gains the narrowest Workflows permission that can, and ADR 0024's table says so. The token can already wipe every shard, so this adds no reach.
- **Slices keep their order.** Slice 1.5 ships the Workflows binding, this one Workflow, and `OPERATOR_GATE` with its one gated method, since the gate must exist for the touch to take it. Slice 6.2 still brings the `operator` token, the CLI, the audit records and every Operator Workflow.

### `links-data` is tagged with its bundle hash

- **The tag is the SHA-256 of the prebuilt `links-data` bundle,** in hex (64 characters; the limit is 100 bytes). The `build` job already records it. The `admin` job deploys with `--tag <bundle hash>`.
- **`plan` reads the live version's `workers/tag` annotation** and compares it with the hash `build` recorded. A match means `links-data` is not pending, which is what lets most deploys skip `admin` and its approval.
- **`redirect` and `status` keep `--tag <commit SHA>`.** Nothing compares their tags; they are deployed on every run.
- **ADR 0027 is corrected.** A Worker with `exports` keeps `--tag`. What ADR 0027 says `links-data` gives up (`wrangler versions upload`, gradual deployments, rollback) is contradicted in part by Wrangler's changelog and source, and none of it changes that ADR's decision, because `links-data` uses none of the three.
- **An early spike (slice 1.6) runs it end to end:** `wrangler deploy --tag` on a Worker with `exports`, the tag read back with the `production-plan` token, and `wrangler versions upload` on the same config.
- **Fallback, if the tag can't be written or read back:** `plan` reads the bundle hash from the GitHub deployment record below. That is weaker, because the record says what the last deploy run shipped, not what is live; the hourly integrity job's version ID comparison ([ADR 0026](./0026-detect-redirect-hijacks-from-links-data-and-the-ops-repo.md)) covers the difference.

### The deployment record also holds `links-data`'s bundle hash

- **Every deploy run writes it,** beside the three live version IDs (ADR 0026), whether or not `admin` ran. A run that skipped `admin` writes the hash it compared.
- **The hourly integrity job also compares it with the live tag** and fails when they differ. This is not a hijack check: an annotation is set by whoever deploys, and ADR 0026's version ID comparison stays the check that isn't. It is there because `plan` reads the tag, so a wrong tag would hide a pending `links-data` or ask for approval on every run.
- **The tag stays what `plan` trusts.** The record is the fallback and the cross-check.

### The case-insensitive mode's limit is accepted

- **A Link created before the mode is turned on stays case-sensitive for good, and blocks its folded twins.** With `Sale` already a Link, no one can ever create a case-insensitive `sale`: ADR 0018's "no new conflict" refuses the claim. A Visitor who types `sale` gets a 404, as today.
- **Deleting the old Link does not free the twin.** Short codes are never reused, and the Deleted link's row still matches on the folded form. Deleting `Sale` only burns `Sale`.
- **There is no convert operation.** Turning an existing Link case-insensitive would change a Link's fields, which [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md) rules out, and two legacy variants (`Sale` and `sale`) could not both be converted.
- **So the mode is complete only for a deployment that enables it before its Creators hold mixed-case aliases.** An Operator who wants it should turn it on once it exists and before admitting Creators; later, it covers only folded forms nobody has claimed in any case. This is the "one-way door" the features review named. ADR 0018 narrowed it from "can never be added" to this, and this is as far as it closes.

## Cost

**Today and at peak:** $0. One Workflow instance per `admin` job, a few steps and 256 Durable Object requests, far inside the included 500,000 steps a month.

## Considered options

- **A route on `links-data` for the touch,** temporary or guarded by a secret. It gives the Worker with the Links a public surface, and a second secret to place in GitHub, for one idempotent call.
- **No deploy-time touch: `links-data`'s hourly cron touches the shards.** It needs no channel at all. Rejected because the shards would be placed up to an hour after `redirect` starts serving, so a Visitor could reach a shard first, and nothing would report placement in the deploy run that caused it.
- **Touching through `redirect`,** which already binds the shards. It would need a public endpoint on the Short domain, and the `prod` job runs after `admin`.
- **An ungated touch.** Harmless, since any shard call places the shard. Rejected only to keep the ungated list exact.
- **Tagging all three Workers with the commit SHA and keeping the bundle hash only in the deployment record.** One tag scheme, but `plan` would then trust a record of what was shipped over what is live.
- **Moving the 6.2 Workflows channel ahead of the first prod deploy.** The touch needs one Workflow and no Operator token, CLI or audit record.
- **A later Operator "convert" operation, or lowercasing every alias now.** The first breaks ADR 0019; ADR 0018 already rejected the second.

## Consequences

- **Amends ADR 0010:** `links-data` holds one Workflow that is not an Operator operation, `touch-shards`, started by the deploy and unaudited.
- **Amends ADR 0016:** step 2 reads the `workers/tag` annotation; step 3 deploys `links-data` with `--tag <bundle hash>` and then runs `touch-shards`; the deployment record gains the bundle hash.
- **Amends ADR 0017:** the touch step's channel is the `touch-shards` Workflow.
- **Amends ADR 0018:** the limit above is stated in the extension's rules.
- **Amends ADR 0024:** the touch joins the gated methods; `production-admin` may gain a Workflows permission after the spike.
- **Amends ADR 0026:** the deployment record holds `links-data`'s bundle hash, and the hourly integrity job compares it with the live tag.
- **Amends ADR 0027:** `links-data` keeps `--tag`; the cost of `exports` is restated as documented, not verified.
- **The PRD** gains the Workflows binding in slice 1.5, two spikes in slice 1.6, a `doctor` row and a Known limit.
- **A first deploy on a fresh account depends on Workflows being available** to the `admin` job, five milestones before the Operator needs it.
