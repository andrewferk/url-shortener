---
status: accepted
---

# Take Abuse reports at `abuse@`, alert at the daily cap, and take down and suspend past a daily ceiling

Abuse that gets the Short domain blocklisted or the Cloudflare account suspended is the cheapest way to destroy a deployment. Until now there was a takedown runbook and nothing else: no address to report to, no page saying what happens to a report, and no signal when a Creator hit [ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)'s daily cap. That cap is soft. The burst limit counts per location, so a stolen key used from about 300 locations creates about 18,000 Links a minute, and the cap flag takes two to three minutes to land: 36,000 to 54,000 Links, all redirecting until the Operator notices. The only response was removing the Creator, who in that case is the victim.

So a deployment takes Abuse reports at `abuse@` on its Short domain and publishes an abuse policy on the Status page's hostname. The Status Worker emails the Operator when a Creator reaches the cap. Past a second, higher number, the ceiling, the Creator's object takes down every further Link of that day as it arrives and suspends the Creator. The Operator can suspend and resume a Creator, and can find a Creator's Links by creation time to take down only what a stolen key made. Creation stays off the Creator's object, as ADR 0004 decided.

Decided in [How does a deployment take in abuse reports and notice an abusive Creator?](https://github.com/andrewferk/url-shortener/issues/54), from the research in [How do Cloudflare, registrars and blocklists act on abuse reports against a shortener domain?](https://github.com/andrewferk/url-shortener/issues/47).

## Decision

### Intake

- **`abuse@<Short domain>` is the abuse address.** `infra/zone` adds one Email Routing rule that forwards it to the Operator's verified address, the one [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)'s alerts use.
- **The abuse policy is a static page at `/abuse` on the Status Worker,** in prod. Its text is a template in this repo. It says what counts as abuse, how to report it (the abuse address, with the Short URL), what happens to a reported Link, and the response target.
- **Apex 404 and 410 answers point to it.** Their plain-text bodies name the abuse address and the policy's URL. The apex gains no route and still serves only Redirects ([ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)); `/` still answers 404 ([ADR 0013](./0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md)).
- **No `security.txt`.** RFC 9116 is for vulnerability reports and advises against using it for incidents. Vulnerabilities in the software go to a `SECURITY.md` in this repo, with GitHub private vulnerability reporting. The abuse page says where to send anything specific to the deployment.
- **The launch runbook gains a manual step:** set the Cloudflare account's abuse contact and turn on abuse-report notifications. Cloudflare is the only party that sets a deadline, and it forwards reports there, not to `abuse@`.

### The response target

- **Abuse reports are acted on within 24 hours.** It is a published target, not a promise, like an Objective, and it matches Cloudflare's deadline.

  | Variable | Default |
  |---|---|
  | `abuse_response_hours` | 24 |

- **Nothing measures it,** and no alert tracks it. The abuse page shows it.
- **A confirmed abusive Link gets a Takedown** and answers 410, with no interstitial, as Spamhaus advises. Its Target URL is never changed ([ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md)).

### The cap alert

- **The Status Worker sends a "Creator at daily cap" email,** from its 5-minute rollup, in prod. It lists the `cap:` keys in `FLAGS` and sends once per Creator per UTC day, through ADR 0011's email path and D1 alert state.
- **The email names** the Creator ID and the runbook's levers. It carries no links and has no resolve email.
- **The Status Worker gains a `FLAGS` binding.** KV has no read-only binding, so it could write flags. It never does.
- **It is an alert only.** The cap itself still answers 429 until midnight UTC.

### The daily ceiling

- **The ceiling is a second per-Creator number, above the cap.**

  | Variable | Default |
  |---|---|
  | `creator_daily_link_ceiling` | 600 |

  It must be greater than `creator_daily_link_cap`. An honest Creator can't reach it: from one location the cap's lag lets through about 60 to 180 extra Links.
- **The Creator's object enforces it on arrival.** It already counts each UTC day's Links as they arrive through the outbox ([ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md)). When an arrival takes a day's count past the ceiling, the object:
  1. remembers that day in its `meta` as over the ceiling;
  2. takes down that Link, and every later arrival whose `created_at` falls on that day, by calling the shard's delete, as [ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md) does for a removed Creator's late Links;
  3. suspends the Creator (below).
- **Creation is unchanged.** A create past the ceiling still answers 201, and its Link redirects for the seconds it takes to arrive. The object stays off the create path.
- **These are Takedowns, made by the service on the Operator's behalf.** The Link records `deleted_by: operator`, with the fixed reason "over daily ceiling". There is no `system` value.
- **The object writes the audit record.** Deletion erases the Target URL, so the object writes one record per Creator per UTC day under `ops/`, in parts, listing every Link it took down with its Target URL.
- **What it bounds:** live abusive Links, to about the ceiling. It does not bound created Links. Their Short codes, and any Custom aliases among them, are taken for good.

### Suspended Creators

- **A Suspended Creator can't use the Link API.** Every call answers [ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)'s uniform 401, as for a removed Creator. Its Links keep redirecting, and it keeps its keys.
- **The suspension lives in the Creator object's `meta`,** with who made it (`operator` or `ceiling`), when, and the reason. The object mirrors it to `FLAGS` as `suspended:<creatorId>`, undated. The Link API reads that key after it has verified the credential.
- **`creators suspend <id> --reason` and `creators resume <id>`** are Workflows in `links-data`, audited under `ops/` like every Operator operation. They call the Creator object, so the Operator and the ceiling suspend through one code path. `AUTH` is not touched, and `links-data` still never binds it.
- **A suspension takes effect within about a minute,** as KV spreads the key.
- **A resume doesn't undo the ceiling's Takedowns,** and Links still arriving from an over-ceiling day are still taken down.
- **The Status Worker sends a "Creator over ceiling: suspended" email** when a `suspended:` key made by the ceiling appears. A suspension the Operator made sends nothing.
- **A reconcile rewrites `suspended:` keys** from the Creator objects, so a lost `FLAGS` namespace doesn't lift a suspension.

### A stolen key

- **`links find` gains `--creator <id>` and `--created-since <time>`.** Its output pipes into a takedown, as `--target-host` does. Links carry a Creator ID and `created_at` but no key ID, so the window is by time.
- **The runbook is:** revoke the key; find and take down the Creator's Links since the theft; issue a new key. The Creator is not suspended or removed, and keeps its other Links.
- **Suspension is for a Creator under suspicion,** and removal with `--delete-links` for one found abusive.

### Scanning

- **No URL-reputation check in `v0.1.0`.** Every Creator is admitted by the Operator.
- **The PRD records the condition:** a create-time check of the Target URL's domain against a blocklist such as the Spamhaus DBL is required before any open sign-up. It fits behind the Link API's Target URL validation.

## Cost

$0 extra. One Email Routing rule, two KV list calls in a rollup that already runs (about 17,000 a month against 1M included), and one more KV read on each Link API call.

## Considered options

- **Accepting the overshoot.** The alert reaches the Operator within about 10 minutes, but tens of thousands of abusive Links redirect until someone reads it. That window is when blocklists list the domain.
- **A synchronous count in the Creator's object before each claim.** It is exact and would also save the Short codes. ADR 0004 rejected it: every create waits on one object, and its failure means failing every create or letting every one through.
- **A `deleted_by: system` value.** It is a new permanent value in the Link API and the shard row, and the Creator learns nothing from it.
- **Taking down past the ceiling without suspending.** The count resets at midnight UTC, so a stolen key gets another cap's worth of Links every day until the Operator acts.
- **A suspended Creator that can still read, list and delete.** It needs a second kind of auth failure. A Creator whose key was stolen is not suspended at all.
- **Suspension as a field of the `AUTH` record.** `links-data` doesn't bind `AUTH` (ADR 0008), so the ceiling couldn't write it.
- **A reserved `/abuse` path on the apex.** It would be the apex's first route that isn't a Redirect.
- **`security.txt` as the abuse contact.** It is the wrong convention, and it needs an `Expires` date that someone must keep renewing.
- **Sending the cap email from the Creator's object.** It would put an email binding in the Worker that holds the Link data.
- **Create-time URL scanning now.** It adds an outside dependency to creation, to protect against Creators the Operator chose.

## Consequences

- **Amends ADR 0002:** apex 404 and 410 bodies name the abuse address and policy.
- **Amends ADR 0004:** the daily ceiling beside the cap; the cap alert.
- **Amends ADR 0005:** Suspended Creators and the `suspended:` check; `creators suspend` and `creators resume`.
- **Amends ADR 0008:** `FLAGS` holds an undated `suspended:<creatorId>` key, written by `links-data` and rebuilt by a reconcile; the Status Worker binds `FLAGS`.
- **Amends ADR 0010:** the two new Workflows; `links find --creator --created-since`; Takedowns made by the Creator object, with their audit record.
- **Amends ADR 0011:** the "Creator at daily cap" and "Creator over ceiling: suspended" emails.
- **Amends ADR 0013:** the `abuse@` routing rule; the abuse page on the Status page's hostname.
- **A create can answer 201 for a Link that is taken down seconds later.** Only a Creator creating from many locations at once can see it.
- **A Custom alias squatted in the overshoot is lost,** as [ADR 0018](./0018-hash-the-case-folded-short-code-keep-aliases-case-sensitive-reserve-case-insensitive-mode.md) accepts for squatting in general.
- **The first Links of an attack, up to the ceiling, stay live** until the Operator acts.
- **The ceiling can suspend a Creator while the Operator sleeps.** An integration that depends on that Creator stops until `creators resume`.
- **Every Link API call reads one more KV key.**
- **Abuse mail and alert mail land in one inbox.** The Operator's response depends on reading it within the target.
