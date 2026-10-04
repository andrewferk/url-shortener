---
status: accepted
---

> Amended by [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md): `cred:` and `creator:` records live in their own `AUTH` KV namespace, which `links-data` never binds. The Operator CLI gains `backup` and `restore`, and exports `AUTH` to the backup bucket after every write.
>
> Amended by [ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md): the Operator CLI uses a dedicated `operator` token and a bucket-scoped R2 key, not the Operator's broad token, and every command writes an audit record under `ops/`. `creators remove --delete-links` first marks the Creator removed, then sets a permanent `removed_with_links` flag on the Creator object, so Links that reach its list late are taken down on arrival, then walks the list.
>
> Amended by [ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md): every Creator is bound to one Namespace when it is admitted. `creator:<id>` records it, and `creators add` takes `--namespace`, defaulting to `default`.
>
> Amended by [ADR 0015](./0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md): the OIDC trust rule's `repository_id`, `environment` claim and `main`-only rule belong to the deployment's ops repo, which calls this repo's reusable workflows. This repo holds no credentials.
>
> Amended by [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md): a Creator can be suspended, by the Operator or by the daily ceiling. A Suspended Creator gets the uniform 401 on every Link API call while its Links keep redirecting. The Link API reads `suspended:<creatorId>` in `FLAGS` after verifying the credential. The CLI gains `creators suspend` and `creators resume`.
>
> Amended by [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md): every Operator CLI command that writes `AUTH` is a Workflow in `links-data`, which now binds `AUTH`. The CLI generates an API key locally and sends only its hash, and holds no KV Edit. The broad token may write `AUTH` directly only as break-glass.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): `cacheTtl` is 30 s on `AUTH` reads, so revocation takes about 30 s, not about a minute. OIDC verification pins `alg` to RS256, checks `exp` and `nbf`, caches the JWKS, and the trust rule gains `job_workflow_ref`.

# Creators authenticate with Operator-issued API keys checked through KV, and CI with GitHub OIDC

Creators are a small set that the Operator admits: there is no sign-up, and for now they use only the API on `api.`. The mechanism still must not cap out as that set grows, and it must not stop a later sign-up or UI from mapping onto the same Creators. Cloudflare Access is the obvious choice on Cloudflare, but it allows 50 free seats and 50 service tokens per account, and logins beyond the seat limit are blocked unless you pay per seat. Its `sub` changes if a user is removed and re-added, so we would keep our own identity mapping anyway. So we issue our own API keys, look them up in KV like any Redirect, and have CI prove itself with a GitHub Actions OIDC token instead of a stored secret.

Decided in [How do Creators authenticate?](https://github.com/andrewferk/url-shortener/issues/9).

## Decision

- **Creator identity:** every Creator has an opaque Creator ID that we mint (`cr_` plus random base62). It is permanent and never reused.
  - A Link stores its Creator ID in its shard, and the ID names that Creator's Durable Object ([ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)).
  - Credentials point to a Creator ID and can be replaced; the ID outlives all of them.
  - A Creator may delete only Links carrying its own Creator ID.
- **API keys:** `Authorization: Bearer lk_<keyId>_<secret>`.
  - The `secret` is 32 random bytes in base62. The `lk_` prefix lets secret scanners spot leaked keys.
  - Only SHA-256 of the full key is stored. A 256-bit random secret needs no salt and no slow hash.
  - A Creator holds at most **2 active keys**, so rotation can overlap: issue a new key, switch over, revoke the old one.
  - Keys don't expire. They are rotated when they may have leaked, or when a person leaves.
- **Where credentials live:** KV is the store of record.
  - `cred:<sha256>` → Creator ID and key ID; `creator:<id>` → status and active key IDs.
  - The Worker only reads these records, behind a `CreatorAuthenticator` port.
  - There is one Operator, so KV's last-write-wins never races.
- **Operator CLI:** a TypeScript script in the repo writes those records straight to KV, using the Operator's own Cloudflare API token. It has `creators add`, `keys issue`, `keys revoke` and `creators remove`, and takes the target environment as an argument.
  - A new key is printed once and never stored.
  - There is no admin endpoint: the Operator never uses the Link API.
- **Revocation takes effect within about 30 s:** `AUTH` reads use a `cacheTtl` of 30 s ([ADR 0006](./0006-redirect-caching-kv-values-colo-cache-no-store.md)). It is "about" for the same reason as a Deleted link's bound: Cloudflare documents no hard limit on how long a KV location can serve a stale value.
- **Removing a Creator:** by default their Links keep redirecting and keep their Creator ID. `creators remove --delete-links` is for abuse cleanup. It walks the Creator's Durable Object list and deletes each Link through its shard.
- **Failures:** a missing, malformed, unknown or revoked key, or one belonging to a removed Creator, all answer the same `401` with `WWW-Authenticate: Bearer`.
  - These are the failed authentications that [ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md) limits to 10 per 60 s per IP.
- **CI (the operations Creator):** the API also accepts a GitHub Actions OIDC token, verified against GitHub's JWKS.
  - Verification accepts only `alg` `RS256`, checks `exp` and `nbf`, and caches the JWKS.
  - The trust rule: issuer `https://token.actions.githubusercontent.com`; `repository_id` equal to the configured repository; `aud` equal to that environment's own API origin, so a preview's token can't be replayed against prod.
  - `job_workflow_ref` must name one of this project's reusable workflows in the configured source repository, at any ref. A token minted by any other workflow in the ops repo is refused.
  - The `environment` claim must be `production` in prod, which GitHub restricts to `main` through environment protection rules, and `preview` in preview environments.
  - A token that passes maps to one operations Creator ID. It is a plain Creator: it owns the Canary link everywhere and has the usual Creator limits.
  - Every value in the rule is an OpenTofu variable.
- **Preview environments** have their own KV, so they hold no human Creators unless the Operator issues keys against that environment.

## Considered options

- **Cloudflare Access in front of `api.`** No login code, and it works from the command line with `cloudflared access login`. Rejected because of the 50-seat cap, with logins blocked beyond it; scripts need `cloudflared` or a service token; and Access's unstable `sub` still needs our own mapping.
- **One Access service token per Creator.** Cloudflare handles rotation and revocation, but the 50-token account cap hard-limits the number of Creators, and it ties identity to Cloudflare.
- **Credentials in the Creator's Durable Object, checked on every call.** Revocation would be immediate, but a Durable Object goes back on the create path, which ADR 0004 kept it off. A stolen key's extra 30 s is already limited by the Creator burst limit and daily cap.
- **An admin Worker behind Access for the Operator.** It adds a privileged network surface and more code. The Operator's Cloudflare API token already exists to run OpenTofu.
- **Creators and keys declared in OpenTofu.** Every key would sit in OpenTofu state.
- **A stored API key for CI.** A fresh secret would have to be seeded into every preview environment, and a CI secret is the likeliest key to leak. OIDC tokens live for one job and need nothing stored.
- **Keys that expire after a year by default.** With a handful of Creators and no UI, forced expiry mostly causes self-inflicted outages for scripts.

## Consequences

- **A later sign-up or UI adds a login in front, not a new identity model.** An OIDC login (for example GitHub, through `@cloudflare/workers-oauth-provider` or an outside IdP) can map to a Creator ID and issue keys for it. Links don't move.
- **Admitting and removing Creators needs Cloudflare account access.** Only the Operator can do it, and there's no self-service rotation until a UI exists.
- **Two verification paths sit behind one port:** a KV lookup for API keys, and a JWKS check for GitHub OIDC tokens.
- **A leaked key keeps working for up to about 30 s after revocation.** The Links it created stay until the Operator deletes them.
