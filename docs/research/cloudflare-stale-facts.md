# Which Cloudflare platform facts in the ADRs have gone stale?

Research for [issue 45](https://github.com/andrewferk/url-shortener/issues/45). Facts only; the choices belong to the grilling tickets the issue names.

- **Fetched:** every Cloudflare page below was fetched on 2026-10-01 as raw Markdown (`<docs URL>/index.md`, with `curl`), not through a summarising fetcher. Quotes are exact.
- **Labels:** each row is one of **confirmed** (docs say what the ADR says), **contradicted** (docs say otherwise), **changed** (the ADR was right when written, and the docs now add or replace something), **not documented**, or **inference** (with what it is inferred from).
- **Reviews checked:** the [provider review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5941721651) and the [workflow review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5942300123) on issue 40. Section 3 says, claim by claim, whether each was right.

## 1. The table

| # | ADR | The claim as written | What the docs say now | Label | Page |
|---|---|---|---|---|---|
| 1 | 0007 | "Durable Objects use tagged `migrations`. Cloudflare calls it legacy, but it isn't deprecated" | "For new Workers, use the declarative `exports` field instead of the `migrations` array described on this page. The `migrations` array remains fully supported for existing Workers and continues to work as documented here." | changed: still supported, but the docs now direct new Workers to `exports` | [P1] |
| 2 | 0007 | "Moving to the newer `exports` stays possible later; moving back from `exports` is not" | "Existing Workers using the `migrations` array can move to `exports` without any data migration." and "Once a Worker has been deployed with `exports`, subsequent deploys cannot return to the legacy `migrations` array." | confirmed | [P2] |
| 3 | 0007 | "gradual deploys work with it [`migrations`] when no migration is pending" | For `migrations`: "new Worker versions with new migrations cannot be uploaded". For `exports`: "If your Wrangler configuration contains `exports` entries, `wrangler versions upload` fails fast with an actionable error." and "Gradual deployments are not supported with `exports`." | confirmed for `migrations`. With `exports` the docs' wording covers any config that contains `exports` entries, not only a pending change (see 2.1) | [P1] [P2] [P3] |
| 4 | 0007 | "its [`exports`] docs and code still disagree" | Not checked against Wrangler's source. One inconsistency inside the docs: the Worker Previews page still shows `migrations` in every Durable Object example and says "Every Durable Object setup requires ... a migration in your Wrangler config". | not verified | [P2] [P12] |
| 5 | 0007 | "a non-forced delete of `links-data` is refused while `redirect` binds to it" | The delete-Worker API's `force` parameter: "If true, delete the Worker even when other Workers still reference it. Service bindings in those Workers may be left broken. Durable Object namespaces implemented by the deleted Worker are deleted even if other Workers reference them." The `wrangler delete` reference lists only `--name`, `--env` and `--dry-run`. | inference from the `force` wording: the refusal itself is not stated, and no `--force` flag is on the `wrangler delete` page | [P4] [P5] |
| 6 | 0007 | "so is a `deleted_classes` migration of its classes" | The legacy page documents no such refusal. It says only: "Do not run a Delete migration on a class without first ensuring that you are not relying on the Durable Objects within that Worker anymore, that is, first remove the binding from the Worker." The refusal is documented for `exports`: "No other Worker in your account may bind to the namespace. If another Worker still binds to the class, the deploy is rejected with `tombstone_delete_blocked_by_external_bindings` and the list of referencing scripts is returned." | not documented for `migrations`; confirmed for `exports` | [P1] [P2] |
| 7 | 0007 | "Durable Object lifecycle changes should be deployed independently of other code changes." (quoted) | "To limit the blast radius of these deployments, Durable Object lifecycle changes should be deployed independently of other code changes." | confirmed | [P3] |
| 8 | 0010 | "Instances are kept for 30 days, the maximum." | "Retention limit for completed Workflow instance state: 3 days [Free], 30 days [Paid]" | confirmed (Workers Paid) | [P7] |
| 9 | 0010 | "about 4k steps per shard, under the 10k default step limit" | "Maximum steps per Workflow: 1,024 [Free], 10,000 (default) / configurable up to 25,000 [Paid]" | confirmed (Workers Paid) | [P7] |
| 10 | 0010 | "resuming is either restarting the failed child or rerunning the whole operation"; children are named `op_…-<nn>` | `create`: "Throws an error if the provided ID is already used by an existing instance that has not yet passed its retention limit. To re-run a workflow with the same ID, you can `restart` the existing instance." `createBatch`: "this operation is idempotent and will not fail if an ID is already in use. If an existing instance with the same ID is still within its retention limit, it will be skipped and excluded from the returned array." | changed: a rerun that re-creates the same child IDs within 30 days throws with `create` and is skipped with `createBatch`; `restart` is the documented way to run the same ID again | [P8] |
| 11 | 0010 | No cost is stated for Workflows. "Workflow limits are now a dependency: the step limit and 30-day retention." | Steps are a billed dimension: "500,000 included per month + $0.80/ additional 100,000 per month" on Workers Paid; "3,000 per day" on Workers Free. | changed: billing is a new dependency (see 2.2) | [P6] [P9] |
| 12 | 0016 | "Previews, drills and the drift plan run within Workers Paid's included amounts" | Same pricing. A drill's step count is not defined in the ADRs. | inference: a drill of 2,560 Links is far below 500,000 steps (see 2.2). Not confirmed for a preview account on Workers Free (3,000 steps a day, 1,024 steps per instance, 3-day retention) | [P6] [P7] |
| 13 | 0011 | "It sends through Cloudflare Email Routing's `send_email` binding, restricted to the Operator's verified address." | The binding is now documented under "Cloudflare Email Service", which has two features: Email Sending (beta, Workers Paid) and Email Routing. `destination_address`: "The binding can only send to the single destination address configured here." | changed (product name and docs location); the restriction is confirmed | [P10] [P11] |
| 14 | 0011 | "Email Routing is free." | "Sending to verified destination addresses in your account is free on all plans, including when only Email Routing is configured." and "Sends to verified destination addresses are free and do not count toward the included quota." | confirmed | [P13] |
| 15 | 0011 | (the call is not specified) | "The `EmailMessage` API remains supported for backward compatibility. Use it when you already have a raw RFC 5322 MIME message to send. For new code, prefer the structured `send()` method above." The interface marks `EmailMessageBuilder` as "Structured email builder (recommended)". | changed: the raw-MIME `EmailMessage` API is the one labelled legacy | [P11] |
| 16 | 0011 | "Without this handler, an uncaught exception shows the Visitor Cloudflare's 1101 page and writes no event, so crashes would be invisible to the error rate." | The Redirect event part is the design's own. Cloudflare-side: "Logs include invocation logs, custom logs, errors, and uncaught exceptions." | confirmed as far as it goes; Workers Logs is a second record of an uncaught exception (see 2.4) | [P14] |
| 17 | 0011 | "Cloudflare Notifications: there's no Worker error-rate or exception alert below Enterprise." | The list of available Notifications has no Workers section at all. The nearest alert, "Advanced Error Rate Alert", is "Included with Enterprise plans." Separately, Workers Issues (open beta, "available to all Workers accounts") can send an issue to a "Coding agent", "Generic webhook", "Chat" or "Incident management" destination. | confirmed for Cloudflare Notifications; changed in that Issues now exists on every plan, with no email destination listed | [P15] [P16] [P17] |
| 18 | 0015, PRD | "the Workers' integration tests in local `workerd` (`@cloudflare/vitest-pool-workers`)" | "`@cloudflare/vitest-plugin` replaces `@cloudflare/vitest-pool-workers`. The package API and Vitest configuration are unchanged." Also: "For most projects, use the Workers Vitest integration for unit tests and the `createTestHarness()` API for integration tests." | changed: the package is renamed, and Cloudflare now points integration tests at `createTestHarness()` (see 2.5) | [P18] [P19] |
| 19 | 0007 | Worker Previews "create a Preview per branch with its own Durable Objects and delete it automatically" | "Automatically provisions a new Durable Object namespace and storage for each Preview." but only "For a class defined in the same Worker without `script_name`". "State persists across deployments within the same Preview and is deleted when the Preview is deleted." | confirmed for same-Worker classes only; automatic deletion of the Preview itself was not checked | [P12] |
| 20 | 0007 | "Cron Triggers don't run in Previews" | "Cron Triggers target production. Previews do not create separate scheduled invocations, and the scheduler does not call a Preview's `scheduled()` handler today." | confirmed | [P12] |
| 21 | 0007 | "KV and D1 are shared across every Preview" | "Two Previews bound to the same account-level resource ID or name share its data or instances. Bind a Preview to a different resource to isolate it." KV: "Two Previews sharing the same `id` share namespace data." D1: "Two Previews sharing the same `database_id` share rows." | contradicted as worded: shared only when bound to the same ID. Nothing creates a namespace or database per Preview | [P12] |
| 22 | 0007 | "a Preview lives under the production Worker, so its token can deploy to production" | "Previews give each branch an isolated, production-like environment under the same Worker." Token scoping for Previews was not checked. | first half confirmed; the token consequence is not verified | [P20] |
| 23 | 0001 | "≈256k req/s of fallback reads at the 1k req/s-per-object soft limit" | Limits page: "An individual Object has a soft limit of 1,000 requests per second." Rules page: "A single Durable Object can handle approximately **500-1,000 requests per second** for simple operations." with "Simple pass-through (minimal parsing): ~1,000 req/sec", "Moderate processing (JSON parsing, validation): ~500-750 req/sec", "Complex operations (transformation, storage writes): ~200-500 req/sec". | confirmed as the soft limit; the newer guidance puts storage writes at about 200 to 500 req/s (see 2.7) | [P21] [P22] |
| 24 | 0001 | (no ADR says how a Worker calls a Durable Object) | "Projects with a compatibility date of `2024-04-03` or later should use RPC methods. RPC is more ergonomic, provides better type safety, and eliminates manual request/response parsing." | documented recommendation the ADRs don't mention | [P22] |
| 25 | 0008 | "`STRICT` and `WITHOUT ROWID` are used if Durable Object SQLite accepts them. Otherwise the tables are plain, with the same keys." | Neither keyword appears on the Durable Objects SQLite storage API page or the storage best-practices page. D1's SQL statements page mentions them only as columns of `PRAGMA table_list` output. | not documented for Durable Objects (see 2.8 for the test) | [P23] [P24] [P25] |
| 26 | 0008 | "about $10 per 1M new Links once the included 50M rows written are used up" | "Rows written: First 50 million / month included + $1.00 / million rows". "When writing data, every row update of an index counts as an additional row." | pricing confirmed; the rows-per-Link count behind $10 was not re-derived. How a plain `TEXT PRIMARY KEY` bills is an inference (see 2.8) | [P23] [P26] |
| 27 | 0013 | "CAA records allow only the certificate authorities that Universal SSL uses." | "Cloudflare adds CAA records automatically when you have Universal SSL and add any CAA records to your zone." "This list is not exhaustive, and other CAs might be added or removed for operational reasons." "Cloudflare can change the certificate authority without prior notification, and will not send any notification as the change happens." | contradicted in effect: Cloudflare adds its own CAA records as soon as the zone has any, and the set of authorities can change without notice (see 2.9) | [P27] [P28] |
| 28 | 0007 | "Routes are plain Worker routes, not Custom Domains." | "Custom Domains are recommended for use cases where your Worker is your application's origin server." "Routes are recommended for use cases where your application's origin server is external to Cloudflare." "If your Worker is your application's origin, use Custom Domains." | the ADR's choice goes against the documented recommendation | [P29] [P30] |
| 29 | 0007 | Custom Domains: "each issues an Advanced Certificate that outlives the domain" | "Creating a Custom Domain will also generate an Advanced Certificate on your target zone for your target hostname." "When you delete a Custom Domain, the associated Advanced Certificate is **not** automatically deleted." | confirmed | [P31] |
| 30 | 0007 | Custom Domains: "`wrangler delete` can leave orphaned DNS records behind" | The Custom Domains page says only that "Cloudflare will create DNS records ... on your behalf". Neither it nor the `wrangler delete` reference says what happens to those records when the Worker or the Custom Domain is deleted. | not documented (see 2.10 for the test) | [P31] [P5] |
| 31 | 0007 | Custom Domains: "in CI, Wrangler silently takes over a hostname already attached to another Worker" | Not on the Custom Domains page. Not checked further; the ticket did not ask. | not verified | [P31] |
| 32 | 0007 | "Only one subdomain level is used, because Free Universal SSL covers no deeper." | "Universal SSL covers the apex and one level of subdomain only, so Universal SSL does not cover a hostname at the second level or deeper." | confirmed | [P31] |
| 33 | 0007 | "`cloudflare_ruleset` owns the whole rule list" (no ADR mentions `ref`) | "the Cloudflare provider may delete a rule and create a new one when you modify a ruleset in your Terraform configuration." "To keep existing rule IDs when making changes to a ruleset through Terraform, add a `ref` field to each rule." | documented behaviour the ADRs don't mention | [P32] |

## 2. Detail by topic

### 2.1 Durable Object `exports` (ADR 0007)

All from [P2] unless marked.

- **What it is.** "The `exports` field in your Wrangler configuration file is the declarative way to manage Durable Object class lifecycle. You declare each Durable Object class your Worker exports — along with whether it is live, deleted, renamed, or transferred — and Cloudflare reconciles your declaration against the namespaces that have already been provisioned for your Worker."
- **Nothing is implicit.** "A class that appears only in your code is ignored until you declare it in `exports`; Cloudflare does not provision a namespace implicitly."
- **How each operation is written.** Each entry is keyed by class name with `"type": "durable-object"`:

  | Operation | `state` | Required fields |
  |---|---|---|
  | Define a new class (default) | `"created"` (or omitted) | `storage` |
  | Delete a class | `"deleted"` | none |
  | Rename a class | `"renamed"` | `renamed_to` |
  | Transfer a class to another Worker | `"transferred"` | `transferred_to` |
  | Receive a transfer from another Worker | `"expecting-transfer"` | `storage`, `transfer_from` |

  - **Create:** `"storage": "sqlite"` is "the recommended and only path for new namespaces".
  - **Rename:** needs the `renamed` tombstone plus a live entry for the new name. The docs describe a "three-deploy rename" to avoid errors during rollout.
  - **Transfer:** "The recommended sequence is four deploys". Both Workers must be in the same account.
  - **Delete:** "Deleting a class removes its namespace and **all of its stored data permanently** — this is not a soft delete."
- **What "delete refused while another Worker binds" covers.** A `deleted` tombstone "has two preconditions enforced at deploy time":
  - "The class must not be present in your Worker code."
  - "No other Worker in your account may bind to the namespace. If another Worker still binds to the class, the deploy is rejected with `tombstone_delete_blocked_by_external_bindings` and the list of referencing scripts is returned. Redeploy those Workers without the binding first, then re-run your deploy."

  So the documented guard covers deleting a class through `exports`. It is separate from deleting the whole Worker (table row 5), and the legacy page documents no equivalent for `deleted_classes` (row 6).
- **A `script_name` binding from another Worker.** The docs show one Worker binding to a class another Worker owns, using `script_name`, in the transfer flow: "update its `durable_objects.bindings` entry to point at the target Worker with `script_name`". Bindings from other Workers are tracked: errors and notices carry a `referencing_scripts` list of "other Workers in the account whose bindings still resolve to the affected namespace". The docs don't say whether the binding Worker (`redirect`) must itself use `exports`; its `durable_objects.bindings` entry is ordinary binding config, and only the owning Worker (`links-data`) declares the class. That last sentence is an inference from the transfer example, where the source Worker keeps a `script_name` binding after its own entry becomes a tombstone.
- **`migrations` to `exports` and back.**
  - Forward: "Existing Workers using the `migrations` array can move to `exports` without any data migration. The provisioned namespaces remain in place; only the configuration shape changes."
  - Not both: "Durable Object entries in `exports` are mutually exclusive with `migrations`. A Worker configuration that contains both is rejected at validation. Workflow entries in `exports` can be used alongside `migrations`."
  - Not back: "Once a Worker has been deployed with `exports`, subsequent deploys cannot return to the legacy `migrations` array."
- **Constraints that touch ADRs 0007 and 0016.**
  - "**`wrangler versions upload` does not apply lifecycle changes.** ... If your Wrangler configuration contains `exports` entries, `wrangler versions upload` fails fast with an actionable error."
  - "**Gradual deployments are not supported with `exports`.** Lifecycle changes are atomic at the Cloudflare control plane and cannot be rolled out gradually."
  - "**Rollbacks cannot cross a lifecycle change.** You cannot roll back to a version deployed before an `exports`-driven lifecycle change."
  - Whether `wrangler versions upload` works for a Worker with `exports` when no lifecycle change is pending is not clear from this wording. [P3] says only that "Versions of Worker bundles that change Durable Object class lifecycle cannot be uploaded." A spike would run `wrangler versions upload` on a Worker whose `exports` is unchanged.
- **Environments and Previews.** "Each environment maintains its own provisioned namespaces, so tombstones apply only within the environment they are declared in."

### 2.2 Workflows (ADRs 0010, 0016)

- **Step billing.** [P6]: "Workflows are billed on four dimensions": CPU time, requests, storage and steps.

  | Unit | Workers Free | Workers Paid |
  |---|---|---|
  | Steps | 3,000 per day | 500,000 included per month + $0.80/ additional 100,000 per month |
  | Storage | 1 GB-month | 1 GB-month included + $0.20/ GB-month |

- **Start date.** [P6]: "Billing for Workflows steps and storage will apply starting August 10th, 2026." [P9] is more careful: "Starting no earlier than August 10th, 2026, Cloudflare will begin billing for step and storage usage on Workers Paid plans." Neither page says billing has begun.
- **What counts as a step.** [P9]: "A step is each unit of work executed by a Workflow, including step operations such as sleeping or waiting for events." [P6]: "Step count does not include rollback handlers or retries."
  - This differs from the step *limit*, where [P7] says "`step.sleep` does not count towards the maximum steps limit".
  - [P9]: "You can query Workflows analytics, including `stepCount` for a Workflow instance, with the GraphQL Analytics API."
- **A full reconcile, recomputed.** Inference from ADR 0010's own figures ("about 4k steps per shard" at peak, 256 shards) and [P6]'s prices:
  - 256 × 4,000 = 1,024,000 child steps. The parent adds its own: ADR 0010 has it check its children "once a minute", and each sleep is a billed step, so about two steps a minute for as long as the reconcile runs. The ADRs give no duration, so this part is not quantified.
  - With the month's 500,000 included steps otherwise unused: 524,000 over, which is $4.19 pro rata. The docs don't say whether a part of 100,000 is rounded up; if it is, six units cost $4.80.
  - With the included steps already spent: 1,024,000 steps is $8.19.
  - This is the peak case (1B Links). The step count scales with Links per shard, at one step per 1,000 keys or rows.
- **A monthly restore drill, recomputed.** ADR 0016 seeds 2,560 Links, 10 per shard, and runs six restores. Neither ADR gives a step count for a drill.
  - Inference: every page in a drill holds 10 rows, so each child needs about one page step per pass plus its fixed steps. Even at 20 steps per child and ten shard-wide operations, that is 256 × 20 × 10 ≈ 51,000 steps, about a tenth of the included 500,000. The assumptions (20 and ten) are mine, chosen to be high.
  - The included amount is per account per month and shared with every other Workflow in that account.
  - If the drill runs in a preview account on Workers Free (ADR 0007 allows that), the Free limits apply: 3,000 steps per day, 1,024 steps per instance, 100 concurrent instances and 3-day retention [P6] [P7]. A drill's fan-out of 256 children would exceed 100 concurrent instances unless `--concurrency` is lowered, and 51,000 steps would exceed 3,000 a day. This is an inference from the same estimate.
  - A spike would read `stepCount` for one drill and one reconcile from the GraphQL Analytics API.
- **`createBatch`.** [P8]: "`createBatch(batch: WorkflowInstanceCreateOptions[]): Promise<WorkflowInstance[]>`". "Unlike `create`, this operation is idempotent and will not fail if an ID is already in use. If an existing instance with the same ID is still within its retention limit, it will be skipped and excluded from the returned array."
- **`restart`.** [P8]: "Restart a Workflow instance from the beginning, or from a specific step." "When restarting from a specific step, the cached results of every earlier step are reused, while the target step and any steps that follow it run again." [P33]: "Restarting an instance will immediately cancel any in-progress steps, erase any intermediate state, and treat the Workflow as if it was run for the first time."
- **Instance-ID reuse within retention.** [P8], on `create`: "Throws an error if the provided ID is already used by an existing instance that has not yet passed its retention limit. To re-run a workflow with the same ID, you can `restart` the existing instance." Retention can be shortened per Workflow (`default_retention`) or per instance (`retention`), which also shortens how long an ID stays taken; that last clause is an inference from the same sentence.
- **The `schedules` array.** [P33]: "If you want to create Workflow instances on a recurring interval, add a `schedules` array (up to 100 cron expressions per account) to the Workflow binding in your Wrangler configuration". "Each matching cron expression creates a new Workflow instance automatically."
- **Limits ADR 0010 leans on.** [P7]: "Maximum Workflow instance creation rate: 300 per second per account, 100 per second per workflow" (Paid), and "Each instance created or restarted counts towards this limit". "Concurrent Workflow instances (executions) per account: 100 [Free], 50,000 [Paid]".

### 2.3 Email (ADR 0011)

- **Where it lives now.** [P10] is titled "Cloudflare Email Service" and lists two features: "**Email Sending**", badged Beta and "Available on Workers Paid plan", "for outbound transactional emails"; and "**Email Routing**", "Available on Free and Paid plans", "for handling incoming emails with Workers or routing to email addresses". The old Email Routing page for sending from Workers now redirects to the Email Service Workers API page [P11].
- **Still free to verified addresses.** [P13]: "Sending to verified destination addresses in your account is free on all plans, including when only Email Routing is configured." "Sends to verified destination addresses are free and do not count toward the included quota." Sending to arbitrary recipients "requires the Workers Paid plan": "3,000 included per month, then $0.35 per 1,000 emails".
- **Which API is legacy.** [P11], under the heading "Legacy `EmailMessage` API": "The `EmailMessage` API remains supported for backward compatibility. Use it when you already have a raw RFC 5322 MIME message to send. For new code, prefer the structured `send()` method above."
- **The recommended call.** [P11]: `env.EMAIL.send({ to, from, subject, html, text })`, typed as `send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult>`, with the builder commented "Structured email builder (recommended)". It returns `{ messageId }`, and "Errors are thrown as standard Error objects with a `code` property".
- **Restricting the binding.** [P34]: "The sender address must always belong to a domain you have onboarded to Email Service." "`destination_address`: The binding can only send to the single destination address configured here."
- **Not checked:** DMARC alignment of this mail. ADR 0011's bootstrap check stands as the test.

### 2.4 Worker errors (ADR 0011)

- **What Workers Logs records by default.** [P14]:
  - "All newly created Workers will come with the observability setting enabled by default."
  - "Logs include invocation logs, custom logs, errors, and uncaught exceptions."
  - "By default a Worker will emit invocation logs containing details about the request, response and related metadata."
  - The same page also says "You must add the observability setting for your Worker to write logs to Workers Logs. Add the following setting to your Worker's Wrangler file and redeploy your Worker." It does not say what a `wrangler deploy` does when the rendered config has no `observability` block. A `doctor` check would deploy without the block and look for an invocation log.
  - Pricing and retention: Workers Free "200,000 per day", "3 Days"; Workers Paid "20 million included per month +$0.60 per additional million", "7 Days". "If `head_sampling_rate` is unspecified, it is configured to a default value of 1 (100%)." Their example counts "2 logs per request".
- **What Issues offers.** [P16]:
  - "Issues provides built-in error monitoring for Cloudflare Workers. It detects production failures and groups related failures into issues without an SDK or application wrapper."
  - "When a Worker throws an uncaught exception, fails an invocation, returns a `5xx` response, or logs an error, Issues records the failure as an occurrence."
  - It is off until enabled: "set `observability.issues.enabled` to `true`", and "Requires Wrangler 4.134.0 or later." If enabled only in the dashboard, "the next deployment turns off Issues."
  - "Issues is available to all Workers accounts in open beta. It is free to use during the beta period."
  - Note for ADR 0011: its top-level handler answers 500, and a `5xx` response is one of the signals Issues records.
- **Issues automations.** [P17]:
  - Triggers: "Occurrence threshold: Runs once when an issue's occurrence count crosses the configured threshold." and "Recurrence after inactivity".
  - Destinations: "Coding agent", "Generic webhook", "Chat", "Incident management". Email is not in the list.
  - "Generic webhooks use the standard Cloudflare Notifications webhook payload." "A succeeded run means Cloudflare Notifications accepted the event for delivery."
  - Limits [P16]: 50 automations per account; "Minimum occurrence threshold: 1".
  - Not documented: whether an Issues webhook destination needs the zone plan that Notifications webhooks need (below).
- **Notification destinations below Enterprise.** [P35]:
  - "Free plans can set up email-based Notifications."
  - "Professional and higher plans can also use webhooks."
  - "Business and higher plans can also access PagerDuty."
  - "Webhooks are available in zones on a Free plan if your Cloudflare account has at least one zone in a Professional plan (or higher)."
- **No Workers alert type.** [P15] lists alert types by product; it has no Workers section, and the word "Worker" does not appear on the page. Its "Advanced Error Rate Alert" is for "Enterprise customers who want to receive a notification when Cloudflare detects edge and/or origin errors" and is "Included with Enterprise plans."

### 2.5 Testing (ADR 0015, PRD)

- **The rename.** [P18]: "`@cloudflare/vitest-plugin` replaces `@cloudflare/vitest-pool-workers`. The package API and Vitest configuration are unchanged." The manual change is `"@cloudflare/vitest-pool-workers": "^0.16.0"` to `"@cloudflare/vitest-plugin": "^1.0.0"`, plus the import and `types` paths. A codemod exists: `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`.
- **What the plugin is still for.** [P36]: "Cloudflare provides the `@cloudflare/vitest-plugin` Vite plugin, which runs your Vitest tests inside the Workers runtime." It "Supports both **unit tests** and **integration tests**" and "Supports projects with multiple Workers."
- **What `createTestHarness()` replaces.** It replaces `unstable_startWorker()`, not the Vitest plugin. [P37]: "`unstable_startWorker()` is deprecated. Cloudflare recommends using the `createTestHarness()` API, which provides a harness specifically designed for integration testing."
- **What Cloudflare now recommends.** [P19]: "For most projects, use the Workers Vitest integration for unit tests and the `createTestHarness()` API for integration tests."
  - On the Vitest integration: "Direct assertions against binding state, such as values written to KV, R2, D1, or Durable Objects." "Direct calls to Durable Objects and other runtime APIs."
  - On the harness: "Use the `createTestHarness()` API to exercise one or more Workers as a whole and test how they interact with each other and with external services." "Confidence from exercising production Worker builds." "Compatibility with any Node.js test runner and tools such as Playwright or MSW."
  - [P38]: "`createTestHarness()` is a Wrangler API for integration testing from any Node.js test runner."
- The PRD's tests ("the shard and Creator objects, outbox delivery, Redirects, the Link API") span both descriptions. Which tool fits which test is a choice, not a fact.

### 2.6 Worker Previews (ADR 0007)

All from [P12] unless marked.

- **Per-Preview, automatically:** Durable Objects ("Automatically provisions a new Durable Object namespace and storage for each Preview") and Containers.
- **Shared unless bound to a different resource:** `kv_namespaces`, `d1_databases`, `r2_buckets`, `queues.producers`, `vectorize`, `hyperdrive`, `analytics_engine_datasets`, `pipelines`, `workflows`, `secrets_store_secrets`, `dispatch_namespaces`, `mtls_certificates`, `vpc_services`, `ratelimits`. `send_email` is listed as "Not applicable".
- **`script_name` Durable Objects.** The only sentence is: "For a class defined in the same Worker without `script_name`, each Preview automatically gets its own namespace and storage." The docs don't say what a Preview's `script_name` binding resolves to. That it resolves to the other Worker's one namespace, shared by every Preview, is an inference from that sentence and from the service-binding rule below. A spike would create two Previews of `redirect` and check whether both see the same object in `links-data`.
- **Service bindings.** "the Preview of Worker A can only bind to the production Worker B. It does not automatically bind to a matching Preview of Worker B." Confirmed not per-Preview.
- **Workflows.** "Adding a Workflow binding to a `previews` block binds the Preview to an existing Workflow. It does not create or deploy a Preview-specific Workflow." "Previews bound to the same Workflow share its instances." "Cloudflare is working on automatic per-Preview Workflow provisioning". Confirmed not per-Preview.
- **Also not per-Preview:** "Previews cannot consume messages from Queues today." "Cron Triggers target production." "Production routes target production. Previews do not take over zone routes, production custom domains, Queue consumers, or other production triggers."
- **Previews don't inherit production settings.** [P20]: "Previews do not inherit production settings. Define them in the `previews` block of your Wrangler configuration file."

### 2.7 Durable Objects guidance (ADR 0001)

- **The soft limit is still documented.** [P21]: "An individual Object has a soft limit of 1,000 requests per second." The same answer adds: "A simple storage `get()` on a small value that directly returns the response may realize a higher request throughput compared to a Durable Object that (for example) serializes and/or deserializes large JSON values."
- **The newer guidance grades it by work per request.** [P22], under "Message throughput limits":

  | Operation type | Throughput |
  |---|---|
  | Simple pass-through (minimal parsing) | ~1,000 req/sec |
  | Moderate processing (JSON parsing, validation) | ~500-750 req/sec |
  | Complex operations (transformation, storage writes) | ~200-500 req/sec |

  "If your use case exceeds these limits, shard your workload across multiple Durable Objects."
- **What ADR 0001 applies the figure to.** Its 256k req/s is for "fallback reads". Where a shard's fallback read sits in the table is not stated by the docs. Creates are storage writes, which the table puts at about 200 to 500 req/s per object, or about 51k to 128k req/s across 256 shards (my arithmetic).
- **Overload behaviour.** [P21]: "A Durable Object that receives too many requests will, after attempting to queue them, return an overloaded error to the caller."
- **RPC.** [P22], under "Use RPC methods instead of the `fetch()` handler": "Projects with a compatibility date of `2024-04-03` or later should use RPC methods. RPC is more ergonomic, provides better type safety, and eliminates manual request/response parsing."

### 2.8 SQLite in Durable Objects (ADR 0008)

- **`STRICT` and `WITHOUT ROWID`: not documented for Durable Objects.** Neither word appears in [P23] or [P24]. [P23] lists only extensions (FTS5, JSON, math) and points to workerd's source for "the full list of supported functions".
  - The nearest evidence is for D1, not Durable Objects. [P25] documents `PRAGMA table_list` as returning "`wr`: `1` if the table is a WITHOUT ROWID table, `0` otherwise" and "`strict`: `1` if the table is a STRICT table, `0` otherwise", and its example output shows Cloudflare's own `_cf_KV` table with `wr` = 1. That D1 can hold such tables suggests the SQLite build allows them; that Durable Objects accept the same DDL is an inference, and no page says so.
  - The test: in a SQLite-backed Durable Object, run ADR 0008's `CREATE TABLE ... STRICT, WITHOUT ROWID` and see whether `ctx.storage.sql.exec` throws. Run it both in local `workerd` and deployed, since the two could differ.
- **How rows written are billed.** [P26]: "Rows written: 100,000 / day [Free]; First 50 million / month included + $1.00 / million rows [Paid]". "Deletes are counted as rows written." "Each `setAlarm()` is billed as a single row written."
- **Indexes.** [P23]: "When writing data, every row update of an index counts as an additional row." D1's pricing page, which [P26] says its rates match, puts it as: "Indexes will add an additional written row when writes include the indexed column, as there are two rows written: one to the table itself, and one to the index." [P39]
- **A plain `TEXT PRIMARY KEY`.** Cloudflare's docs don't mention it. Inference, from Cloudflare's index rule plus SQLite's own documentation:
  - SQLite: "In an ordinary SQLite table, the PRIMARY KEY is really just a UNIQUE index." [S1] And: "In most cases, UNIQUE and PRIMARY KEY constraints are implemented by creating a unique index in the database. (The exceptions are INTEGER PRIMARY KEY and PRIMARY KEYs on WITHOUT ROWID tables.)" [S2]
  - So an insert into a plain table with a `TEXT PRIMARY KEY` writes the table row and one row of the automatic index: two rows written. The same insert into a `WITHOUT ROWID` table would write one.
  - [P24] words the index rule as "at least one (1) additional row written to account for updating the index".
  - Cloudflare doesn't say whether its counter treats the automatic index as "an index". The test: insert one row into each kind of table and read `cursor.rowsWritten`, which [P23] says is "used for SQL billing".

### 2.9 CAA (ADR 0013)

- **Cloudflare adds its own.** [P27]: "Cloudflare adds CAA records automatically when you have Universal SSL and add any CAA records to your zone. These records make sure Cloudflare can still issue Universal certificates on your behalf." [P40]: "If you are using Cloudflare as your DNS provider, then the CAA records will be added on your behalf."
- **They are invisible in the dashboard.** [P27]: "If Cloudflare has automatically added CAA records on your behalf, these records will not appear in the Cloudflare dashboard. However, if you run a command line query using `dig`, you can see any existing CAA records, including those added by Cloudflare".
- **The set changes.** [P27] shows records for Google Trust Services, Let's Encrypt, SSL.com and Sectigo, then: "This list is not exhaustive, and other CAs might be added or removed for operational reasons."
- **Without notice.** [P28]: "For Universal SSL certificates, Cloudflare chooses the certificate authority (CA) used for your certificate. Cloudflare can change the certificate authority without prior notification, and will not send any notification as the change happens."
- **Who the docs say should create CAA records.** [P27] lists cases about custom origin certificates and Custom Hostnames. A zone that uses only Universal SSL is not among them.
- **Advanced certificates differ.** [P27]: "This does not apply to Advanced Certificate Manager. ... Cloudflare does not add CAA records automatically for them." This matters only if Custom Domains were used, since each creates an Advanced Certificate (row 29). Whether a Custom Domain's certificate is then blocked by a hand-kept CAA set is not documented.

### 2.10 Custom Domains versus Routes (ADR 0007)

- **The recommendation.** [P29]: "Custom Domains are recommended for use cases where your Worker is your application's origin server. Custom Domains can also be invoked within the same zone via `fetch()`, unlike Routes." "Routes are recommended for use cases where your application's origin server is external to Cloudflare. Note that Routes cannot be the target of a same-zone `fetch()` call." [P30]: "If your Worker is your application's origin, use Custom Domains."
- **Routes need a DNS record; Custom Domains make their own.** [P30]: "All domains and subdomains must have a DNS record to be proxied on Cloudflare and used to invoke a Worker." And: "If you have previously used the Cloudflare dashboard to add an `AAAA` record for `myname` to `example.com`, pointing to `100::` ..., Cloudflare recommends creating a Custom Domain pointing to your Worker instead." [P31]: "After you set up a Custom Domain for your Worker, Cloudflare will create DNS records and issue necessary certificates on your behalf."
- **A Custom Domain can't sit on an existing CNAME.** [P31]: "You cannot create a Custom Domain on a hostname with an existing CNAME DNS record or on a zone you do not own."
- **Orphaned DNS records: not documented.** No page fetched says what happens to a Custom Domain's DNS record when `wrangler delete` removes the Worker. The certificate half is documented (row 29); the DNS half is not. The test: attach a Custom Domain, run `wrangler delete`, then list the zone's DNS records.

### 2.11 Ruleset rules and `ref` (ADRs 0004, 0007)

[P32]:

- "For `cloudflare_ruleset` resources, the Cloudflare provider may delete a rule and create a new one when you modify a ruleset in your Terraform configuration. This happens because the API cannot match rules in your new Terraform configuration with existing rules in your Cloudflare configuration."
- "To keep existing rule IDs when making changes to a ruleset through Terraform, add a `ref` field to each rule."
- "The `ref` field is a user-defined external identifier that must be unique for each rule in a ruleset."
- "Once you set the `ref` field of a rule, changing the `ref` field value will make Terraform create a new rule."
- "By default, when you create a rule, its `ref` value will be equal to the rule ID."
- The page is written for Terraform. That OpenTofu's use of the same provider behaves the same is an inference.

## 3. Were the reviews right?

| Review claim | Verdict |
|---|---|
| "For new Workers, use the declarative `exports` field instead of the `migrations` array" | Right. Exact quote from [P1]. |
| The delete-refused guard "is documented only for `exports`" | Right for a class delete: [P1] documents no refusal for `deleted_classes`. Incomplete: the separate guard on deleting the whole Worker rests on the API's `force` parameter [P4], which applies whichever flow is used. |
| "Switching is one-way" | Right [P2]. |
| "Workflow steps are billed since August 2026" | Mostly right. The prices are right. The docs say "starting August 10th, 2026" [P6] and "no earlier than August 10th, 2026" [P9]; neither confirms billing has begun. |
| "500k included per month, then $0.80 per 100k" (workflow review) | Right [P6]. Workers Paid only; Free is 3,000 a day. |
| "a full reconcile is about 1M steps, roughly $4 over the included amount" | Right as arithmetic on ADR 0010's peak figure: 1,024,000 steps, $4.19 over if nothing else used the included steps. |
| ADRs 0010 and 0016 say "restore drills and reconciles cost $0" | Half right. ADR 0016 says drills "run within Workers Paid's included amounts". ADR 0010 states no cost. |
| "`createBatch` (idempotent) and `restart`; a child can't be re-created under the same ID within retention" | Right [P8]. |
| "Workflows now take a `schedules` array on the binding" | Right [P33]. |
| "Workers Logs records uncaught exceptions by default" | Right for new Workers [P14], with the caveat in 2.4 about a config that omits `observability`. |
| "'Issues' error monitoring is in open beta on all accounts (no email destination)" | Right [P16] [P17]. Issues must be switched on per Worker. |
| "`send_email` ... still free to verified addresses, but now part of 'Email Service'; the raw-message API is labelled legacy" | Right [P13] [P11]. |
| "`@cloudflare/vitest-pool-workers` renamed `@cloudflare/vitest-plugin`; `createTestHarness()` is now recommended for integration tests" | Right [P18] [P19]. `createTestHarness()` replaces the deprecated `unstable_startWorker()`, not the Vitest plugin [P37]. |
| Worker Previews share KV and D1 "only if bound to the same ID" | Right [P12]. |
| "`script_name` Durable Objects, service bindings and Workflows not being per-Preview" | Right for service bindings and Workflows. For `script_name` Durable Objects it is an inference; the docs only say what happens *without* `script_name`. |
| "Cloudflare's guidance puts write-heavy objects at about 200–500 req/s, not 1,000" | Right about the newer guidance [P22]. But the 1,000 req/s soft limit ADR 0001 cites is still documented [P21], so "not 1,000" overstates it. |
| "no ADR says to use RPC methods, which Cloudflare recommends" | Right [P22]. |
| "If the fallback is used, a plain `TEXT PRIMARY KEY` roughly doubles billed row writes" | Plausible, not documented. It follows from Cloudflare's index rule and SQLite's docs (2.8). |
| "Cloudflare adds its own CAA records and changes certificate authorities without notice" | Right [P27] [P28]. |
| "Cloudflare recommends Custom Domains when the Worker is the origin" | Right [P29] [P30]. |
| "the orphaned-DNS reason is unsourced" | Right: not documented. |
| "give each rule a `ref` or its ID changes on every edit" | Right in substance. The docs say the provider "may" recreate rules, not that it does on every edit [P32]. |

## 4. Open questions

Not documented; each needs a `doctor` check or a spike.

1. Does Durable Object SQLite accept `STRICT` and `WITHOUT ROWID`? D1's docs hint that it may, and nothing says so for Durable Objects. (2.8)
2. How many rows written does one insert cost in a plain table with a `TEXT PRIMARY KEY`, by `cursor.rowsWritten`? (2.8)
3. Is a non-forced delete of a Worker refused while another Worker binds to its Durable Objects, and does `wrangler delete` expose a `--force` flag? The docs page lists none. (row 5)
4. Under legacy `migrations`, is a `deleted_classes` migration refused while another Worker binds to the class? (row 6)
5. With `exports` in the config and no lifecycle change pending, does `wrangler versions upload` work? (2.1)
6. What does a `script_name` Durable Object binding resolve to in a Worker Preview? (2.6)
7. Does deleting a Worker leave its Custom Domain's DNS record behind? (2.10)
8. Does `wrangler deploy` with no `observability` block leave Workers Logs on? (2.4)
9. Is Workflows step billing rounded up to whole units of 100,000? And how many steps do one restore drill and one reconcile actually use, by `stepCount`? (2.2)
10. Does an Issues webhook destination need a Pro zone, as Notifications webhooks do? (2.4)

Not verified, and not asked by the ticket: ADR 0007's claims that `exports` "docs and code still disagree", that Wrangler in CI "silently takes over a hostname already attached to another Worker", and that a Preview's token "can deploy to production"; the provider review's claim that Custom Domains "don't support per-Worker roles yet".

## Sources

All fetched 2026-10-01. Cloudflare pages were fetched as `<URL>index.md`.

- [P1] Durable Object class migrations (legacy): https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/ (last updated 2026-09-28)
- [P2] Durable Object class exports: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/ (last updated 2026-09-28)
- [P3] Gradual deployments with Durable Objects: https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/
- [P4] API reference, delete Worker: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/
- [P5] Wrangler commands, Workers (`delete`): https://developers.cloudflare.com/workers/wrangler/commands/workers/
- [P6] Workflows pricing: https://developers.cloudflare.com/workflows/reference/pricing/ (last updated 2026-09-21)
- [P7] Workflows limits: https://developers.cloudflare.com/workflows/reference/limits/
- [P8] Workflows Workers API: https://developers.cloudflare.com/workflows/build/workers-api/
- [P9] Changelog, Workflows billing (2026-07-07): https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/
- [P10] Cloudflare Email Service: https://developers.cloudflare.com/email-service/
- [P11] Email Service Workers API: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/ (https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/ redirects here)
- [P12] Previews, resources and isolation: https://developers.cloudflare.com/workers/previews/resources/ (last updated 2026-09-22)
- [P13] Email Service pricing: https://developers.cloudflare.com/email-service/platform/pricing/
- [P14] Workers Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs/ (last updated 2026-09-30)
- [P15] Available Notifications: https://developers.cloudflare.com/notifications/notification-available/
- [P16] Workers Issues: https://developers.cloudflare.com/workers/observability/issues/ (last updated 2026-09-30)
- [P17] Issues, set up an automation: https://developers.cloudflare.com/workers/observability/issues/automations/
- [P18] Migrate to Vitest plugin: https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/
- [P19] Workers testing: https://developers.cloudflare.com/workers/testing/
- [P20] Previews: https://developers.cloudflare.com/workers/previews/
- [P21] Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- [P22] Rules of Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/ (last updated 2026-08-20)
- [P23] Durable Objects SQLite storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- [P24] Access Durable Objects storage: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- [P25] D1 SQL statements: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- [P26] Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- [P27] Add CAA records: https://developers.cloudflare.com/ssl/edge-certificates/caa-records/
- [P28] Universal SSL limitations: https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/
- [P29] Workers routes and domains: https://developers.cloudflare.com/workers/configuration/routing/
- [P30] Workers Routes: https://developers.cloudflare.com/workers/configuration/routing/routes/
- [P31] Workers Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ (last updated 2026-09-29)
- [P32] Rule IDs change when I modify a ruleset: https://developers.cloudflare.com/terraform/troubleshooting/rule-id-changes/
- [P33] Trigger Workflows: https://developers.cloudflare.com/workflows/build/trigger-workflows/
- [P34] Email Service, configure send bindings: https://developers.cloudflare.com/email-service/configuration/send-bindings/
- [P35] Notifications: https://developers.cloudflare.com/notifications/
- [P36] Workers Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/
- [P37] Wrangler's `unstable_startWorker()`: https://developers.cloudflare.com/workers/testing/unstable_startworker/
- [P38] Integration test harness: https://developers.cloudflare.com/workers/testing/test-harness/
- [P39] D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- [P40] Certificate authorities: https://developers.cloudflare.com/ssl/reference/certificate-authorities/
- [S1] SQLite, WITHOUT ROWID tables: https://www.sqlite.org/withoutrowid.html
- [S2] SQLite, CREATE TABLE: https://www.sqlite.org/lang_createtable.html
