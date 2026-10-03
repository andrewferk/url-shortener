---
status: accepted
---

# Probe from three locations every two minutes, count uptime in Probe-minutes, and alert from Grafana rules we own

[ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md) probes the Canary link from two locations every minute, and [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md) alerts through Grafana's per-check `ProbeFailedExecutionsTooHigh` rule at "10 failures in 5 minutes". Grafana recommends "preferably three or more" locations for a check that alerts, and three at one-minute frequency is about 134k executions a month against the free 100k. The per-check rule is built by a closed-source backend, floors an extrapolated `increase()` per location, and reaches a threshold of 10 on only some evaluations of a total outage, so it may never fire. [ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md) also leaves Synthetic Monitoring to be switched on by hand in the UI.

So Probes run from three **Probe locations** every 2 minutes, which is free and follows the guidance. Uptime is still counted in **Probe-minutes**: each run stands for the minutes of its interval. A window is down only when at least two locations reported and every one failed. Both Grafana alerts become rules we write ourselves on `probe_success`, which state that definition directly and have no rounding edge. A fire drill proves the rule before launch. OpenTofu installs Synthetic Monitoring, from `infra/bootstrap`.

Decided in [How many Probe locations, and which alert rule, does the uptime Objective need?](https://github.com/andrewferk/url-shortener/issues/52), from the research in [What do Grafana's Probe limits, locations and alert rules allow on the free tier?](https://github.com/andrewferk/url-shortener/issues/44).

## Decision

### Locations and frequency

- **The Canary link check** runs from three Probe locations every 2 minutes.
- **The Status page check** runs from two Probe locations every 10 minutes (it was one). One location's network trouble no longer sends a false stale alert.
- **Inputs,** in `infra/env`, used when `probes_enabled`:

  | Variable | Default |
  |---|---|
  | `probe_frequency_seconds` | 120 |
  | `probe_locations` | three Grafana public locations on three continents |
  | `status_check_locations` | two of the same |

  `probe_locations` needs at least two entries, because the down rule below needs two reports. The plan fails with fewer. The default names are picked in the Status page slice from Grafana's current list.

### Probe-minutes

- **A Probe-minute** is one minute of the uptime Objective's window, judged by the Probe run that covers it. A run covers `probe_frequency_seconds`, so at the default one run stands for 2 Probe-minutes.
- **The rollup groups reports into windows** of one Probe frequency, because the three locations fire at different moments. Each window is one of:

  | Window | When | Probe-minutes |
  |---|---|---|
  | up | any location succeeded | counted, not down |
  | down | at least two locations reported and every report failed | counted, down |
  | unobserved | no report, or a lone report that failed | leave the denominator |

- **Unobserved windows** follow [ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md): attainment is good minutes over observed minutes, and the Objectives row shows "N minutes unobserved".
- **The Objective is unchanged:** 99.9% of Probe-minutes over a rolling 30 days, an Error budget of 43.2 minutes. D1 keeps storing Probe-minutes and down Probe-minutes, so history stays comparable if an Operator changes the frequency.
- **Resolution is the Probe frequency.** An outage shorter than 2 minutes can fall between runs and go unrecorded, and a recorded one is rounded to whole runs. Accepted.

### Alert rules

Three Grafana-managed rules in one `grafana_rule_group`, in `infra/env` when `probes_enabled`. They replace `grafana_synthetic_monitoring_check_alerts`. All go to ADR 0011's email contact point, and the notification policy routes on a label these rules carry instead of `namespace=synthetic_monitoring`.

| Rule | Fires when |
|---|---|
| **Redirects down** | over three Probe frequencies (6 minutes at the default), no location's Canary link check succeeded and at least two locations reported |
| **Status page stale** | over 20 minutes, neither location's Status page check succeeded and at least one reported |
| **Probes blind** | fewer than two locations reported on the Canary link check in 10 minutes, or none reported on the Status page check in 30 minutes |

- **The shape** of Redirects down, to be confirmed by the drill:

  ```promql
  max by (job, instance) (max_over_time(probe_success[6m])) == 0
  and
  count by (job, instance) (count_over_time(probe_success[6m])) >= 2
  ```

  The window is rendered from `probe_frequency_seconds`, never hard-coded, so the rule survives a change of frequency or locations.
- **Probes blind** exists because the other two rules return nothing when no data arrives. A broken or deleted check must not look like a healthy service.
- **No pending period** on any rule. The window is already the wait.

### The fire drill

- **Before launch,** a HITL step in the launch milestone: a temporary second check with the same settings and the same rules targets a Custom alias that does not exist, so it gets 404 where it expects 302. The Operator confirms the "Redirects down" email arrives, records the time to fire, removes the check, and confirms the resolve email.
- **The Canary link is never deleted for a test.** [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md) burns a deleted Custom alias for good.
- **The operator docs repeat the drill** after any change to `probe_frequency_seconds`, the locations or the rules.
- The drill replaces the spike the research asked for on the per-check rule's pending period, which nothing now depends on.

### Installation

- **`infra/bootstrap` gains one OpenTofu configuration,** holding `grafana_synthetic_monitoring_installation`. The Operator applies it by hand with a Cloud access policy token from their password manager. The rest of bootstrap stays a runbook.
- **Its state** is a `bootstrap` key in the prod state bucket, encrypted with its own passphrase that only the password manager holds. No GitHub environment can decrypt it.
- **The state holds `sm_access_token` and `metrics_publisher_key`.** This is the one deliberate exception to ADR 0007's "state should hold no secrets". The provider does not mark `sm_access_token` sensitive, so the Operator copies it from `tofu output` into `production-admin`, beside the stack token.
- **No CI credential can install or mint anything,** as ADR 0007 requires: the Cloud access policy token never reaches CI.
- The installation can't be imported. An Operator who already switched Synthetic Monitoring on in the UI keeps that and skips this configuration.

## Cost

$0 extra. Synthetic Monitoring executions against Free's 100k:

| Check | 30-day month | 31-day month |
|---|---|---|
| Canary link, 3 locations, every 2 minutes | 64,800 | 66,960 |
| Status page, 2 locations, every 10 minutes | 8,640 | 8,928 |
| **Total** | **73,440** | **75,888** |

About 24k a month is spare. Accounts created after 2026-02-13 get no active-series credit for Synthetic Monitoring, so five location-checks' series count toward Free's 10k; the Status page slice confirms the figure.

## Considered options

- **Two locations every minute (ADRs 0003 and 0011).** Finer resolution, but when Grafana loses one location the other's local blips become down minutes against a 43-minute budget, and it leaves only 6k executions spare.
- **Three locations every minute.** About 138k executions with the Status page check, which needs a paid plan, against a budget of $20/mo for everything.
- **Counting Probe runs instead of Probe-minutes.** The budget would change units with the frequency, and history on either side of a change would not add up.
- **A majority rule for down.** A regional failure would count as downtime. Grafana's own uptime counts a time point as up when any location succeeded.
- **Counting a lone failing report as down.** It is the single-location case the third location exists to remove.
- **Keeping the per-check alert with a threshold of 8 or lower.** Reachable, but the rule stays closed source, rounds per location, and its threshold must be recomputed for every change of locations or frequency. At 2-minute frequency its 5-minute ceiling with three locations is 6.
- **Leaving the installation in the UI.** One more manual step for every self-hosting Operator, and nothing records that it was done.
- **Installing from `infra/env`.** The Cloud access policy token would sit in `production-admin`, and the Synthetic Monitoring token would land in a state every prod environment can decrypt.

## Consequences

- **Amends ADR 0003:** three locations every 2 minutes; "a minute counts as down when every location fails" becomes the window table above; today's executions are about 76k, not 86k.
- **Amends ADR 0007:** `infra/bootstrap` holds one OpenTofu configuration with its own state key and passphrase; `infra/env` owns the rule group in place of the check alerts; "Synthetic Monitoring switched on in the UI" becomes the provider resource.
- **Amends ADR 0011:** both Grafana alerts are our own rules, plus Probes blind; the Status page check runs from two locations; the executions table is replaced by the one above, and headroom is about 24k, not 6k.
- **"Redirects down" arrives 6 to 8 minutes into a total outage.** Alerts are email-only with no paging, so the extra minutes cost nothing.
- **A lost passphrase for the bootstrap state** loses only the record of the installation. The tokens can be reissued from Grafana.
- **The third Probe location adds no recurring cost,** which settles that part of the map's budget question.
