---
status: accepted
---

# State what each credential can do to Link data, gate Operator methods with a secret, move `AUTH` writes into `links-data`, and take the backup locks out of CI's reach

[ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md) says "nothing that runs unattended in prod can delete anything". It reasons about API-token permissions, and it is false for data. A token that can deploy a Worker controls everything that Worker can bind, and three Cloudflare facts mean a binding can't be fenced:

- **Editor on one Worker can bind it to any KV, R2 or D1 resource,** with no permission on that resource. So the unattended `production` token, by deploying `redirect`, reaches `LINKS`, `AUTH`, `FLAGS`, the Status database and the backup bucket, whatever the rendered config says.
- **A KV binding is always read-write,** and a Durable Object has no per-caller authorisation: every public method is callable by any Worker that binds the class.
- **A binding can't remove a bucket lock or delete a locked object.** That needs account-level R2 edit.

So the claim becomes one about recoverability, with a table of what each credential can reach. Operator-only methods are gated by a secret that only `links-data` holds. Every `AUTH` write moves into a Workflow in `links-data`, so the Operator's laptop loses KV Edit and its R2 write key. The backup bucket and its locks move to a hand-applied configuration, so no credential in GitHub can remove a backup. Every token gets an expiry.

Decided in [What can each credential and Worker binding do to Link data?](https://github.com/andrewferk/url-shortener/issues/55), from the research in [What can Cloudflare tokens, Worker bindings and audit logs each be narrowed to or see?](https://github.com/andrewferk/url-shortener/issues/42).

## Decision

### The claim

**No unattended credential can irrecoverably destroy Link data, or delete a resource, a lock or a backup. No credential held in GitHub, attended or not, can remove a backup.** The unattended `production` token can corrupt the read copies and delete Links, and all of that is recoverable for at least 30 days.

| Credential | Attended? | Can do to Link data | Cannot | Recovery |
|---|---|---|---|---|
| `production` (deploys `redirect` and `status`) | No | Answer Visitors anything; rewrite or delete `LINKS`, `AUTH` (minting keys) and `FLAGS` (the brake, freezes, suspensions); delete any Link through the Creator path; create Links as any Creator; add objects to the backup bucket; write the Status database | Call an Operator method; run SQL on shards; change `links-data`; delete a resource; remove a lock or a locked object | Reconcile `LINKS` and `FLAGS` from the shards and Creator objects; restore `AUTH` from a locked export; point-in-time recovery (30 days) and the change log |
| `production-plan` | No | Read all of KV and the Status database | Write anything | Not needed |
| The Status Worker's read tokens | No | Read analytics and audit logs | Write anything | Not needed |
| `production-admin` (deploys `links-data`) | Approved each run | Everything `links-data` can, including wiping shards; delete KV namespaces and the Status database | Remove a lock or a locked backup; delete a Worker | Replay the locked change log; reconcile `LINKS`; restore `AUTH` from a locked export |
| `preview`, until the account split | Approved each run | Delete prod resources, as ADR 0007 already accepts before the first real Creator | Rulesets and zone settings | None guaranteed |
| `operator` token and the read-only R2 key (laptop) | Yes | Every Operator operation; deploy `links-data`; raw SQL on shards | Write KV or the bucket directly; delete a resource; remove a lock | Point-in-time recovery and the locked bucket |
| The Operator's broad token and dashboard session | Yes | Everything | Nothing | None guaranteed |

- **Recovery depends on someone noticing within the window.** Noticing belongs to [How is a silent Redirect hijack detected?](https://github.com/andrewferk/url-shortener/issues/56).
- **The `production` token's real gate is the ops repo's `main`.** Hardening it belongs to [How does a deployment survive losing its Cloudflare account, its domain or an identity root?](https://github.com/andrewferk/url-shortener/issues/57).
- **Non-enumerability holds against Visitors and Creators only.** [ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)'s property, as [ADR 0022](./0022-alert-on-redirect-floods-reset-the-brake-hourly-and-accept-short-code-guessing.md) restated it, never bound deployment credentials: `production` and `production-plan` can list every Short code, Target URL and Creator ID in `LINKS`.

### Operator methods are gated by a secret

- **Every `links-data` deploy generates a random 256-bit `OPERATOR_GATE`** and pushes it as a Worker secret with that deploy. It is never stored or logged anywhere else, and nobody needs to know it.
- **A gated method takes the gate as an argument** and compares it, in constant time, with the value in its own environment. Workflows, the outbox and the Creator objects run in `links-data`, so they read it from their environment and pass it. `redirect` can't read another Worker's secret.
- **Ungated methods are exactly what the Link API and the Redirect fallback call:** create, read, list and a Creator's own delete. Everything else is gated: Takedowns, Creator removal and suspension, freezes, restores, re-drives, reconcile inserts, snapshots, and the calls between shards and Creator objects.
- **The ungated delete can never record the Operator as the deleter.** `deleted_by='operator'` is set only by a gated method.
- **A step that straddles a deploy can see a mismatch.** It fails and retries against the new version; every step can already run twice ([ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md)).
- **The gate doesn't rely on binding topology.** Whether a per-Worker Editor token can add a `script_name` Durable Object binding or a service binding is undocumented. `doctor` reports it, and nothing here depends on the answer.

### What `redirect` can still do is accepted

- **Mass delete through the Creator path.** `redirect` authenticates Creators, so its code can call the ordinary delete for any Link with the Creator ID it reads from `LINKS`. Each delete erases the Target URL in the shard ([ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md)). Recovery is point-in-time recovery within 30 days, or the change log until "deleted wins" compaction clears it in about three months.
- **KV writes.** `redirect` must read `LINKS`, `AUTH` and `FLAGS`, and a read binding is a write binding. Moving the legitimate writes elsewhere would change nothing.
- **After a suspected `production` compromise** the runbook is: roll the token, redeploy `redirect` and `status` from a known commit, reconcile `LINKS` and `FLAGS`, diff `AUTH` against the latest locked `auth/` export and restore it, and review what was added to the bucket.

### `AUTH` writes move into `links-data`

- **Every command that writes `AUTH` is a Workflow in `links-data`:** `creators add`, `keys issue`, `keys revoke`, `creators remove`, `backup` and `restore`. So `links-data` binds `AUTH`, which reverses [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md).
- **The CLI generates an API key locally and sends only its hash.** The key never reaches a Workflow's stored parameters.
- **`links-data` writes every `ops/` and `auth/` object.** The CLI no longer writes audit records or exports. `creators add`'s account-split check runs in the Workflow.
- **The `operator` token drops KV Edit.** It keeps Editor on `links-data` and Workers Scripts Read.
- **The laptop's R2 key becomes Object Read only** on the backup bucket, for `links find`.
- **The laptop token stays as powerful as `links-data`:** Editor can deploy it and run raw SQL on shards. What changes is that a stolen key file can no longer write KV or forge a backup without deploying code.
- **Break-glass.** When Workflows is down, the broad token may write `AUTH` directly, for example to revoke a stolen key. Like a raw SQL write, it is followed by an audit record once Workflows is back: `ops record` is a Workflow that writes a hand-described action to `ops/`, and `backup` then exports `AUTH`.
- **`links-data` stays one Worker.**

### The backup bucket and its locks leave the pipeline

- **Prod's backup bucket, its bucket locks and its lifecycle rules move to a hand-applied OpenTofu configuration in `infra/bootstrap`,** applied with the broad token, as [ADR 0021](./0021-three-probe-locations-every-two-minutes-and-alert-rules-we-own.md) does for the Grafana installation.
- **Its state lives in the prod state bucket under its own key,** encrypted with the prod passphrase. It holds no secret, and `production-plan` can then plan it.
- **`production-admin` drops R2 edit.** `env/prod` takes the bucket's name as an input and binds it to `links-data`.
- **`production-plan` gains R2 read** and plans this configuration in the weekly drift job, so a changed or missing lock still fails the plan.
- **Previews are unchanged.** `infra/env` still creates a preview's bucket, which has no lock.
- **KV namespaces and the Status database stay in `env/prod`.** `LINKS` rebuilds from the shards, `AUTH` restores from the bucket, and the Status database holds only rollups.

### Token lifecycle

- **Every Cloudflare API token and R2 key has `expires_on` 13 months after it is created or rotated.** All share one date.
- **They are rotated together once a year,** by a runbook that sets the new expiry and rolls each value. A roll keeps the token's ID and permissions, so [ADR 0012](./0012-watch-audit-logs-from-the-status-worker.md)'s protected token IDs don't change. Grafana's tokens join the same rotation.
- **The weekly drift job checks its own `production-plan` token** and fails under 30 days left, so GitHub emails the Operator. That token stands in for the rest.
- **`doctor` prints the days left on the laptop's tokens** and fails under 30.
- **Tokens use the narrowest role that exists:**

  | Token | Workers permission |
  |---|---|
  | `production` | Editor on `redirect` and `status` |
  | `production-admin` | Editor on `links-data` |
  | `operator` | Editor on `links-data`, Workers Scripts Read |
  | `production-plan` | Metadata Read-Only, in place of Workers Scripts Read |

### Corrections to earlier ADRs

- **Data Studio SQL is logged,** in Audit Logs v1, two entries per query. ADR 0010 and ADR 0012 called raw SQL unaudited. Whether the watch reads v1 belongs to the hijack ticket.
- **`query/v2` is a published, generally available API** that needs Workers Scripts Write. It is not Data Studio's private backend.

## Considered options

- **An integrity claim: no unattended credential can change Link data.** `redirect` would hold no KV binding and every Redirect would go through `links-data`. It adds a hop to every Redirect, and the `production` token could still answer Visitors anything.
- **Claiming resources only.** Honest, but it says nothing about the data the resources hold.
- **Gating by topology:** `redirect` drops its Durable Object bindings and calls a `WorkerEntrypoint` in `links-data`. It rests on an undocumented limit of the per-Worker Editor role.
- **A stored gate secret.** One more secret to keep and rotate, for no gain over a fresh one per deploy.
- **Authenticating Creators inside `links-data`,** so the shard verifies the key itself. It adds a KV read to every API call and reopens [ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md), to stop a delete that is recoverable.
- **An `operator` Worker holding the Workflows,** with the laptop token Editor on it and not on `links-data`. The laptop could no longer deploy the shard classes or run raw SQL. But that Worker would hold the gate, so it could still call every Operator method and skip the audit record. Under the recoverability claim the outcome is the same, for a fourth Worker per environment. Workflows move between Workers without a data migration, so this stays open.
- **An `auth-admin` Worker for the `AUTH` Workflows.** "The Worker with the Links never binds `AUTH`" only ever guarded against a bug: Editor can add the binding, and `links-data` can already write a shard row under any Creator ID.
- **Keeping the `AUTH` writes on the laptop.** The laptop keeps account-wide KV Edit and an R2 write key, and `AUTH` commands keep a second audit path.
- **Removing KV Read from `production-plan`,** by planning the KV namespaces only under approval. It hides drift and closes nothing: `production` can list `LINKS` through `redirect`.
- **Moving the KV namespaces and the Status database to the hand-applied configuration too.** More hand work, and everything in them is rebuildable.
- **Shorter expiries, or each job checking its own token.** More hand rotation for one Operator; and `production-admin` runs too rarely for its own warning to arrive in time.

## Consequences

- **Amends ADR 0002:** non-enumerability doesn't bind deployment credentials.
- **Amends ADR 0005:** the Operator CLI's `AUTH` commands are Workflows; the CLI sends a key's hash.
- **Amends ADR 0007:** the claim and its table; `production-admin` loses R2 edit; the bucket's configuration in `infra/bootstrap`; `OPERATOR_GATE`; token roles and expiries.
- **Amends ADR 0008:** `links-data` binds and writes `AUTH`; prod's bucket and locks are applied by hand. Three namespaces still stop a bug in one writer from deleting another's keys, but they were never a boundary against a deploy credential.
- **Amends ADR 0010:** gated methods; the `operator` token and the laptop key; all audit records written by `links-data`; `ops record`; the corrections above.
- **Amends ADR 0012:** raw SQL through Data Studio is logged in v1. The annual rotation produces a digest email for every rolled token, which is expected.
- **Amends ADR 0016:** `production-plan`'s permissions, its plan of the bucket configuration, and the expiry check in the weekly job.
- **Amends [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md):** `links-data` now binds `AUTH`. Suspension stays in the Creator object and `FLAGS`, so the Operator and the ceiling keep one code path.
- **Changing a lock or lifecycle rule is hand work** with the broad token.
- **Every Operator command now waits on a Workflow,** so `keys issue` takes seconds. The few steps each uses are far inside the included 500,000 a month.
- **An expired token fails loudly:** a deploy fails, or the Status page goes stale and Grafana's rule alerts.
- **Handed to the hijack ticket:** compaction and restore must not trust an object just because it is in the bucket; an abnormal delete rate should alert; `redirect` deploys should be reported.
- **New `doctor` checks:** whether a per-Worker Editor token can add a `script_name` or service binding; whether Metadata Read-Only is enough for the `plan` job; whether an R2 key rolls and reports its expiry like any API token.
