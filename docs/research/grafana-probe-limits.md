# What do Grafana's Probe limits, locations and alert rules allow on the free tier?

Research for [issue 44](https://github.com/andrewferk/url-shortener/issues/44). Facts only; the choice is made in "How many Probe locations, and which alert rule, does the uptime Objective need?".

All sources were fetched on **2026-10-01**. Grafana's docs pages were fetched as raw Markdown with `curl` (append `index.md` to a docs URL). Source repositories were read at these commits:

- `grafana/synthetic-monitoring-app` `main` at `41b9d19752f3ed957659cb8a71679649b466725d`
- `grafana/terraform-provider-grafana` `main` at `b2b345f9adbb3dafd82868244b23604b46a8e5d6` (latest release is v4.47.0, published 2026-09-30)
- `grafana/synthetic-monitoring-agent` `main` and `prometheus/prometheus` `main`, single files fetched from `raw.githubusercontent.com`

Each claim is labelled **confirmed** (docs quote), **contradicted** (docs quote), **not documented**, or **inference** (with its basis).

## Summary

| Question | Answer | Label |
|---|---|---|
| Free allowance | 100k API test executions a month; one execution is one check run in one location, per minute of run time | confirmed |
| 2 locations, 1-minute | 86,400 (30-day month), 89,280 (31-day) | confirmed formula, worked here |
| 3 locations, 1-minute | 129,600 (30-day), 133,920 (31-day): over 100k | confirmed (Grafana's own example) |
| 2 or 3 locations, 2-minute | 43,200 or 64,800 (30-day); 44,640 or 66,960 (31-day) | confirmed formula, worked here |
| Recommended locations | "multiple locations, preferably three or more", stated for checks with alerting | confirmed |
| Alert rule expression | `sum by(instance, job) (floor(increase(count[5m]) - increase(sum[5m]))) >= threshold` | inference from the app's source; the rule itself is created by a closed-source backend |
| "10 in 5 minutes" with 2 locations | Accepted by validation. In a total outage each location yields 4 or 5 per evaluation, so the sum is 8, 9 or 10. It can reach 10 but not on every evaluation | inference; needs a spike |
| Canary check settings | `no_follow_redirects = true`, `valid_status_codes = [302]` inside `settings { http { } }` | confirmed |
| Install without the UI | `grafana_synthetic_monitoring_installation` does it; `sm_access_token` and `metrics_publisher_key` land in state | confirmed |
| Tokens | Three credentials: Cloud access policy token (install), Synthetic Monitoring access token (checks, alerts), stack service account token (contact point, notification policy) | confirmed |
| `grafana_notification_policy` | "manages the entire notification policy tree and overwrites its policies" | confirmed |
| Retention | Free plan: "14 days retention for metrics, logs, traces, profiles, & k6 performance tests" | confirmed |

## 1. Execution allowance and how executions are counted

**Allowance: confirmed.** The pricing page's Synthetics API Testing free column reads "Limited to 100k API test executions & 10k browser test executions per month". Source: <https://grafana.com/pricing/>. HTTP checks are API tests: "**API tests** include HTTP, Ping, DNS, TCP, Traceroute, Multi Step, and Scripted checks." Source: <https://grafana.com/docs/grafana-cloud/cost-management-and-billing/understand-your-invoice/synthetic-monitoring-invoice/> (page title "Synthetic Monitoring pricing").

**Counting: confirmed.** Same page:

> **Test execution:** A synthetic test running in one probe location, per minute of run time.

> To estimate your monthly test executions, you need the number of probe locations, the number of checks, the duration of a test execution rounded up to the nearest minute, and the test frequency in minutes.
>
> `probes x tests x duration x (43,200 / frequency)`
>
> A check that runs every minute in three probe locations is three test executions per minute, or 129,600 test executions per month.

So executions are counted per check, per location, per run, and a run that takes over a minute counts more than once. The Canary link check's timeout is far below a minute, so duration is 1.

**Worked numbers** (the formula above; the docs use a 30-day month, the app's own usage calculator uses 31 days, `DAYS_IN_MONTH = 31` in `src/checkUsageCalc.ts`):

| Canary link check | 30-day month | 31-day month | Under 100k? |
|---|---|---|---|
| 2 locations, every 1 minute | 86,400 | 89,280 | yes |
| 3 locations, every 1 minute | 129,600 | 133,920 | no |
| 2 locations, every 2 minutes | 43,200 | 44,640 | yes |
| 3 locations, every 2 minutes | 64,800 | 66,960 | yes |

ADR 0011's Status page check (1 location, every 10 minutes) adds 4,320 (30-day) or 4,464 (31-day) to each row.

**Billing variance: confirmed.** "Aggregating execution counts can cause the billable amount to vary by plus or minus 0.5% from the true value. Grafana Cloud reduces the billable amount by 0.5% to avoid overbilling."

**Not documented** (in the pages fetched): whether the month is a calendar month or a rolling window, and what happens to checks on a Free stack once 100k is passed (checks paused, or executions dropped). A spike would have to exceed the allowance on a throwaway stack, or the Operator would have to ask Grafana.

**Related fact, confirmed, not raised by the review.** The same page says the active-series credit that used to offset Synthetic Monitoring's own metrics applies "only to Synthetic Monitoring accounts created before February 13, 2026". A stack created now has no such credit, so the checks' series count toward the Free plan's "10k active series per month" (pricing page). The per-check alert adds one more series: "The threshold metric time series counts against the credit of active series for Synthetic Monitoring as long as the alert is enabled for the check." The check form's usage calculator shows the series count for a check; this research did not measure it.

**Review claim: right.** "Three at one-minute frequency is about 130k executions, over the free 100k."

## 2. Recommended number of locations, and what a single-location failure looks like

**Recommendation: confirmed.** <https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/configure-alerts/synthetic-monitoring-alerting/> ("Configure legacy alerts"), section "Avoid alert-flapping":

> When enabling alerting for a check, it's recommended to run that check from multiple locations, preferably three or more. That way, if there's a problem with a single probe or the network connectivity from that single location, you won't be needlessly alerted, as the other locations running the same check will continue to report their results alongside the problematic location.

The wording is "preferably three or more", for checks with alerting. It sits on the legacy alerts page; the per-check alerts page has no equivalent sentence. The uptime page gives a softer version: "A best practice is to add multiple probes to your checks ... Multiple probes help to reduce alert flapping and counteract the sometimes unreliable nature of the internet. As you add more probes keep in mind how to balance your frequency and probe count to avoid unnecessary costs." Source: <https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/analyze-results/uptime-and-reachability/>.

**Review claim: mostly right.** "Grafana recommends at least three for critical checks" matches in substance. The exact words are "multiple locations, preferably three or more", said of checks with alerting enabled, not "critical checks".

**Single-location failure in the data: confirmed.** Uptime and reachability page:

> **probe_success:** A metric generated by each probe that represents the success or failure of its execution: 0 is failure, 1 is success.

> Uptime is the percentage of reported time points within a given period that had **at least one successful probe execution**.

Its worked table has a time point with ProbeA = 1, ProbeB = 0, ProbeC = 0 marked "Success". The uptime expression is `max by () (max_over_time(probe_success{job="$job", instance="$instance"}[$frequencyInSeconds]))`. So a single-location failure shows as `probe_success = 0` on that location's series (label `probe`), leaves uptime untouched, and lowers reachability ("the percentage of successful probe executions"). This matches ADR 0003's "a minute counts as down when every location fails".

**Missing data: confirmed.** The same page documents that a time point can go unreported: "The state of the system being monitored could not be determined for the missed time point, so it's omitted altogether." A rollup that reads `probe_success` has to treat a minute with no samples as unknown, not as up or down.

**Available public locations: confirmed.** 22 public probes, all on AWS: 7 in AMER, 8 in EMEA, 7 in APAC. Source: <https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/create-checks/public-probes/>. The page lists no Free-plan restriction on which locations may be used (**not documented** either way).

## 3. How the per-check "N failures in M minutes" alert is evaluated

### What the docs say

**Confirmed.** <https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/configure-alerts/configure-per-check-alerts/>:

> - **Number of failures**: Number of check execution failures in the selected time range.
> - **Time range**: Has to be greater or equal to the check frequency. Supported values are `5m`, `10m`, `15m`, `20m`, `30m`, `1h`.

> Per-check alert rules are composed of two parts: **A metric associated with the alert type** ... **A metric associated with the threshold**: This is a metric that identifies the threshold set by the user for each specific alert type and check combination, and that's continuously pushed as long as the alert is enabled for the check.

They are Grafana-managed alert rules, and "This label is included in every alert rule for Synthetic Monitoring": `namespace = synthetic_monitoring`.

**Not documented:** the rule's PromQL, its evaluation interval, its pending period, and how the count of failures is rounded.

### The expression, from the app's source

The rules are created by the Synthetic Monitoring API, which is closed source (the app links to `grafana/synthetic-monitoring-api/internal/alerts/rules.go`, a private repository). Two places in the public app show the expression. Both are **inference** about production: one is the query behind the check form's "Explore query" link, the other is a test fixture shaped like a rules-API response.

`src/components/CheckForm/AlertsPerCheck/AlertsPerCheck.constants.tsx`:

```promql
(
  sum by(instance, job) (
    floor(
      increase(probe_all_success_count{instance="$instance", job="$job"}[$period]) -
      increase(probe_all_success_sum{instance="$instance", job="$job"}[$period])
    )
  ) >=
 $threshold
) * on (instance, job)
group_right()
max without(probe, region, geohash) (
  sm_check_info{instance="$instance", job="$job"}
)
```

`src/test/fixtures/alerting.ts` (rule `ProbeFailedExecutionsTooHigh [5m]`, group `Failed Checks [5m]`, `interval: 60`, `duration: 300`):

```promql
(sum by(instance, job) (floor(increase(probe_all_success_count[5m]) - increase(probe_all_success_sum[5m]))) >= sum by (instance, job) (sm_alerts_threshold_probe_failed_executions_too_high{period="5m"})) * on (instance, job) group_right() max without(probe, region, geohash) (sm_check_info)
```

So, per location, failures = `floor(increase(count) - increase(sum))` over the period; the per-location values are summed across locations and compared with `>=` to the threshold. The `floor()` is applied per location, before the sum.

The fixture's `duration: 300` would be a 5-minute pending period (the condition must hold for 5 minutes before the alert fires) and `interval: 60` a one-minute evaluation interval. These are test data. Whether production rules carry a pending period is **not documented** and is the single biggest unknown for how long "Redirects down" takes to fire.

### Which thresholds validation accepts

**Inference from the app's source** (`src/schemas/general/CheckAlerts.ts`, `src/checkUsageCalc.ts`). The check form rejects a threshold above `floor(period / frequency) * probeCount` with "Threshold (N) must be lower than or equal to the total number of checks per period (M)". The code comment says "Use same logic as backend". The provider does no such validation (`internal/resources/syntheticmonitoring/resource_check_alerts.go` only validates `name` and `period`), so with OpenTofu the backend's answer is what counts; whether the API rejects an over-limit threshold is **not documented**.

| Check | Period 5m: largest accepted threshold |
|---|---|
| 2 locations, 1-minute | 10 |
| 3 locations, 1-minute | 15 |
| 2 locations, 2-minute | 4 |
| 3 locations, 2-minute | 6 |

"10 in 5 minutes" is therefore invalid at 2-minute frequency with 2 or 3 locations at the 5m period.

### Which thresholds can fire

**Documented basis.** Prometheus's `increase()`: "The increase is extrapolated to cover the full time range as specified in the range vector selector, so that it is possible to get a non-integer result even if a counter increases only by integer increments." Source: <https://github.com/prometheus/prometheus/blob/main/docs/querying/functions.md>.

**Inference, from three sources read together:**

1. The agent publishes one sample per execution, timestamped with the Go ticker's tick time in milliseconds (`internal/scraper/scraper.go`, `tickWithOffset` and `t.UnixMilli()`), each location at its own random offset. It republishes between runs only when the frequency is above 2 minutes (`if period > maxIdle`, `maxPublishInterval = 2 * time.Minute`).
2. Prometheus's `extrapolatedRate` (`promql/functions.go`) multiplies the raw delta between the first and last sample in the window by `(sampledInterval + durationToStart + durationToEnd) / sampledInterval`, extending to each window edge when the gap is under 1.1 sample intervals. The window's start is exclusive.
3. The rule floors the result per location.

At 1-minute frequency a 5-minute window normally holds 5 samples per location, which is 4 observed increments over 240 s, extrapolated by 300/240 to 5.0. That 5.0 is a floating-point result of timestamps that are never exactly 60,000 ms apart: a sampled interval of 240.001 s gives 4.99998, which floors to 4; 239.999 s gives 5.00002, which floors to 5. So during a total outage each location contributes 4 or 5 per evaluation.

A simulation of that formula (written for this ticket, Python, 20,000 evaluations per row, every execution failing, random offsets per location) gives the distribution of the summed value:

| Check | Timestamp jitter | Distribution of the sum |
|---|---|---|
| 2 locations, 1-minute | none | 9: 2%, 10: 98% |
| 2 locations, 1-minute | ±1 ms | 8: 12%, 9: 45%, 10: 44% |
| 2 locations, 1-minute | ±5 ms | 8: 21%, 9: 50%, 10: 30% |
| 3 locations, 1-minute | ±1 ms | 12: 4%, 13: 22%, 14: 45%, 15: 30% |
| 3 locations, 1-minute | ±5 ms | 12: 10%, 13: 34%, 14: 41%, 15: 16% |
| 2 locations, 2-minute | any | 4: 100% |
| 3 locations, 2-minute | any | 6: 100% |

The jitter sizes are assumptions; the real distribution of tick times was not measured. Grafana Cloud evaluates the rule with Mimir's query engine, which this research did not read; the simulation follows Prometheus's implementation.

What follows, all **inference**:

- **Thresholds that a total outage reaches on every evaluation** once the window is full: up to 4 × locations at 1-minute frequency (8 with 2 locations, 12 with 3), and up to 2 × locations at 2-minute frequency (4 with 2, 6 with 3; these equal the validation ceiling).
- **Threshold 10 with 2 locations at 1-minute** (ADR 0011) is reached only when both locations round up at once: on some evaluations, not all. If the rule has no pending period, one such evaluation fires the alert, so it would fire, late and at an unpredictable minute. If the rule has a 5-minute pending period as the fixture suggests, the condition must hold on every evaluation for 5 minutes, and an evaluation that sums to 8 or 9 resets it; firing then becomes unlikely.
- **Threshold 15 with 3 locations at 1-minute** has the same problem, with lower odds per evaluation.
- A threshold at the ceiling also needs every execution in the window to fail, so a single success from either location inside 5 minutes keeps the sum below it. With 2 locations that is ADR 0011's stated intent ("it fires when every execution in the window failed").
- A single location failing completely contributes 4 or 5 at 1-minute frequency, so any threshold of 5 or less can be reached by one location alone, and a threshold of 4 or less is reached by it on every evaluation.

**Review claim: partly right.** The review said "10 failures in 5 minutes" may never fire because of how the rule's `increase()` rounds, and flagged it as an inference. The mechanism is real: `floor()` over an extrapolated `increase()` yields 4 or 5 per location, so 10 is the maximum and is not reached on every evaluation. "May never fire" holds only if the rule has a pending period; without one it fires intermittently. Neither case is documented.

**What a spike or `doctor` check would have to test.** On a real stack, point a 2-location, 1-minute check at a target that always fails, enable `ProbeFailedExecutionsTooHigh` at 10 over 5m, and then: read the created rule back from the stack's alerting API (expression, `for`, evaluation interval), run the rule's expression in Explore over 30 minutes to see the summed values, and record whether and when the alert fires. Repeat at threshold 8.

## 4. HTTP check settings for the Canary link, in the provider's names

**Confirmed.** `grafana_synthetic_monitoring_check`, block `settings { http { ... } }`. Source: <https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/synthetic_monitoring_check> (read from `docs/resources/synthetic_monitoring_check.md` in the provider repository):

> - `no_follow_redirects` (Boolean) Do not follow redirects. Defaults to `false`.
> - `valid_status_codes` (Set of Number) Accepted status codes. If unset, defaults to 2xx.

And at the check level:

> - `frequency` (Number) How often the check runs in milliseconds (the value is not truly a "frequency" but a "period"). The minimum acceptable value is 1 second (1000 ms), and the maximum is 1 hour (3600000 ms). Defaults to `60000`.
> - `timeout` (Number) Specifies the maximum running time for the check in milliseconds. The minimum acceptable value is 1 second (1000 ms), and the maximum 180 seconds (180000 ms). Defaults to `3000`.
> - `probes` (Set of Number) List of probe location IDs where this target will be checked from.

The product docs describe the same two options as "Follow redirects: Whether to follow redirects or to stop at the first response." and "Valid status codes: Status codes considered as valid responses (defaults to 2xx)." Source: <https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/create-checks/checks/http/>.

With the defaults (`no_follow_redirects = false`, valid codes 2xx) the check follows the Redirect and passes or fails on the Target URL's response. With `no_follow_redirects = true` and `valid_status_codes = [302]` it stops at the first response and passes only on a 302.

**Review claim: right.** The provider's names are exactly `no_follow_redirects` and `valid_status_codes`.

**Not documented:** that the check also asserts the `Location` header. The docs describe "Regex validations" that can "match a header"; the provider exposes header-match blocks (`fail_if_header_not_matches_regexp`), which this research did not test.

`probes` takes numeric IDs; the provider's `grafana_synthetic_monitoring_probes` data source returns them by name (used in the installation example below).

## 5. Installing Synthetic Monitoring without the UI, and the tokens

**Install without the UI: confirmed.** `grafana_synthetic_monitoring_installation`, source <https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/synthetic_monitoring_installation>:

> Sets up Synthetic Monitoring on a Grafana cloud stack and generates a token. Once a Grafana Cloud stack is created, a user can either use this resource or go into the UI to install synthetic monitoring. This resource cannot be imported but it can be used on an existing Synthetic Monitoring installation without issues.
>
> **Note that this resource must be used on a provider configured with Grafana Cloud credentials.**
>
> Required access policy scopes: `stacks:read`

**Review claim: right.** ADR 0007's "Synthetic Monitoring switched on in the UI (the installation can't be imported)" is stale on the first half: the UI is one of two options. "Cannot be imported" is still true, with the documented addition that the resource "can be used on an existing Synthetic Monitoring installation without issues".

**What goes in state: confirmed from the schema.**

- `sm_access_token` (Read-Only): "Generated token to access the SM API." In the provider source (`internal/resources/cloud/resource_synthetic_monitoring_installation.go`) it is `Computed` and not marked `Sensitive`, so it is stored in state and also shown in plan output.
- `metrics_publisher_key` (Required, Sensitive): a Cloud access policy token with scopes "`stacks:read`, `metrics:write`, `logs:write`, `traces:write`. This is used to publish metrics and logs to Grafana Cloud stack." The docs' example creates it with `grafana_cloud_access_policy_token`, whose `token` is also in state.

About the Synthetic Monitoring token, <https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/set-up/provision-synthetic-monitoring-resources/> says: "Synthetic Monitoring access tokens don't have an expiration date." and "Synthetic Monitoring access tokens don't support role-based access control (RBAC). This means all access tokens have the same level of access and cannot be scoped or restricted to specific resources or actions."

**Tokens `production-admin` needs: confirmed.** The provider takes separate credentials per API (provider index, <https://registry.terraform.io/providers/grafana/grafana/latest/docs>):

| Provider argument | What it is | Used for |
|---|---|---|
| `cloud_access_policy_token` | "Access Policy Token for Grafana Cloud" | `grafana_cloud_stack`, access policies, `grafana_synthetic_monitoring_installation` |
| `sm_access_token` (+ `sm_url`) | "Grafana Synthetic Monitoring uses distinct tokens for API access." | `grafana_synthetic_monitoring_check`, `grafana_synthetic_monitoring_check_alerts`, the probes data source |
| `auth` (+ `url`) | "a Grafana API key, basic auth `username:password`, or a Grafana Service Account token" | Resources on the stack's own Grafana, which the provider's example comments as "Grafana (dashboards, folders, alerting, users, etc.)": `grafana_contact_point`, `grafana_notification_policy` |

The provider index says the initial Cloud token "is used to create the stack, service accounts, and additional access policy tokens for the various Grafana Cloud services. The required scopes are `accesspolicies:read|write|delete`, `stacks:read|write|delete`, and `stack-service-accounts:write`." A stack service account token can be minted in OpenTofu (`grafana_cloud_stack_service_account_token`) from that Cloud token, in which case it too is in state.

**Review claim: right.** The contact point and notification policy need the stack token (`auth`), which the Synthetic Monitoring token cannot replace. If OpenTofu also installs Synthetic Monitoring, a Cloud access policy token is a third credential.

**Not documented:** the minimum role a stack service account needs for `grafana_contact_point` and `grafana_notification_policy`. A `doctor` check would have to apply both with the intended role.

## 6. `grafana_notification_policy` overwrites the whole tree

**Confirmed.** <https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/notification_policy>:

> Sets the global notification policy for Grafana.
>
> !> This resource manages the entire notification policy tree and overwrites its policies. However, it does not overwrite internal policies created when alert rules directly set a contact point for notifications.

Grafana's provisioning docs, <https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/terraform-provisioning/>:

> Since the policy tree is a single resource, provisioning it will overwrite all policies in the notification policy tree. However, it does not affect internal policies created when alert rules directly select a contact point.
>
> 1. Find the default notification policy tree. Alternatively, consider writing the resource in code as demonstrated in the example below.
> 2. Export the notification policy tree in Terraform format. This exports it as `grafana_notification_policy` Terraform resource—edit it if necessary.

**Review claim: right.**

**The documented way to manage one route:** there is none with this resource. The documented procedure is to own the whole tree: export the existing tree, add the route as a nested `policy` block, and apply. The resource supports import ("`terraform import grafana_notification_policy.name "{{ anyString }}"`") and has `disable_provenance` ("Allow modifying the notification policy from other sources than Terraform or the Grafana API. Defaults to `false`.").

Two documented alternatives exist, each with a limit:

- An alert rule can select a contact point directly, and those internal policies are not overwritten. Per-check alert rules are created by Synthetic Monitoring, not by the Operator's OpenTofu, and the per-check docs route them only by notification policy ("create a child notification policy that matches the label `namespace = synthetic_monitoring`"). Whether such a rule can be given a contact point directly is **not documented**.
- `grafana_apps_notifications_routingtree_v1beta1` manages one named routing tree among several: "Requires Grafana 13.1+ with the `alertingMultiplePolicies` feature toggle enabled." Whether Grafana Cloud Free stacks have that toggle is **not documented**.

**Not documented:** what a new Free stack's default tree contains. A spike would export it before the first apply.

## 7. Probe data retention

**Confirmed.** Pricing page, Free plan: "14 days retention for metrics, logs, traces, profiles, & k6 performance tests"; the Metrics free column repeats "14 days retention". Source: <https://grafana.com/pricing/>. Probe results are metrics and logs: "The Synthetic Monitoring probes report their execution results in the form of metrics to Grafana Cloud Mimir and logs to Grafana Cloud Loki." (uptime and reachability page).

ADR 0003's "Probe history lives in Grafana Cloud Free for 14 days" stands.

## Review claims, in one place

| Review claim | Verdict |
|---|---|
| Grafana recommends at least three locations for critical checks | Right in substance; exact words are "multiple locations, preferably three or more", for checks with alerting |
| Three locations at one-minute frequency is about 130k executions, over the free 100k | Right (129,600 in Grafana's own example) |
| "10 failures in 5 minutes" may never fire because of how `increase()` rounds | Partly right. The rounding is real and 10 is not reached on every evaluation; "never" depends on an undocumented pending period |
| The check must set `no_follow_redirects` and `valid_status_codes = [302]` | Right |
| The provider can install Synthetic Monitoring, though it puts a token in state | Right |
| `production-admin` needs a stack token as well as the Synthetic Monitoring token | Right |
| `grafana_notification_policy` overwrites the whole policy tree | Right |
| Probe history is kept 14 days (ADR 0003) | Right |

## Open questions

- Does a production `ProbeFailedExecutionsTooHigh` rule have a pending period, and what is its evaluation interval? (Section 3 spike.)
- Does the Synthetic Monitoring API reject a threshold above `floor(period / frequency) * probeCount` when it arrives from the provider?
- What happens on a Free stack once the month's 100k executions are used, and how is the month bounded?
- How many active series does the Canary link check produce per location, now that new accounts get no Synthetic Monitoring series credit?
- What does a new stack's default notification policy tree contain, and which service account role can replace it?
- Is `alertingMultiplePolicies` enabled on Grafana Cloud Free?
