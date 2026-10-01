# What can Cloudflare tokens, Worker bindings and audit logs each be narrowed to or see?

Research for [issue 42](https://github.com/andrewferk/url-shortener/issues/42). Facts only. The choices belong to "What can each credential and Worker binding do to Link data?" and "How is a silent Redirect hijack detected?".

Every source was fetched on **2026-10-01**. Cloudflare docs pages were fetched as raw Markdown (`<page URL>index.md`) with `curl`, not through a summarising fetcher. API facts come from the API reference pages and from Cloudflare's published OpenAPI schema ([cloudflare/api-schemas](https://github.com/cloudflare/api-schemas), `openapi.json` at commit `7350e99`, dated 2026-10-01).

Each claim carries one label:

- **Confirmed**: the docs say it. The wording is quoted.
- **Contradicted**: the docs say otherwise. The wording is quoted.
- **Not documented**: the docs are silent. The entry says what a `doctor` check or spike would have to test.
- **Inference**: derived from something documented. The entry says from what.

Nothing here was tested against a live account.

## Summary

| Question | Answer | Label |
|---|---|---|
| Read-only KV binding? | No such option appears in the Wrangler config reference or the API's binding schema. | Inference (from absence) |
| Per-caller authorisation on Durable Objects? | None documented. `ctx.props` gives a callee a trusted caller identity, but only for service bindings to a `WorkerEntrypoint`. | Not documented |
| Can Editor on one Worker deploy it with a new binding to a resource the token has no permission on? | Yes for KV, R2 and D1. `script_name` Durable Objects and service bindings aren't named. | Confirmed (KV, R2, D1); not documented (the rest) |
| `workers_dev` default | `true` when the config has no routes, `false` otherwise. | Confirmed |
| `preview_urls` default | Follows `workers_dev` when no setting exists. If omitted, Wrangler leaves an existing setting alone. `workers_dev = false` does not turn it off. | Confirmed |
| Per-Worker and product-level roles | Four roles (Metadata Read-Only, Content Read-Only, Editor, Admin) at Workers-product or individual-Worker scope, for members, groups and API tokens. Since 2026-09-15. | Confirmed |
| Custom Domains with per-Worker roles | Not supported yet. | Confirmed |
| Workers KV permission scope | Account-level only. No namespace scope is documented. | Confirmed (account-level); not documented (namespace scope) |
| KV read that can't list or bulk-read | None. `Workers KV Storage Read` is accepted by list-keys, get-value and bulk-get. | Confirmed |
| R2 key limited to reading one bucket | Yes: `Object Read only`, scoped to named buckets, S3 API only. | Confirmed |
| R2 per-prefix scope | Only on temporary credentials derived from a parent token. | Confirmed |
| Token expiry and rolling | The API takes `expires_on` and `not_before`, and has a roll endpoint. The provider's `cloudflare_account_token` takes `expires_on` and `not_before`. The provider has no roll resource. | Confirmed |
| Bot Fight Mode needs Bot Management Write | Yes. | Confirmed |
| Which events are in Audit Logs v2 | No per-event list exists. The general claim is create, update and delete across about 95% of products. `GET` requests and 4xx responses are not logged. | Not documented per event |
| Data Studio SQL | Logged in Audit Logs v1. | Confirmed |
| R2 bucket-lock changes | Absent from R2's list of logged operations. | Confirmed (the omission) |
| `query/v2` in the public API reference | Absent from the API reference site and the TypeScript SDK. Present in the published OpenAPI schema. | Mixed: see below |
| Logpush on Free | Available, self-service, usage-based. | Confirmed |
| Audit-log dataset on Free | Not stated outright. | Inference: included |
| Logpush cost | 25 GB a month included per account for each of internal and external exports, then $0.03 or $0.10 per GB. | Confirmed |

## Bindings

### Can a KV binding be read-only?

**Inference, from absence.** No read-only or access-mode option is documented.

- The Wrangler configuration reference lists the `kv_namespaces` fields as `binding`, `id` and `preview_id` ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
- The API's binding schema for `kv_namespace` has only `name`, `namespace_id` and `type` (OpenAPI schema `workers_binding_kind_kv_namespace`).
- The KV bindings page describes a binding as allowing "communication between a Worker and a KV namespace" and says "Any methods on the `TODO` binding will map to the KV namespace" ([KV bindings](https://developers.cloudflare.com/kv/concepts/kv-bindings/)).
- A search of the whole KV documentation (`kv/llms-full.txt`) for "read-only", "read only" and "permission" found nothing about bindings.

For comparison, the R2 bucket binding schema (`bucket_name`, `jurisdiction`, `name`, `type`) has no access mode either.

**The review was right** as far as the docs go: anything that can deploy `redirect` gets a read-write handle on every namespace `redirect` binds.

`doctor` check, if certainty is wanted: none is possible from outside. A spike would call `put()` and `delete()` from a Worker and observe that both succeed.

### Do Durable Objects have per-caller authorisation?

**Not documented.** No page describes a way for a Durable Object to learn which Worker is calling it, or to limit a method to one caller.

What the docs do say:

- Access for *people and tokens* follows the implementing Worker: "Durable Objects do not have separate roles or permissions. Access to a Durable Object is determined by your access to the Worker that implements it." ([Durable Objects roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/)). This is about the control plane, not about one Worker calling another's object.
- The documented pattern puts checks in the calling Worker: "A common pattern is to use Workers as the stateless entry point that routes requests to Durable Objects when coordination is needed. The Worker handles authentication, validation, and response formatting, while the Durable Object handles the stateful logic." (Durable Objects docs, `durable-objects/llms-full.txt`).
- Every method declared on the class is callable over RPC. Only instance properties, `#private` members and arrow-function properties are hidden ([RPC visibility and security model](https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/)). That page also says "the RPC interface between two of your Workers may be a security boundary".
- The Durable Object binding schema has `class_name`, `script_name`, `environment`, `namespace_id`, `dispatch_namespace`, `name` and `type`. It has no `props` field (OpenAPI schema `workers_binding_kind_durable_object_namespace`).

The one documented caller-identity mechanism is for service bindings, not Durable Object bindings:

- "`ctx.props` provides a way to pass additional configuration to a worker based on the context in which it was invoked. For example, when your Worker is called by another Worker, `ctx.props` can provide information about the calling worker." ([Context API](https://developers.cloudflare.com/workers/runtime-apis/context/))
- "The Workers platform is designed to ensure that `ctx.props` can only be set by someone who has permission to edit and deploy the worker to which it is being delivered. This means that you can trust that the content of `ctx.props` is authentic. There is no need to use secret keys or cryptographic signatures in a `ctx.props` value." (same page)
- The docs' own example is a `WorkerEntrypoint` per caller or per permission set: "you might create a distinct `WorkerEntrypoint` for each permission role in your application" ([Service bindings RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)).
- The same page says the Context API "is available strictly in stateless contexts, that is, not Durable Objects". So `ctx.props` is documented for `WorkerEntrypoint` classes only.
- A Worker with no routes is reachable only through a binding: "You can deploy a Worker that is not reachable via the public Internet, and can only be reached via an explicit Service binding that another Worker declares." ([Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/))

**The review was right** that Durable Objects have no documented per-caller authorisation. If ADR 0010's takedown and restore methods are ordinary methods on the shard class, the docs give no reason `redirect` couldn't call them through its `script_name` binding.

Spike: whether a Durable Object binding accepts `props`, and whether the object can read them.

### Can Editor on one Worker add a binding to a resource the token has no permission on?

**Confirmed for KV, R2 and D1.** Both authorisation pages carry the same section:

> "To deploy a Worker that has bindings to resources like Workers KV, R2, or D1, you need `Editor` access to the Worker. You do not need separate permissions on the bound resources to deploy the Worker.
>
> Permissions on bound resources are only required if you need to access those resources directly, for example, reading KV keys, querying a D1 database, or listing R2 objects."

Sources: [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/), [Roles and permissions](https://developers.cloudflare.com/workers/authorization/).

So a token with Editor on `redirect` alone can deploy `redirect` with a binding to the backup R2 bucket, to `AUTH`, or to any other KV namespace or D1 database in the account. The deployed code then reads and writes through the binding.

**The review flagged this as unverified. The docs confirm it.**

**Not documented:** Durable Objects reached through `script_name`, and service bindings. The section says "resources like" and names three. One sentence points the other way for service bindings that carry `props`: `ctx.props` "can only be set by someone who has permission to edit and deploy the worker to which it is being delivered" (quoted above). Nothing says whether a plain `script_name` binding to another Worker's class needs any access to that Worker.

`doctor` checks:

1. With a token holding Editor on one preview Worker only, deploy that Worker with a new KV binding, a new R2 binding and a new `script_name` Durable Object binding to resources it has no permission on. Record which deploys succeed.
2. Repeat with a service binding that sets `props`.

### `workers_dev` and `preview_urls`

**Confirmed.** Defaults, from the [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) reference:

- `workers_dev`: "Enables use of `*.workers.dev` subdomain to deploy your Worker. … Defaults to `true` when the configuration has no `route` or `routes`, and `false` otherwise."
- `preview_urls`: "Enables Version URLs and `workers.dev` Preview URLs. If omitted, Wrangler does not change an existing setting. If no setting exists, its initial value depends on `workers_dev`."

From [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/):

> "When no Version URL setting exists, Version URLs follow the same default as your `workers.dev` route:
> - If `workers_dev` is enabled, Version URLs are enabled by default.
> - If `workers_dev` is disabled, Version URLs are disabled by default."

> "If `preview_urls` is omitted, Wrangler does not change an existing Version URL setting. Set `preview_urls` explicitly to change it."

From [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/):

- "All Workers are assigned a `workers.dev` route when they are created or renamed".
- "Disabling your `workers.dev` route does not disable Version URLs, Preview URLs, or Deployment URLs."
- "If you disable your `workers.dev` route in the Cloudflare dashboard but do not update your Worker's Wrangler file with `workers_dev = false`, the `workers.dev` route will be re-enabled the next time you deploy your Worker with Wrangler."
- "When enabled, your `workers.dev` URL is available publicly." Preview URLs are also "public by default" ([Previews](https://developers.cloudflare.com/workers/previews/)).

What this means for the three Workers (inference from the defaults above):

- `redirect` and `status` have routes, so `workers_dev` defaults to `false` on deploy, and `preview_urls` follows it only if no setting exists yet.
- `links-data` has no routes, so both default to `true`. ADR 0010 already sets both to `false` explicitly.
- A Worker is created once in bootstrap before its first routed deploy. Whether that first creation leaves a stored `preview_urls` setting that later deploys then leave alone is **not documented**.

How to enforce both off:

- **Confirmed:** set `workers_dev = false` and `preview_urls = false` in each Worker's config on every deploy. The docs give no other declarative way.
- **Confirmed:** the stored state is readable. `GET /accounts/{account_id}/workers/scripts/{script_name}/subdomain` returns `enabled` ("Whether the Worker should be available on the workers.dev subdomain.") and `previews_enabled` ("Whether the Worker's Preview URLs should be available on the workers.dev subdomain."). It accepts `Workers Tail Read`, `Workers Scripts Read` or `Workers Scripts Write` (OpenAPI schema).
- **Confirmed:** the same path's `POST` changes both and accepts `Workers Scripts Write`. So anything that can edit the Worker can turn either back on.
- **Not documented:** an account-wide setting that forbids `workers.dev` or Preview URLs. The docs offer Cloudflare Access in front of them instead ("You can also protect all Workers or all Worker previews in an account").

`doctor` check: read the `subdomain` endpoint for all three prod Workers and fail unless both fields are `false`.

**The review was right** that `redirect` and `status` need the same explicit setting as `links-data`, because `workers_dev = false` alone leaves Version and Preview URLs to a stored setting.

## Tokens

### Per-Worker roles and product-level roles

**Confirmed.** Announced 2026-09-15: "Worker-level access controls are available today for all customers. You can configure them in the Cloudflare dashboard, through the API, or with Terraform." ([changelog](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/))

Roles, from [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/):

| Role | Description (quoted) |
|---|---|
| Metadata Read-Only | "Can view Workers metadata, settings, and observability data such as metrics, logs, and traces. Cannot view script source content or secret values." |
| Content Read-Only | "Can view Workers metadata and script source content. Cannot modify Workers." |
| Editor | "Can read, update, deploy, and rename existing Workers, including script content, settings, schedules, versions, deployments, and observability. Cannot create or delete Workers." |
| Admin | "Full control over Workers, including creating, reading, updating, deploying, deleting, and renaming Workers when granted at the product scope. Per-Worker Admin applies only to the selected Worker." |

Scopes, from the same page:

- **Workers product**: "All Workers in the account". "Product-level roles apply to every current and future Worker in the account."
- **Individual Workers**: "Only selected Workers". "You cannot grant per-Worker access to a Worker that does not exist yet. Creating new Workers requires product-level `Admin` access."
- API tokens "use the same Workers roles and scopes as members and User Groups". They "support product-level and, where available, resource-level permissions. They do not support platform-level permissions." ([Roles and permissions](https://developers.cloudflare.com/workers/authorization/))
- Granular permissions with Wrangler need an account-owned API token: "The `wrangler login` OAuth flow does not currently support granular authorization."

What per-Worker Editor is documented to allow: `wrangler deploy`, `wrangler versions upload`, `wrangler versions deploy`, `wrangler rollback`, and `wrangler secret put` / `delete`, each "`Editor` for that Worker". It also opens Data Studio on that Worker's Durable Objects: "Accessing Data Studio requires at least `Editor` access to the Worker that implements the Durable Object."

Routes need more: "To add, update, or remove Routes or Custom Domains, you need `Editor` access to the Worker and `Workers Routes Write` permission for every affected zone." And: "After a Route or Custom Domain is configured, you can deploy new Worker versions with only `Editor` access, as long as the deployment does not add, update, or remove that connection."

The legacy permissions map to product-scope roles: `Workers Scripts Read` is replaced by "`Content Read-Only` at the Workers product scope" and `Workers Scripts Edit` by "`Editor` at the Workers product scope". "There is no deprecation date right now."

**Custom Domains: confirmed not supported.** "Custom Domains do not currently support per-Worker roles. Support is planned."

Other limits from the same list:

- "Product-level Workers roles do not grant access to other Developer Platform products such as R2, D1, KV, Queues, Vectorize, or Hyperdrive."
- "Creating a new Worker requires Workers Admin because per-Worker permissions can only apply to Workers that already exist." This confirms ADR 0007's "only product-level Admin can create a Worker".

**Not documented:**

- The resource key that scopes an API token policy to one Worker. [Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/) still says "API token policies support three resource types: `User`, `Account`, and `Zone`", and the R2 page adds `Bucket`. The changelog shows only the dashboard ("Set the scope to **Specified Workers**").
- The new roles in the token permission reference. [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) lists only the legacy names (`Workers Scripts Read`, `Workers Scripts Edit`, …).
- The same four roles in the member [Roles](https://developers.cloudflare.com/fundamentals/manage-members/roles/) list, which still shows only `Workers Platform Admin`, `Workers Platform (Read-only)` and `Workers Editor` ("Can use the Workers Playground").

`doctor` check (ADR 0010 already has it for the `operator` token): confirm each per-Worker token is refused on a Worker outside its scope.

### Is Workers KV Edit always account-wide?

**Confirmed account-level. Namespace scope: not documented.**

- The token permission reference lists KV under **Account permissions** only: "Workers KV Storage Read: Grants read access to Cloudflare Workers KV Storage" and "Workers KV Storage Edit: Grants write access to Cloudflare Workers KV Storage" ([API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)).
- Token policies take `User`, `Account` and `Zone` resources, plus R2's `Bucket` (quoted above). No KV namespace resource is documented anywhere.
- The KV docs have no roles or permissions page. Their only scope statement is "KV operations are scoped to your account."
- The platform overview names resource scope as "a specific resource, such as an individual Worker or R2 bucket". KV is not named.

**The review was right**: `Workers KV Storage Edit` on the `operator` token reaches `LINKS`, `AUTH` and `FLAGS` alike. ADR 0007's "KV and D1 permissions are account-wide" holds for KV.

### Is there a KV read permission that can't list or bulk-read?

**Confirmed: no.** The OpenAPI schema gives the permissions each endpoint accepts:

| Endpoint | Accepts |
|---|---|
| `GET …/storage/kv/namespaces/{namespace_id}/keys` (List keys in a namespace) | `Workers KV Storage Write`, `Workers KV Storage Read` |
| `GET …/values/{key_name}` (Get a key's value) | `Workers KV Storage Write`, `Workers KV Storage Read` |
| `POST …/bulk/get` (Get multiple key-value pairs) | `Workers KV Storage Write`, `Workers KV Storage Read` |
| `GET …/metadata/{key_name}` | `Workers KV Storage Write`, `Workers KV Storage Read` |
| `GET …/storage/kv/namespaces` and `…/{namespace_id}` | `Workers KV Storage Write`, `Workers KV Storage Read` |

**The review was right**: ADR 0016's `production-plan` token, holding KV Read, can list every key in `LINKS` and `AUTH` and read every value.

A possible narrower grant is **not documented well enough to rely on**. The platform overview defines `Metadata Read-Only` as "View resource lists, settings, metrics, logs, and traces. Cannot view product content such as code, data, or stored objects", and says `wrangler kv namespace list` needs "Developer Platform `Metadata Read-Only` at a scope that includes KV". The docs don't say:

- whether a KV-product `Metadata Read-Only` can be put on an API token (tokens "do not support platform-level permissions", and no KV product-level role is listed for tokens);
- whether it would allow listing key names, which for `LINKS` are Short codes.

`doctor` check: call `GET /accounts/{account_id}/tokens/permission_groups` and look for a KV metadata-only group. If one exists, mint a token with it and confirm that `…/keys`, `…/values/{key}` and `…/bulk/get` are refused while `GET …/namespaces/{id}` succeeds. Inference: `tofu plan` of a `cloudflare_workers_kv_namespace` needs only the namespace read.

### R2 API tokens and keys

**Confirmed.** From [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/):

| Permission | Description (quoted) |
|---|---|
| Admin Read & Write | "Allows the ability to create, list, and delete buckets, edit bucket configuration, read, write, and list objects, and read and write to data catalog tables and associated metadata." |
| Admin Read only | "Allows the ability to list buckets and view bucket configuration, read and list objects, and read from the data catalog tables and associated metadata." |
| Object Read & Write | "Allows the ability to read, write, and list objects in specific buckets." |
| Object Read only | "Allows the ability to read and list objects in specific buckets." |

- **Per bucket:** "If you select the **Object Read and Write** or **Object Read** permissions, you can scope your token to a set of buckets." Through the API the resource is `"com.cloudflare.edge.r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET_NAME>": "*"` with the permission group `Workers R2 Storage Bucket Item Read` ("Can read and list objects in buckets.") or `Workers R2 Storage Bucket Item Write`.
- **So a key can be limited to reading one bucket.** It can still list that bucket.
- **S3 API only:** "The **Object Read & Write** and **Object Read only** permissions are only supported by the S3-compatible API, not the Cloudflare REST API."
- **Bucket configuration** (which includes lock rules) needs an Admin permission: bucket locks require "An API token with permissions to edit R2 bucket configuration" ([Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)).
- **The S3 credentials are the token:** "Access Key ID: The `id` of the API token. Secret Access Key: The SHA-256 hash of the API token `value`."
- **Lifetime:** account tokens "remain valid until manually revoked or until they reach a preset expiration date".

**Per prefix: confirmed, on temporary credentials only.** From [Temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/):

- "Every temporary credential is bound to a single bucket and a set of permitted operations. You can optionally restrict the credential further to specific paths within the bucket."
- "A temporary credential cannot exceed the permissions of its parent token."
- Paths: "Restrict access to specific prefixes or objects within the bucket" with `prefixes` and `objects`.
- Scopes are `object-read-only`, `object-read-write`, `admin-read-only` and `admin-read-write`.
- Per-action scoping (for example `["GetObject", "HeadObject"]`, which "denies `ListObjectsV2`") "is currently supported via local signing only".
- They can be minted locally by signing a JWT with the parent token's secret access key, or through the Temporary Credentials API.

**Not documented:** a long-lived R2 key scoped to a prefix. The long-lived permissions scope to buckets only.

On the review's finding 4 (the laptop key is Object Read & Write, so it can add objects under a lock): the bucket lock page says locks "prevent the deletion and overwriting of objects". It says nothing about new keys. **Inference:** new objects can be added by any Object Read & Write key. The review's reading is consistent with the docs. A read-only bucket-scoped key exists as an alternative, as the table shows.

### Token expiry and rolling

**Confirmed.**

- **Default:** "By default, tokens do not expire and are long lived." ([Restrict tokens](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/))
- **Dashboard:** an "optional expiration date" on account tokens ([Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)). "Dates selected are defined as 00:00 UTC of that day. For finer grained time selection, use the API."
- **API:** `POST /accounts/{account_id}/tokens` takes `expires_on` ("The expiration time on or after which the JWT MUST NOT be accepted for processing.") and `not_before` ("The time before which the token MUST NOT be accepted for processing."), plus `condition.request_ip` with `in` and `not_in` CIDR lists. `PUT /accounts/{account_id}/tokens/{token_id}` takes the same fields ([Create Token](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/), [Update Token](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/update/)).
- **Rolling:** `PUT /accounts/{account_id}/tokens/{token_id}/value`, "Roll the Account Owned API token secret." It needs `Account API Tokens Write` ([Roll Token](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/subresources/value/methods/update/)). "Rolling your API token into a new one will invalidate the previous token, but the access and permissions will be the same as the previous API token." ([Roll tokens](https://developers.cloudflare.com/fundamentals/api/how-to/roll-token/))
- **Inference:** rolling keeps the token ID, because the endpoint addresses an existing `token_id` and replaces only its value. If so, ADR 0012's protected token IDs survive a roll, and an R2 key's Access Key ID stays the same while its secret changes. Not stated outright.
- **Who can create tokens:** `Account API Tokens Write`, or since 2026-10-01 a member with the **API Token Provisioning** role, limited to "permissions which are a subset of their own account permissions" ([changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-account-api-token-provisioning/)).

**OpenTofu provider** (`cloudflare/cloudflare` v5.26.0, published 2026-09-26; [`cloudflare_account_token`](https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/account_token.md)):

- **Confirmed:** optional `expires_on`, `not_before` and `condition.request_ip`. Import is supported with `<account_id>/<token_id>`.
- **Confirmed:** `value` is a read-only attribute, "(String, Sensitive) The token value". So a token created by the provider has its value in state.
- **Confirmed by listing the provider's `docs/` tree:** there is no resource or attribute for the roll endpoint.

ADR 0007 keeps tokens out of OpenTofu, so the provider facts matter only if that changes.

### Does the Bot Fight Mode setting need Bot Management Write?

**Confirmed.** `PUT /zones/{zone_id}/bot_management` (Update Zone Bot Management Config) lists "Accepted Permissions (at least one required): `Bot Management Write`". Its description says "This API is used to update: **Bot Fight Mode**, **Super Bot Fight Mode**, **Bot Management for Enterprise**", and the field is `fight_mode` ([API reference](https://developers.cloudflare.com/api/resources/bot_management/methods/update/)). The provider's `cloudflare_bot_management` lists `Bot Management Read` and `Bot Management Write` and has `fight_mode` "(Boolean) Whether to enable Bot Fight Mode."

`Bot Management Write` is a zone permission ("Grants write access to Bot Management").

**The provider review was right.**

**Not documented:** whether an account-owned token works here. The account-token compatibility matrix marks "Super Bot Fight Mode ❌" and has no row for Bot Fight Mode ([Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)). `doctor` check: read `GET /zones/{zone_id}/bot_management` with the `production` token, and have bootstrap confirm the first `PUT` succeeds.

## Audit and logs

### What Audit Logs v2 says it covers

**Confirmed (general wording).** From [Audit Logs v2](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/):

- "All user-initiated actions are recorded automatically across both the Cloudflare API and dashboard."
- "Audit Logs covers ~95% of Cloudflare products, capturing actions from key endpoints, such as `/accounts`, `/zones`, `/user`, and `/memberships` APIs."
- "Audit Logs records create, update, and delete actions across all supported products. Selective logging of `GET` requests for sensitive read operations is planned for a future release."
- "`view` actions correspond to `GET` requests. These are defined in the schema but not currently captured in Audit Logs."
- Actors: `actor_type="account"` means "Action was performed using an account API token". Entries carry `actor.token_id`, `actor.token_name`, `actor.context` (`api_token`, `dash`, …), `raw.cf_ray_id`, `raw.method`, `raw.uri` and `resource.product`.
- Retention: "Audit logs are retained for 18 months before being deleted."
- `GET /accounts/{account_id}/logs/audit` accepts `Account Settings Read` or `Account Settings Write`.

From the GA changelog entry of 2026-03-10 ([Audit Logs changelog](https://developers.cloudflare.com/logs/changelog/audit-logs/)):

- "`GET` requests (view actions) and `4xx` error responses are not logged at GA."
- "Before and after values … is a highly requested feature and is on our roadmap for a post-GA release. In the meantime, we recommend using Audit Logs v1 for before and after values."
- "Audit Logs v1 continues to run in parallel. A deprecation timeline will be communicated separately."

Since 2026-07-27, Resource History gives "a side-by-side diff of what was modified" between two entries for one resource, in the dashboard and at `GET /accounts/{account_id}/logs/audit/{id}/history`.

**Not documented:** which 5% of products are missing. No page lists the products or endpoints v2 covers. `GET /accounts/{account_id}/logs/audit/product_categories` "Lists the available audit log product categories and the resource products each one expands to", but it needs a token, so its output isn't in the docs.

### Event by event

| Event | In v2? | In v1? | Label |
|---|---|---|---|
| Worker deploys and version rollouts | Not stated for Workers. Covered only by the general wording, since they are `PUT` and `POST` calls under `/accounts`. | Not stated | Not documented |
| Worker route changes | Same. They are `POST`, `PUT` and `DELETE` under `/zones/{zone_id}/workers/routes`. | Not stated | Not documented |
| Email Routing rule and address changes | Not stated for v2. | Yes | Confirmed for v1 |
| KV writes through the REST API | Not stated. They are `PUT` and `DELETE` under `/accounts/…/storage/kv`. | Not stated | Not documented |
| KV writes through a Worker binding | Not an API call. | Not an API call | Inference: not logged |
| R2 bucket-lock changes | Not stated. | Not in R2's list | Confirmed (the omission) |
| R2 object reads and writes | No. | No | Confirmed |
| Durable Object SQL through Data Studio | Not stated. | Yes | Confirmed for v1 |
| Durable Object SQL through `query/v2` called directly | Not stated. | Not stated | Not documented |

Details:

- **Workers.** The Workers documentation (`workers/llms-full.txt`) doesn't mention audit logs for deploys, versions or routes. Separately from the audit log, "Each deployment tracks who created it, when, and which version(s) it includes" ([Versions & Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)). `GET /accounts/{account_id}/workers/scripts/{script_name}/deployments` returns `author_email`, `source`, `created_on` and `annotations` (`workers/triggered_by`, `workers/message`), and accepts `Workers Tail Read`, `Workers Scripts Read` or `Workers Scripts Write`.
- **Email Routing.** "Email Service writes configuration changes to Cloudflare audit logs." Recorded actions: "Add, edit, or delete a routing rule. Add or delete a destination address. Change the status of a destination address (for example, from pending to verified). Update the catch-all rule. Enable, disable, or unlock the zone for Email Routing." ([Email Service audit logs](https://developers.cloudflare.com/email-service/observability/audit-logs/)). The page links to the v1 doc.
- **KV.** The KV documentation doesn't mention audit logs at all.
- **R2.** "The following configuration actions are logged": `CreateBucket`, `DeleteBucket`, `AddCustomDomain`, `RemoveCustomDomain`, `ChangeBucketVisibility`, `PutBucketStorageClass`, `PutBucketLifecycleConfiguration`, `DeleteBucketLifecycleConfiguration`, `PutBucketCors`, `DeleteBucketCors`. Lock changes are not in the list. "Audit Logs do not include data access operations, such as `GetObject` and `PutObject`." ([R2 audit logs](https://developers.cloudflare.com/r2/platform/audit-logs/)). The page links to the v1 doc and shows a v1-shaped example.
- **R2 Data Access Logs** are a separate, opt-in, per-bucket feature. They record `PutObject`, `DeleteObject`, `GetObject`, list and multipart operations from the S3 API, the Cloudflare API, public access and Worker bindings ("These events include the Worker script name"). They are viewed in Workers Observability. "Log delivery is asynchronous and best effort, and events may be delayed or omitted. … Do not rely on Data Access Logs as a complete record of bucket activity." "Bucket and configuration operations are not included." ([Data Access Logs](https://developers.cloudflare.com/r2/buckets/data-access-logs/))
- **Data Studio.** "All queries issued by the Data Studio are logged with audit logging v1 for your security and compliance needs. Each query emits two audit logs, a `query executed` action and a `query completed` action indicating query success or failure." ([Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/))

No event is documented as appearing **only** in v1. Email Routing, R2 and Data Studio are documented against v1, and nothing says whether v2 also carries them.

What the reviews said:

- **"KV writes never reach the audit log"** (security review, and ADR 0012's "Writes to shard rows, KV keys and R2 objects never reach the audit log"). **Not verified either way.** For writes through a binding it is a sound inference. For writes through the REST API the docs are silent on KV, and v2's general wording ("All user-initiated actions are recorded automatically across both the Cloudflare API and dashboard") points the other way. For R2 objects it is confirmed.
- **"The `operator` token can … run raw SQL on shards, with no audit trail"** (security review). **Wrong for Data Studio**, which is logged in v1. Not documented for direct `query/v2` calls.
- **"Data Studio queries are logged in Audit Logs v1, not the v2 that ADR 0012 watches"** (provider review). The first half is confirmed. "Not v2" is not stated by the docs.
- **"R2's audited-actions list still omits lock changes"** (provider review). **Right.**
- **"The audit watch deliberately skips Worker deploys, routes and Email Routing"** (security review). That describes ADR 0012, not Cloudflare. Whether v2 records the first two is not documented. Email Routing changes are recorded in v1.

`doctor` checks, each in a preview environment, reading `GET /accounts/{account_id}/logs/audit` afterwards and noting `resource.product`, `action.type` and `raw.uri`:

1. Call `…/logs/audit/product_categories` and save the list.
2. Deploy a Worker version, roll out a deployment, and roll back.
3. Add and remove a Worker route.
4. Add and change an Email Routing rule and a destination address.
5. Write and delete one KV key through the REST API, and one through `PUT …/bulk`.
6. Toggle a bucket lock rule (ADR 0016's `doctor` already has this).
7. Run one statement in Data Studio and one through `query/v2`. Check both v2 and v1 (`GET /accounts/{account_id}/audit_logs`).
8. Make one call that returns 403 with an under-scoped token and confirm it is absent, as the GA note says.

### Is `query/v2` in the public API reference?

**Mixed.**

- **Confirmed absent from the API reference site.** The [Durable Objects namespaces](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/) page lists two methods, "List Durable Object Namespaces" and "List Objects in a Durable Object namespace". The URL `…/namespaces/methods/query/` returns 404.
- **Confirmed absent from the TypeScript SDK** (`cloudflare` v7.2.0): its `durable-objects/api.md` lists only the two `list` methods.
- **Confirmed present in the published OpenAPI schema.** `POST /accounts/{account_id}/workers/durable_objects/namespaces/{id}/query/v2`, summary "Query a Durable Object", description "Executes one or more SQL queries against a Durable Object.", `x-api-token-group: ["Workers Scripts Write"]`, `x-fern-availability: "generally-available"`, `x-fern-audiences: ["sdk"]`. The body is either `durable_object_id` or a name, plus `queries`, each with `sql` and optional `params`.
- **Not documented:** any prose page for the endpoint, its limits, or its stability. The Data Studio page doesn't name it.

**The provider review was right** that it is absent from the API reference site. Its guess that the endpoint is "Data Studio's private backend" is not supported by the schema, which marks it generally available.

On the permission: the schema names the legacy `Workers Scripts Write`, which the Workers page maps to "`Editor` at the Workers product scope". The docs say access to a Durable Object "is determined by your access to the Worker that implements it" and that Data Studio needs "at least `Editor` access to the Worker that implements the Durable Object". **Inference:** per-Worker Editor on `links-data` is enough for `query/v2`, as ADR 0010 assumes. ADR 0010's existing `doctor` check of the `operator` token covers it.

### Logpush on Free, Pro and Business

**Confirmed available.**

- "Logpush is available with self-service, usage-based pricing on Free, Pro, and Business plans. Enterprise customers continue to work with their account team." ([Logpush pricing](https://developers.cloudflare.com/logs/logpush/pricing/), last updated 2026-09-30)
- The [Logpush](https://developers.cloudflare.com/logs/logpush/) availability table shows "Yes" for Free, Pro, Business and Enterprise.
- Changelog, 2026-09-30: "Cloudflare Logpush is now available on Free, Pro, Business, and Enterprise plans with usage-based pricing. Free, Pro, and Business customers can enable Logpush through self-service."

**Cost: confirmed.**

| Usage | Included each month | Rate |
|---|---|---|
| Logs exported to internal destinations | 25 GB per Cloudflare account | $0.03 per additional GB |
| Logs exported to external destinations | 25 GB per Cloudflare account | $0.10 per additional GB |
| Logs transformed | 1 GB per Cloudflare account | $0.04 per additional GB |

- "R2 and Pipelines are internal destinations. All other destinations are external."
- "Cloudflare measures export usage from uncompressed bytes successfully delivered."
- "Logpush rates do not include charges from destination services."
- **Inference:** an account's audit log is far below 25 GB a month, so the Logpush charge is $0, plus R2 storage and writes if R2 is the destination.

**Is the audit-log dataset included on Free? Inference: yes. Not stated outright.**

- For: `audit_logs_v2` is "an account-based dataset" and at GA was "Available via the `audit_logs_v2` account-scoped dataset". Audit logs themselves are "available on all plan types". The pricing page's only carve-out is Workers Trace Events, which "requires the Workers Paid plan".
- Against certainty: "Dataset availability depends on the Cloudflare products on your account", and "The availability of Logpush dataset fields depends on your subscription plan" ([Datasets](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/)). The Audit Logs v2 page still says "Enterprise customers can use Logpush to store audit logs beyond 18 months", which predates the change.
- No page says "audit logs on Free".

Other documented Logpush facts:

- "Logpush only pushes logs once as they become available and cannot backfill historical data. If your job is disabled or fails, logs generated during that period are permanently lost."
- "All Logpush API operations require **Logs: Write** permission because Logpush jobs contain sensitive information." "Account-scoped datasets require an account-scoped token." ([Logpush permissions](https://developers.cloudflare.com/logs/logpush/permissions/))
- "Resource History … is not exposed as additional fields in the `audit_logs_v2` Logpush dataset."

ADR 0012's rejected option "Logpush of `audit_logs_v2` needs Enterprise" is **contradicted** by the pricing page for Logpush in general. The **provider review was right** that this went stale, and right that the audit dataset on Free is unconfirmed.

`doctor` check: on the Free or Workers Paid account, create a Logpush job for `audit_logs_v2` to an R2 bucket and confirm it is accepted and delivers.

## Were the reviews right?

| Review claim | Verdict |
|---|---|
| Security 1: "KV bindings are always read-write" | Right as far as the docs go. No read-only option is documented. |
| Security 1: "Durable Objects have no per-caller auth" | Right. None is documented for Durable Object bindings. `ctx.props` exists for service bindings. |
| Security 1: a per-Worker Edit token might deploy a new binding to a resource it has no permission on (unverified) | The docs confirm it for KV, R2 and D1. |
| Security 2: "KV Edit is account-wide" | Right. |
| Security 2: "KV writes never reach the audit log" | Not verified. Sound for binding writes. For REST API writes the docs are silent and the general v2 wording points the other way. |
| Security 4: the `operator` token can run raw SQL "with no audit trail" | Wrong for Data Studio (logged in v1). Not documented for `query/v2`. |
| Security 4: the laptop R2 key could be read-only | Right. Bucket-scoped `Object Read only` exists. |
| Security, medium: enforce `workers_dev = false` and `preview_urls = false` on all three Workers | The facts behind it are confirmed. |
| Security, medium: "`production-plan` can read all of KV" | Right. |
| Security and provider: no token has an expiry | The API, dashboard and provider all support one. |
| Provider: Logpush is self-service on Free, Pro and Business | Right. |
| Provider: `query/v2` "is absent from the public API reference and appears to be Data Studio's private backend" | Half right. Absent from the reference site and SDK, present and marked generally available in the published OpenAPI schema. |
| Provider: "Data Studio queries are logged in Audit Logs v1, not the v2" | First half confirmed. "Not v2" is not stated. |
| Provider: "Custom Domains also don't support per-Worker roles yet" | Right. |
| Provider: "The `production` token also needs Bot Management Write to turn Bot Fight Mode off" | Right. |
| Provider: "R2's audited-actions list still omits lock changes" | Right. |
| Provider: "the new per-Worker and product-level Editor roles could narrow them further" | The roles exist as described. |

## Open questions

None of these is answered by the docs. Each needs a `doctor` check or a spike.

1. Does a `script_name` Durable Object binding, or a service binding, need any access to the target Worker?
2. Can a Durable Object binding carry `props`, and can the object read them?
3. Does a KV-product `Metadata Read-Only` role exist for API tokens, and does it exclude listing key names?
4. What is the token-policy resource key for one Worker, for tokens created through the API or the provider?
5. Which of Worker deploys, route changes, Email Routing changes, REST KV writes, bucket-lock changes and `query/v2` calls appear in Audit Logs v2, and under which `resource.product`?
6. Does the first creation of a Worker leave a stored `preview_urls` setting that later deploys don't change?
7. Does an account-owned token work against `PUT /zones/{zone_id}/bot_management`?
8. Is `audit_logs_v2` selectable in a Logpush job on a Free account?
9. Does rolling a token keep its ID?

## Sources

All fetched 2026-10-01.

Workers and bindings:
- https://developers.cloudflare.com/workers/authorization/ (last updated 2026-09-15)
- https://developers.cloudflare.com/workers/authorization/workers/ (2026-09-15)
- https://developers.cloudflare.com/workers/authorization/durable-objects/ (2026-09-15)
- https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ (2026-09-22)
- https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/workers/previews/
- https://developers.cloudflare.com/workers/runtime-apis/context/
- https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/ (2026-07-05)
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
- https://developers.cloudflare.com/kv/concepts/kv-bindings/ (2026-06-25)
- https://developers.cloudflare.com/kv/llms-full.txt, https://developers.cloudflare.com/durable-objects/llms-full.txt, https://developers.cloudflare.com/workers/llms-full.txt (searched for the absence claims)
- https://developers.cloudflare.com/durable-objects/observability/data-studio/ (2026-09-15)

Tokens and roles:
- https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/ (2026-09-28)
- https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/ (2026-09-28)
- https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/ (2026-04-20)
- https://developers.cloudflare.com/fundamentals/api/how-to/roll-token/ (2026-04-20)
- https://developers.cloudflare.com/fundamentals/manage-members/roles/ (2026-09-30)
- https://developers.cloudflare.com/fundamentals/manage-members/scope/ (2026-09-16)
- https://developers.cloudflare.com/changelog/post/2026-10-01-account-api-token-provisioning/
- https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/
- https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/update/
- https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/subresources/value/methods/update/
- https://developers.cloudflare.com/api/resources/bot_management/methods/update/
- https://developers.cloudflare.com/bots/get-started/bot-fight-mode/ (2026-08-03)
- https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/account_token.md (v5.26.0)
- https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/bot_management.md

R2:
- https://developers.cloudflare.com/r2/api/tokens/ (2026-10-01)
- https://developers.cloudflare.com/r2/api/s3/temporary-credentials/ (2026-04-24)
- https://developers.cloudflare.com/r2/buckets/bucket-locks/ (2026-04-30)
- https://developers.cloudflare.com/r2/platform/audit-logs/ (2026-09-09)
- https://developers.cloudflare.com/r2/buckets/data-access-logs/ (2026-09-09)

Audit logs and Logpush:
- https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/ (2026-09-14)
- https://developers.cloudflare.com/fundamentals/account/account-security/review-audit-logs/ (2026-04-22)
- https://developers.cloudflare.com/logs/changelog/audit-logs/
- https://developers.cloudflare.com/api/resources/accounts/subresources/logs/subresources/audit/methods/product_categories/
- https://developers.cloudflare.com/email-service/observability/audit-logs/ (2026-06-09)
- https://blog.cloudflare.com/introducing-automatic-audit-logs/ (published 2025-02-13; read for background only, since it describes the beta, which logged `GET` requests)
- https://developers.cloudflare.com/logs/logpush/ (2026-09-30)
- https://developers.cloudflare.com/logs/logpush/pricing/ (2026-09-30)
- https://developers.cloudflare.com/changelog/post/2026-09-30-logpush-usage-based-pricing/
- https://developers.cloudflare.com/logs/logpush/permissions/ (2026-04-27)
- https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/
- https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/audit_logs_v2/

API schema and SDK:
- https://github.com/cloudflare/api-schemas (`openapi.json`, commit `7350e99238483c77d6379e1f4217c770433a4563`): endpoint permissions (`x-api-token-group`), the `query/v2` operation, binding schemas, the `subdomain` endpoints
- https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/
- https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/durable-objects/api.md (v7.2.0)
