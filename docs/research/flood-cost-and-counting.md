# What a Redirect flood costs and counts against

Research for [#43](https://github.com/andrewferk/url-shortener/issues/43), a child of the map in [#1](https://github.com/andrewferk/url-shortener/issues/1). This document states facts only. The choices are made in "How are request floods, Short code guessing and a deliberately tripped brake bounded?" and "Does the delete bound drop now that `cacheTtl` can be 30 s?".

**Checked 2026-10-01.** Every Cloudflare docs page below was fetched that day as raw Markdown (`<docs URL>index.md`) with `curl`, not through a summarising fetcher. Quotes are exact. Prices are list prices in USD for Workers Paid.

Each claim carries one label:

- **Confirmed**: the docs say it; the quote follows.
- **Contradicted**: the docs say otherwise; the quote follows.
- **Not documented**: the docs are silent; what a `doctor` check or spike would have to test is stated.
- **Inference**: derived from documented facts; the basis is stated.

## Summary

| Question | Answer | Label |
|---|---|---|
| Is a KV read served from the `cacheTtl` edge cache billed? | No sentence in the docs mentions cached (hot) reads. The pricing FAQ says "All operations incur charges" and lists no exemption. | Not documented |
| `cacheTtl` minimum | 30 s since 2026-01-30 (was 60 s). The default is still 60 s. | Confirmed |
| KV prices | Reads $0.50/M, writes, deletes and lists $5.00/M each, storage $0.50/GB-month. Misses are billed. | Confirmed |
| Is a request blocked by the rate limiting rule or a WAF custom rule billed as a Worker request? | No: "Only requests that hit a Worker will count against your limits and your bill." | Confirmed |
| Is a request the Worker answers with 429 billed in full? | Yes. It is an inbound request to the Worker; no status code is exempt. | Inference |
| Workers prices | $0.30/M requests, $0.02/M CPU-ms. | Confirmed |
| How the Free rate limiting rule counts IPv6 | The current docs don't say. Only the retired product's page says `/64`. | Not documented |
| Free rate limiting rule | 1 rule; counts by IP only; 10 s period; 10 s mitigation; expression can use Path and Verified Bot only; counters are per data center. | Confirmed |
| Rate Limiting binding | Per Cloudflare location; period 10 or 60 s; key is any string the Worker passes; Cloudflare recommends against IP keys. | Confirmed |
| What the HTTP DDoS rules do at 1,000 or 10,000 req/s | Thresholds are unpublished and vary per rule, location and fingerprint. Free can change only action and sensitivity, in one override. | Not documented |
| Budget alert by API or OpenTofu | None found in the API schema or the provider. | Not documented |
| Automatic $10 alert | Real: created by default for Pay-as-you-go accounts that have no budget alert. | Confirmed |
| How quickly a budget alert fires | "the day after the threshold is reached rather than in real time" | Confirmed |

Recomputed at list prices, with CPU time excluded because it has not been measured:

| Figure | Attacks review | Recomputed |
|---|---|---|
| Per 1M unknown-code requests past the edge ceiling | $0.80 | **$0.80** (+ $0.02 per millisecond of CPU per request) |
| Per IP per day at the edge ceiling (30 req/s) | about $2 | **$2.07** per IP per data center |
| 1,000 req/s sustained | about $69/day | **$69.12/day** |
| 10,000 req/s sustained | about $690/day | **$691.20/day** |

---

## 1. Workers KV

Sources:
- KV pricing: <https://developers.cloudflare.com/kv/platform/pricing/> (page dated Apr 21, 2026)
- Read key-value pairs: <https://developers.cloudflare.com/kv/api/read-key-value-pairs/>
- KV limits: <https://developers.cloudflare.com/kv/platform/limits/>
- How KV works: <https://developers.cloudflare.com/kv/concepts/how-kv-works/>
- Changelog, "Reduced minimum cache TTL for Workers KV to 30 seconds": <https://developers.cloudflare.com/changelog/post/2026-01-30-kv-reduced-minimum-cachettl/>

### Prices: confirmed

The Paid plan column of the pricing table:

| | Paid plan |
|---|---|
| Keys read | 10 million/month, + $0.50/million |
| Keys written | 1 million/month, + $5.00/million |
| Keys deleted | 1 million/month, + $5.00/million |
| List requests | 1 million/month, + $5.00/million |
| Stored data | 1 GB, + $0.50/ GB-month |

> Workers KV pricing for read, write and delete operations is on a per-key basis. Bulk read operations are billed by the amount of keys read in a bulk read operation.

ADR 0006's $0.50 per 1M reads and "$5-per-1M KV write" both match.

### A read of a key that doesn't exist is billed: confirmed

> **What operations incur operations charges?** All operations incur charges, including fetches for non-existent keys that return a `null` (Workers API) or `HTTP 404` (REST API). These operations still traverse KV's infrastructure.

So every well-formed unknown Short code that reaches the Worker costs one KV read.

### Is a read served from the `cacheTtl` edge cache billed? Not documented

- No page fetched (pricing, read API, limits, how KV works, and the whole KV docs bundle at <https://developers.cloudflare.com/kv/llms-full.txt>) contains a sentence about how a cached read is billed.
- The nearest statement is the FAQ above: "All operations incur charges". It names missing keys as included and names no exemption for hot reads.
- The docs do define the terms: "A hot read means that the data is cached on Cloudflare's edge network using the CDN, whether it is in a local cache or a regional cache. A cold read means that the data is not cached, so the data must be fetched from the central stores."
- **Inference** (from "All operations incur charges" and the absence of any exemption): cached reads are billed. ADR 0006 states this as a fact: "Workers KV bills every read, per key, whether or not its edge cache served it." The docs don't support stating it that firmly.
- **What a spike would test:** from one Worker in one location, read one key 1,000 times inside a single `cacheTtl` window. Then compare the namespace's read count in KV analytics (GraphQL `kvOperationsAdaptiveGroups`) and the "Keys read" row of the Billable Usage dashboard the next day. 1,000 means cached reads are billed; about 1 means they aren't.

**Was the provider review right?** Yes. It said "the pricing docs neither confirm nor deny it". That holds, with the note that the FAQ's "All operations incur charges" leans towards billed.

### `cacheTtl` minimum is 30 s: confirmed

> The `cacheTtl` parameter must be an integer greater than or equal to `30`. `60` is the default. The maximum value for `cacheTtl` is `Number.MAX_SAFE_INTEGER`.

The limits page lists "Minimum `cacheTtl`: 30 seconds" for both Free and Paid. The changelog entry dated 2026-01-30:

> The minimum `cacheTtl` parameter for Workers KV has been reduced from 60 seconds to 30 seconds. This change applies to both `get()` and `getWithMetadata()` methods. [...] The default cache TTL remains unchanged at 60 seconds. Upgrade to the latest version of Wrangler to be able to use 30 seconds `cacheTtl`.

**Was the provider review right?** Yes: "Minimum is 30 s since January 2026". ADR 0006's "60 s (KV's default)" is still the correct default; 60 s is no longer the floor.

Facts that bear on the delete bound:

- Visibility elsewhere: "Changes may take up to 60 seconds or more to be visible in other global network locations as their cached versions of the data time out." The "60 seconds" there is the default `cacheTtl`; the read page says "up to 60 seconds (or the duration of the `cacheTtl`)".
- Misses are cached too: "Negative lookups indicating that the key does not exist are also cached, so the same delay exists noticing a value is created as when a value is changed."
- "or more" is not quantified anywhere. **Not documented:** an upper bound on staleness at a given `cacheTtl`. A spike would write a key in one location and poll it from another with `cacheTtl: 30`, recording the worst delay over many trials.

---

## 2. Workers requests

Sources:
- Workers pricing: <https://developers.cloudflare.com/workers/platform/pricing/> (page dated Aug 28, 2026)
- Workers metrics and analytics: <https://developers.cloudflare.com/workers/observability/metrics-and-analytics/>
- Ruleset Engine phases list: <https://developers.cloudflare.com/ruleset-engine/reference/phases-list/>
- Analytics Engine pricing: <https://developers.cloudflare.com/analytics/analytics-engine/pricing/>

### Prices: confirmed

The Standard row of the pricing table:

> 10 million included per month +$0.30 per additional million [requests] [...] 30 million CPU milliseconds included per month +$0.02 per additional million CPU milliseconds

> Inbound requests to your Worker. Cloudflare does not bill for subrequests you make from your Worker.

Duration is "No charge or limit for duration". The Workers Paid plan has "a minimum charge of $5 USD per month for an account".

Durable Objects, on the same page, for the shard fallback:

> Requests: 1 million / month, + $0.15/million. Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations

> Duration: 400,000 GB-s / month, + $12.50/million GB-s

SQLite storage rows read are "First 25 billion / month included + $0.001 / million rows".

### A request blocked at the edge is not billed as a Worker request: confirmed

The pricing page's fine print:

> Only requests that hit a Worker will count against your limits and your bill.

The metrics page, describing the Worker's request count:

> **Total**: All incoming requests registered by a Worker. Requests blocked by WAF or other security features will not count.

The second quote describes a metric, not the bill. Together they say a request blocked by a security feature does not reach the Worker, and a request that doesn't reach the Worker isn't billed. ADR 0004's "blocked requests are never billed" holds.

The phases list puts `http_request_firewall_custom` (WAF custom rules) before `http_ratelimit` (rate limiting rules). It does not list Workers at all, so the order of Workers relative to those phases rests on the two quotes above.

**What a `doctor` check would test:** send 400 requests in 10 s from one IP, then compare the Worker's request count with the Security Events count for the rule. Blocked requests should appear only in the latter.

### A request the Worker answers with 429 is billed in full: inference

- The basis: requests are billed as "Inbound requests to your Worker", and no sentence on the pricing page exempts any response status.
- So the shard-fallback limit's 429 and the cost brake's 503 each cost a Worker request, the CPU time used, and every KV read made before answering.
- In ADR 0004's order, the rate limiter is checked "on every KV miss", so the KV read has been paid before the 429. **The attacks review was right** that "rate-limited 429s still pay the KV read".

### Costs the pricing pages list beside requests and KV

- **Cache API:** it does not appear on the Workers pricing page. **Not documented** as billed or as free; ADR 0006's "the Cache API isn't billed" matches the absence of a price.
- **Rate Limiting binding:** no price on its own page or on the Workers pricing page. **Not documented** as billed or as free.
- **Analytics Engine** (confirmed): "+$0.25 per additional million" data points written beyond 10 million a month, and "Currently, you will not be billed for your use of Workers Analytics Engine." If each Redirect event is one `writeDataPoint()`, a flood would add $0.25 per 1M once Cloudflare starts billing. This research did not read ADR 0003, so whether events are written one per request is not checked here.
- **Workers Logs** (confirmed): "20 million included per month +$0.60 per additional million" log events on Workers Paid. This applies only if Workers Logs is on for the Redirect Worker.

---

## 3. The Free plan's rate limiting rule

Sources:
- Rate limiting rules: <https://developers.cloudflare.com/waf/rate-limiting-rules/>
- Request rate calculation: <https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/>
- Rate limiting parameters: <https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/>
- Rate Limiting (previous version): <https://developers.cloudflare.com/waf/reference/legacy/old-rate-limiting/>

### What Free gets: confirmed

The Free column of the availability table:

| Feature | Free |
|---|---|
| Available fields in rule expression | Path, Verified Bot |
| Counting characteristics | IP |
| Custom counting expression | No |
| Counting periods | 10 s |
| Mitigation timeout periods | 10 s |
| Number of rules | 1 |

- Host is not an available expression field until Pro, so the Free rule can't be scoped by hostname. This matches ADR 0004.
- "IP with NAT support" starts at Business. Every other characteristic (ASN, country, headers, JA3/JA4 and so on) needs Enterprise with Advanced Rate Limiting.

### Counters are per data center: confirmed

> Cloudflare does not support global rate limiting counters across the entire network. Each data center maintains its own counters. The exception is when Cloudflare has multiple data centers associated with a given geographical location. In that case, those data centers share counters.

> Every rate limiting rule includes the Cloudflare data center ID (`cf.colo.id`) as a mandatory characteristic. [...] When creating rate limiting rules via API, you must include the `cf.colo.id` characteristic explicitly.

The last sentence applies to the OpenTofu resource too, since it goes through the same API.

### The limit is not exact: confirmed

> Rate limiting rules are not designed to allow a precise number of requests to reach your origin server. There may be a delay of up to a few seconds between detecting a request and updating rate counters. Due to this delay, excess requests could still reach the origin before Cloudflare enforces a mitigation action such as blocking or challenging.

So more than 300 requests per 10 s per IP can reach the Worker, and be billed, before the block starts. The docs give no bound on the excess.

### How IPv6 clients are counted: not documented

- The current pages name the characteristic only as "IP" (`ip.src`). None of them mentions IPv6 or a prefix length.
- Only the page for the retired product says how: "Once an individual IPv4 address or IPv6 `/64` IP range exceeds a rule threshold, further requests to the origin server are blocked with an `HTTP 429` response status code." That page is titled "Rate Limiting (previous version)", and the current overview calls it "previous version, no longer available". It is not evidence for the current rules.
- **What a `doctor` check would test:** from two addresses in the same /64, send 200 requests each inside 10 s to the same data center. If the rule counts per /64, the pair is blocked at about 300 combined; if it counts per address, neither is blocked.

**Was the attacks review right?** Yes. It said the counting "is not stated in any ADR and was not verified". It is also not stated in Cloudflare's current docs.

### Guidance against IP keys

- **WAF rate limiting rules:** the docs offer "IP with NAT support" for "situations such as requests under NAT sharing the same IP address". It is not available on Free. No sentence on the pages fetched advises against the IP characteristic as such.
- **Rate Limiting binding:** the guidance is explicit; see the next section.

---

## 4. The Workers Rate Limiting binding

Source: <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/> (page dated Apr 23, 2026). The binding has been generally available since 2025-09-19 ([changelog](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/)).

### Per-location semantics: confirmed

> Rate limits that you define and enforce in your Worker are local to the Cloudflare location that your Worker runs in.

> For each unique key you pass to your rate limiting binding, there is a unique limit per Cloudflare location.

### Allowed periods: confirmed

From the configuration example:

> Limit: the number of tokens allowed within a given period in a single Cloudflare location. Period: the duration of the period, in seconds. Must be either 10 or 60

ADR 0004's 30 per 60 s, 60 per minute and 10 per 60 s all use an allowed period.

### How the key is chosen: confirmed

> The key you provide can be any `string` value.

- The binding does nothing with IP addresses on its own. Keying on the full IPv4 address or the IPv6 /64 is the Worker's own code building a string.
- The page does not mention IPv6.

### Cloudflare recommends against IP keys: confirmed

> It is not recommended to use IP addresses or locations (regions or countries), since these can be shared by many users in many valid cases. You may find yourself unintentionally rate limiting a wider group of users than you intended by rate limiting on these keys.

The code sample labels an IP key "Not recommended: many users may share a single IP, especially on mobile networks or when using privacy-enabling proxies". ADR 0004 keys the shard-fallback limit and the failed-authentication limit on the IP; both go against this guidance.

### Accuracy: confirmed

> The above also means that the Rate Limiting API is permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system.

> The Rate Limiting API is backed by the same infrastructure that serves rate limiting rules.

---

## 5. DDoS protection on Free

Sources:
- About: <https://developers.cloudflare.com/ddos-protection/about/>
- HTTP DDoS Attack Protection managed ruleset: <https://developers.cloudflare.com/ddos-protection/managed-rulesets/http/> (page dated Apr 15, 2026)
- Override parameters: <https://developers.cloudflare.com/ddos-protection/managed-rulesets/http/override-parameters/>
- How DDoS protection works: <https://developers.cloudflare.com/ddos-protection/about/how-ddos-protection-works/>
- Adaptive DDoS Protection: <https://developers.cloudflare.com/ddos-protection/managed-rulesets/adaptive-protection/>
- FAQ: <https://developers.cloudflare.com/ddos-protection/frequently-asked-questions/>

### Free has the HTTP DDoS managed ruleset: confirmed

> Cloudflare provides unmetered and unlimited distributed denial-of-service (DDoS) protection at layers 3, 4, and 7 to all customers on all plans and services.

> The HTTP DDoS Attack Protection managed ruleset is always enabled — you can only customize its behavior.

### What it does to a sustained flood of well-formed requests at 1,000 or 10,000 req/s: not documented

Cloudflare declines to publish thresholds:

> Thresholds vary for each rule and there are different thresholds globally and per colocation. Within a rule, the traffic is fingerprinted and the thresholds are per fingerprint, and it is difficult to know ahead of time which rules, colocations, or fingerprints your traffic generates, so the threshold numbers are not necessarily valuable.

What the docs do say:

- **What the rules look for:** "known attack patterns and tools, suspicious patterns, protocol violations, requests causing large amounts of origin errors, excessive traffic hitting the origin/cache, and additional attack vectors at the application layer".
- **How fast:** "Up to three seconds on average for the detection and mitigation of HTTP DDoS attacks at the edge using the HTTP DDoS Protection Managed rules."
- **The one published number** is for the origin-error rule, available on any plan: "For zones on any plan, Cloudflare will apply mitigations when the HTTP error rate is above the *High* (default) sensitivity level of 1,000 errors-per-second rate threshold." It counts "All HTTP errors in the `52x` range (Internal Server Error) and all errors in the `53x` range excluding `530`".
  - A flood of unknown Short codes is answered 404, 429 or (with the brake on) 503. 404 and 429 are not in those ranges. Whether a 503 generated by a Worker counts as an origin error for this rule is **not documented**.
- **Adaptive DDoS Protection**, which learns a zone's traffic profile, "is available to Enterprise customers". It is not on Free.

No doc says that 1,000 or 10,000 well-formed requests per second to a zone would or would not be mitigated. **A spike can't settle this safely:** it would mean flooding the deployment's own zone, and the result would hold only for that traffic's fingerprint.

**Was the attacks review right?** Its "Cloudflare's DDoS rules would probably squash the larger floods" is not supported or refuted by the docs. It was labelled "Unknown" in the review, which is accurate.

### What is configurable on Free: confirmed

- Two parameters: "The performed **action** when an attack is detected" and "The **sensitivity level** of attack detection mechanisms."
- Sensitivity levels: High (the default), Medium, Low, Essentially Off.
- Actions available in an override: Block, Managed Challenge, Interactive Challenge. Log is "Only available on Enterprise plans with the Advanced DDoS Protection subscription."
- One override, with no expression: "Other customers can only create one override (or rule) and they cannot customize the rule expression. In this case, the single override, containing one or more configurations, will always apply to all incoming traffic."
- "Certain actions or sensitivity levels may not be available to all Cloudflare plans."

### Is DDoS traffic billed? Confirmed in general; not documented for Workers

> **Does Cloudflare charge for DDoS attack traffic?** No. Since 2017, Cloudflare offers free, unmetered, and unlimited DDoS protection. There is no limit to the number of DDoS attacks, their duration, or their size. Cloudflare's billing systems automatically exclude DDoS attack traffic from your usage.

**Not documented:** whether that exclusion reaches Worker requests and KV reads for requests that ran the Worker before, or without, a mitigation. The Workers and KV pricing pages don't mention DDoS traffic. The Workers pricing page's own advice treats the risk as real: "To prevent accidental runaway bills or denial-of-wallet attacks, configure the maximum amount of CPU time that can be used per invocation".

---

## 6. Spend alerts

Sources:
- Budget alerts: <https://developers.cloudflare.com/billing/manage/budget-alerts/> (page dated May 29, 2026)
- Changelog, "Budget alerts now on by default for Pay-as-you-go accounts": <https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/> (feed date 2026-07-20)
- Changelog, "Introducing Billable Usage dashboard and Budget alerts": <https://developers.cloudflare.com/changelog/post/2026-04-13-billable-usage-dashboard-and-budget-alerts/>
- Usage-based billing: <https://developers.cloudflare.com/billing/understand/usage-based-billing/>
- Available notifications: <https://developers.cloudflare.com/notifications/notification-available/>
- Cloudflare API schema: <https://github.com/cloudflare/api-schemas> (`openapi.json`, last commit 2026-10-01)
- OpenTofu provider `cloudflare/cloudflare` v5.26.0, `cloudflare_notification_policy`: <https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/notification_policy.md>

### What a budget alert is: confirmed

> Budget alerts notify you by email when your account-wide usage-based spend crosses a dollar threshold you define.

> Budget alerts are informational only. They do not pause or cap usage. Your monthly invoice remains the authoritative source for billing.

> When spend crosses the threshold, Cloudflare sends a single email notification to all configured recipients. The alert resets at the start of each new billing period.

- It counts usage only: "Recurring subscription fees, such as the Workers Paid plan fee or other monthly plan charges, are not included in the threshold calculation." So a $5 threshold means $5 of overage, on top of the $5 plan fee.
- It fires once per billing period. After it has fired, a later flood in the same period sends nothing.

### How quickly it fires: confirmed

> Usage is processed once per day for the prior day's activity, so budget alerts fire the day after the threshold is reached rather than in real time.

**Were the reviews right?** Yes. ADR 0004 ("fire the next day"), the security review ("the spend alert arrives a day later") and the attacks review ("Detection is next-day") all match.

One wording conflict between Cloudflare's own pages: the April changelog says an alert fires "when your projected monthly spend reaches your configured threshold", while the docs page and the July changelog say "cumulative usage-based spend". The docs page is the newer of the two descriptions.

### The automatic $10 alert: confirmed

> We are turning on budget alerts by default for eligible Pay-as-you-go accounts. If your account does not already have a budget alert, Cloudflare will create one for you with a $10 account-level threshold. Your default alert will enable at the turn of your next billing cycle, so it will not fire based on usage you have already incurred.

- "We are rolling this out in cohorts over the coming weeks, so eligible accounts may see their default alert appear at different times."
- "If you already configured your own budget alert, nothing changes."
- "You can change the threshold, add additional alerts, or remove the default alert entirely from **Manage Account** > **Billing** > **Billable Usage**, or from your Notifications settings."

**Was the provider review right?** Yes: "Cloudflare now auto-creates a $10 one".

### An API or OpenTofu resource for budget alerts: not documented

- The budget alerts page describes the dashboard only. It names no API endpoint.
- The public API schema contains no budget alert: the only occurrence of "budget" in `openapi.json` is in an unrelated SPF description.
- The provider's `cloudflare_notification_policy` lists its allowed `alert_type` values. None is a budget alert. The nearest is `billing_usage_alert`.
- The changelog hints that budget alerts live in the Notifications system: "Alternatively, configure alerts via **Notifications** > **Add** > **Budget Alert**." That suggests an alert type exists that the schema and provider don't list. This is an **inference**, not a documented API.
- **What a `doctor` check would test:** create a budget alert in the dashboard, then call `GET /accounts/{account_id}/alerting/v3/policies` and `GET /accounts/{account_id}/alerting/v3/available_alerts` and see whether it appears and under what `alert_type`. If it does, try creating one with `cloudflare_notification_policy`; the provider validates `alert_type` against its list, so an unlisted type may be rejected at plan time.

**Was the provider review right?** Yes: "No API or Terraform path for budget alerts is documented". ADR 0004's and ADR 0007's "OpenTofu owns the spend alert" has no documented resource behind it.

### The per-product usage notification is a different thing: confirmed

- `billing_usage_alert` is the "Usage Based Billing" notification. It watches one product's metric, not dollars: "Usage notifications monitor a single product metric (bytes, requests, minutes). To monitor your total dollar spend across all products, use budget alerts instead."
- The provider has it, with `product` and `limit` filters ("Used for configuring billing_usage_alert").
- Its availability reads "Professional plans or higher", and "If you are on a Professional plan or higher, you can monitor the usage of individual Cloudflare add-ons".
- **Not documented:** whether it is usable on an account whose only zone is Free, whether Workers requests or KV reads are among its products, and how soon after a threshold it fires. A `doctor` check would list the alert in `available_alerts` and try to create a policy for Workers requests.

---

## 7. The attacks review's figures, recomputed

### What one request costs

A well-formed, unknown Short code that gets past the edge ceiling, in ADR 0004's and ADR 0006's order (per-colo Cache API, then KV, then the limiter, then the shard):

| Step | List price per 1M | Label |
|---|---|---|
| Worker request | $0.30 | Confirmed |
| Worker CPU, per millisecond of CPU per request | $0.02 | Confirmed price; CPU per Redirect is unmeasured |
| Cache API lookup | no price listed | Not documented |
| KV read (a miss) | $0.50 | Confirmed |
| Rate Limiting binding call | no price listed | Not documented |
| Shard call, only while under the limiter and the brake | $0.15 | Confirmed |
| Analytics Engine data point, if one per request | $0.25 listed, not billed today | Confirmed |

**Per 1M requests that stop at the limiter or the brake:** $0.30 + $0.50 = **$0.80**, plus $0.02 for each millisecond of CPU per request.

**Per 1M requests that reach the shard:** $0.80 + $0.15 = **$0.95**, plus CPU, plus Durable Object duration and rows read. Rows read are $0.001 per 1M rows. Duration is billed on 128 MB of wall-clock time and is unmeasured.

**Was the attacks review right?** Yes, $0.80 per 1M at today's list prices. It leaves out CPU time, which the review did not price and which no one has measured. ADR 0004's "about $0.80 per extra 1M" is the same sum.

Two conditions on the $0.80:

- It assumes one KV read per request. ADR 0004 says the Worker reads the brake's flag "only on the KV-miss path, cached for 60 s". If that cache is KV's `cacheTtl` and cached reads are billed (section 1), every miss costs a second KV read and the figure becomes $1.30 per 1M. If the flag is cached in the Worker's memory, it stays $0.80. The ADR doesn't say which.
- The first 10M Worker requests, 10M KV reads and 30M CPU-ms of each billing month are included in the plan. A flood uses up what normal traffic has left of them before the rates above apply.

### Per IP per day at the edge ceiling

- 300 requests per 10 s = 30 req/s.
- 30 × 86,400 s = 2,592,000 requests a day.
- 2.592M × $0.80 per 1M = **$2.07 a day**.
- Each millisecond of CPU per request adds 2.592M ms × $0.02 per 1M = $0.05 a day.

Of those requests, the shard-fallback limiter passes 30 a minute: 30 × 1,440 = 43,200 shard calls a day, which is 0.0432M × $0.15 = $0.006.

**Was the attacks review right?** Yes: "about 2.6M a day, which is about $2 a day per IP". Three qualifications, all from section 3:

- The count is per IP per data center, so an IP that reaches two data centers has two allowances.
- The rule is not exact; requests over 300 can pass before the block starts.
- Whether "per IP" means per address or per /64 for IPv6 is not documented. If it is per address, one /64 holds 2^64 addresses and the per-IP figure doesn't bound an IPv6 attacker at all.

### Sustained floods

| Rate | Requests a day | Worker requests ($0.30/M) | KV reads ($0.50/M) | Total a day | Per 30 days | Extra per ms of CPU per request |
|---|---|---|---|---|---|---|
| 1,000 req/s | 86.4M | $25.92 | $43.20 | **$69.12** | $2,073.60 | $1.73 a day |
| 10,000 req/s | 864M | $259.20 | $432.00 | **$691.20** | $20,736.00 | $17.28 a day |

- 1,000 × 86,400 = 86,400,000. 86.4 × $0.80 = $69.12.
- 10,000 × 86,400 = 864,000,000. 864 × $0.80 = $691.20.
- At 30 req/s per IP, 1,000 req/s takes 34 IPs and 10,000 req/s takes 334 (1,000 ÷ 30 = 33.3; 10,000 ÷ 30 = 333.3), all under the edge ceiling in one data center.

**Was the attacks review right?** Yes: "about $69/day" and "about $690/day".

### How much accrues before the alert

- The budget alert fires "the day after the threshold is reached" (section 6).
- At 10,000 req/s that is between one and two days of spend before the email: $691.20 to $1,382.40. **The attacks review's "$700–1,400 before the Operator reacts" matches.**
- At 1,000 req/s, usage past the included amounts reaches a $5 threshold after 6.25M requests ($5 ÷ $0.80 per 1M), which is 1 h 44 min, and the $10 default after 12.5M, which is 3 h 28 min. The email still comes the next day.

### The cost brake

- ADR 0004's cap: 3M shard calls a day × 30 days = 90M a month. Less the 1M included, 89M × $0.15 = **$13.35 a month**. The ADR's "about $13" holds.
- IPs needed to trip it: 3,000,000 ÷ 43,200 shard calls per IP per day = 69.4. **The attacks review's "about 70 IPs" is right,** per location.
- One IPv6 /48: 65,536 /64 prefixes × 30 a minute = 1,966,080 shard calls a minute, so 3M takes 1.53 minutes. **"Under two minutes" is right.** It needs 32,768 req/s.
- What tripping it costs the Operator: the review's "about $0.45/day" is 3M × $0.15, the Durable Object part only. Each of those 3M requests is also a Worker request and a KV read: 3M × $0.95 = **$2.85**, plus CPU. **The review's figure is low by $2.40** because it left those out.

---

## What the reviews got right and wrong

| Claim | Source | Verdict |
|---|---|---|
| A flood costs $0.80 per 1M requests | Attacks review | Right at list prices; excludes CPU ($0.02 per 1M per ms) |
| About $2 a day per IP at the edge ceiling | Attacks review | Right: $2.07, per data center |
| About $69 and $690 a day at 1,000 and 10,000 req/s | Attacks review | Right: $69.12 and $691.20 |
| How the edge rule counts IPv6 is unverified | Attacks review | Right, and Cloudflare's current docs don't say either |
| Detection is next-day; $700–1,400 at 10,000 req/s | Attacks review | Right |
| Rate-limited 429s still pay the KV read | Attacks review | Right (inference from the pricing page and ADR 0004's order) |
| DDoS rules would probably squash larger floods | Attacks review | Neither supported nor refuted; thresholds are unpublished |
| Tripping the brake costs about $0.45 a day | Attacks review | **Low.** That is the Durable Object part; with requests and KV reads it is $2.85 |
| About 70 IPs, or one /48 in under two minutes, trip the brake | Attacks review | Right |
| `cacheTtl` minimum is 30 s since January 2026 | Provider review | Right (2026-01-30) |
| No API or Terraform path for budget alerts is documented | Provider review | Right |
| Cloudflare now auto-creates a $10 alert | Provider review | Right, for accounts with no budget alert, from the next billing cycle |
| The pricing docs neither confirm nor deny that cached KV reads are billed | Provider review | Right |
| The spend alert arrives a day later | Security review | Right |

## Open questions

Things the docs don't settle, each with the test that would:

1. **Are cached KV reads billed?** Spike: 1,000 reads of one key in one `cacheTtl` window, then compare KV analytics and Billable Usage.
2. **Does the Free rate limiting rule count IPv6 per address or per /64?** `doctor` check: two addresses in one /64, 200 requests each in 10 s.
3. **How many requests over 300 per 10 s get through before the block?** `doctor` check: send 600 in 10 s from one IP and count Worker invocations.
4. **Can a budget alert be created or read through the API?** `doctor` check: create one in the dashboard and list alerting policies and available alert types.
5. **Is the per-product usage notification available on this account, and for Workers or KV?** `doctor` check: list available alerts and try to create a `billing_usage_alert` policy.
6. **Does a Worker-generated 503 count towards the DDoS origin-error rule's 1,000 errors per second?** Not safely testable; ask Cloudflare.
7. **Does the DDoS billing exclusion cover Worker requests and KV reads?** Not testable in advance; ask Cloudflare.
8. **How much CPU does a Redirect use?** Measure once the Worker exists; it sets the CPU part of every figure above.
9. **What is the worst-case KV staleness at `cacheTtl: 30`?** Spike: write in one location, poll from another.
