---
status: accepted
---

> Amended by [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md): `shard-fallback` stays eligible for the latency Objective; `not-found` no longer is.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the body's eligibility lines follow ADR 0022.

# Place shards and Creator objects by a required location hint, with optional hints for D1 and R2 and no jurisdiction

[ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md) said "there are no regions to choose". That holds for the Workers, but not for what they store. Cloudflare creates a Durable Object "close to where the initial `get()` request is made", and objects "do not currently change locations after they are created". [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md) made the object names permanent and no ADR passed a `locationHint`, so each of the 256 shards would have landed, for good, near whichever Visitor, bot, Creator or CI run reached it first. A Creator's object is first reached by a shard's outbox alarm, so it would have landed near that shard.

Each deployment now says where its data lives. One required input places every shard and Creator object. Two optional inputs place the D1 database and the R2 buckets. No jurisdiction is ever set. The deploy touches all 256 shards before real traffic, and a hint can't be changed once it has been used.

Decided in [Where do shards and Creator objects live?](https://github.com/andrewferk/url-shortener/issues/48).

## Decision

### What a distant shard costs

Almost every Redirect is answered from the per-colo cache or KV ([ADR 0006](./0006-redirect-caching-kv-values-colo-cache-no-store.md)) and never reaches a Durable Object. The paths that do each pay about one network round trip to wherever the object sits:

| Path | Object reached |
|---|---|
| Redirect on a KV miss: a new Link's first ~60 s, or an unknown Short code | The shard |
| Create (once per claim attempt), single-Link read, delete | The shard |
| Listing | The Creator's object |
| Outbox drains to KV, Creator lists and R2 | Background; no one waits |

A round trip is roughly 80–150 ms between North America and Europe, and 200–300 ms between Asia-Pacific or Oceania and Europe. These are estimates from typical internet round-trip times. Cloudflare publishes no figures.

### The inputs

`deployment.json` ([ADR 0016](./0016-deliver-from-ops-repo-reusable-workflows-plan-read-only-apply-behind-one-approval.md)) gains one object:

```json
"location_hints": { "durable_objects": "weur", "d1": "weur", "r2": "weur" }
```

| Key | Required | Values | Places |
|---|---|---|---|
| `durable_objects` | Yes, no default | `wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `apac-ne`, `apac-se`, `oc`, `afr`, `me` | Every shard and every Creator object |
| `d1` | No | `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc` | Every D1 database (`primary_location_hint`) |
| `r2` | No | `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc` | Every R2 bucket (`location`), the state buckets included |

- **`durable_objects` has no default.** Placement is permanent, and a default would silently misplace every Operator who didn't notice it. The schema rejects a `deployment.json` without it.
- **`d1` and `r2` may be omitted,** which leaves Cloudflare's automatic choice. Neither is on a Visitor's or a Creator's path: D1 is read by the Status Worker, and R2 is written by background outbox batches.
- **Three keys, not one.** The three products accept different region lists, so one value couldn't drive all three without a mapping table.
- **One hint per product, for the whole deployment.** Previews and the restore drill use the same values as prod.
- **Every hint is best effort.** Cloudflare picks a data centre near the hinted region, and doesn't guarantee one inside it.

### Shards and Creator objects

- **Every `get()` of a shard or a Creator object passes the hint.** Only an object's first `get()` respects it, and any caller can be the first: the `redirect` Worker on a fallback, the Link API, a shard's outbox alarm, or an Operator Workflow.
- **One stub factory makes those calls.** It lives in the code `redirect` and `links-data` share, takes the hint from rendered Worker config, and is the only place that calls `get()` on either namespace. A lint rule or test fails any other call site.
- **Creator objects use the same hint as the shards.** Listing then costs one round trip to a known region. A per-Creator region is left to whoever builds a SaaS: a field on the Creator record could place new Creators' objects elsewhere without changing anything decided here.
- **Object names don't change:** `shard-<n>` and the Creator ID, as in ADR 0008.

### Placing all 256 shards before traffic

- **The deploy's `admin` job touches every shard** after it deploys `links-data` (ADR 0016), through the stub factory. It is 256 requests and changes nothing on a re-run.
- **Correctness never depends on it.** The hint on every `get()` is the mechanism. The touch step exists so that all 256 shards are placed from a known hint at a known time, and so that a misplaced shard is seen while prod can still be wiped (before `v0.1.0`).
- **It reports where each shard landed, and never fails the deploy.** Hints are best effort, so a shard outside the hinted region is something to read, not an error.
- **Cloudflare documents no way for a Durable Object to learn its own location.** An early spike finds one. If there is none, the step still runs and reports only that each shard answered.
- **The Canary link step is no longer what places a shard.** Before this decision, the smoke test would have pinned one shard near the CI runner.

### No jurisdiction

- **No Durable Object namespace, D1 database or R2 bucket is given a jurisdiction** (`eu`, `fedramp`).
- **It would guarantee nothing a deployment could claim.** `LINKS` in KV is a full second copy of every Link (ADR 0008), and KV stores and caches it worldwide. Pinning the other stores would not make a deployment's data resident anywhere.
- **It is also permanent.** A Durable Object jurisdiction changes every object ID, and D1 and R2 jurisdictions can be set only at creation.
- **The operator docs say that a deployment makes no data-residency claim.**

### A hint is permanent once used

- **Changing a hint moves nothing.** Existing objects, databases and buckets stay where they are. A changed `durable_objects` hint would only place new Creator objects somewhere else than the shards.
- **The deploy refuses a changed hint.** `infra/env` records each hint the first time it is applied, and the `plan` job fails when `deployment.json` differs from the recorded value. An omitted `d1` or `r2` is recorded as omitted.
- **Whether the provider would replace a D1 database or an R2 bucket whose hint changed is not documented.** The check fails the plan before that is ever proposed, so the Status page's history and the locked backup bucket don't depend on the answer.
- **The one legitimate change follows a restore that recreates the objects.** After `links-data`'s namespace is deleted and replayed (ADR 0008), every shard and Creator object is placed afresh. The restore runbook covers resetting the recorded value first.
- **A recreated R2 bucket keeps its first location.** Cloudflare honours the hint only "the first time a bucket with a given name is created".

### The latency Objective is unchanged

- **`shard-fallback` stays eligible, and `not-found` did until ADR 0022 removed it,** for [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)'s latency Objective (99% of eligible Redirects in ≤ 200 ms).
  - They are real Visitor experiences: a new Link's first minute, and a mistyped Short URL. Leaving them out would hide exactly the cost that placement creates.
  - The exposure is bounded. The fallback is limited to 30 per minute per IP ([ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)), and `rate-limited` and `shed` are already excluded.
- **A deployment whose Visitors are far from its shards can miss the Objective on these paths.** The operator docs say to hint the region where most Visitors are.
- **Redirect events already record `colo`, `outcome` and `duration_ms`** ([ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md)), so the real cost of a fallback per colo shows in the Status page data.

### When

Slice 1.3 ships the stub factory, the `location_hints` schema and the changed-value check, before any shard exists in prod. Prod can be wiped only until `v0.1.0`. After that, nothing moves a shard.

## Cost

**Today and at peak:** $0. A hint is a parameter, and the touch step is 256 Durable Object requests per `admin` job.

## Considered options

- **No hint** (the ADRs as decided). Each shard lands near its first caller and stays there. One deployment's shards could be spread across continents by chance, and no one would have chosen any of it.
- **A default for `durable_objects`.** It saves one line of config, and gives a permanent wrong answer to any Operator outside the default's region.
- **One `location_hint` for all three products.** D1 and R2 don't accept `sam`, `afr`, `me`, `apac-ne` or `apac-se`, so it needs a mapping table, and it stops an Operator from placing them differently.
- **Leaving D1 and R2 automatic, with no inputs.** Neither is on a latency path, so automatic is harmless. But both are as permanent as the shards, and an input costs one optional key.
- **A jurisdiction as an optional input.** It can't be added after data exists, which argues for offering it now. It was rejected because KV copies every Link worldwide, so it would invite a residency claim the deployment can't honour.
- **A region per Creator.** It would put each Creator's list near that Creator. It is a SaaS concern, costs a field and a lookup on every create, and can be added later for new Creators.
- **Relying on the touch step alone,** with no hint on ordinary calls. A Creator object is created long after any deploy, and a restore or a missed run would leave shards to their first caller.
- **Taking `shard-fallback` or `not-found` out of the latency Objective.** The Objective would always look healthy, by not measuring the requests placement slows down. ADR 0022 later took `not-found` out for another reason: it is the one slow outcome anyone can produce at will.

## Consequences

- **Amends ADR 0001:** there is one region to choose, for the Durable Objects, and two optional ones.
- **Amends ADR 0008:** every `get()` of `shard-<n>` and of a Creator's object passes the deployment's hint, through one stub factory.
- **Amends ADR 0011:** eligibility is unchanged, and the latency Objective now depends on where the Operator placed the shards.
- **Amends ADR 0016:** `deployment.json` gains `location_hints`; the `admin` job touches all 256 shards; the `plan` job fails on a changed hint.
- **Amends [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md):** the D1 database and every R2 bucket are created with the deployment's hint when one is given.
- **Choosing a region is a one-time decision for each Operator,** made before the first deploy. A deployment with Visitors on every continent will always have some far from its shards. The KV read path is what keeps that off almost every Redirect.
- **A hint is not a guarantee.** The touch step's report is the only evidence of where the shards are, and only if the spike finds a way to produce it.
- **`location_hints` joins `deployment.json`'s public contract.** Cloudflare adding or renaming a region means a schema change.
