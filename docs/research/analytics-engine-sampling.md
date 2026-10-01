# How Analytics Engine samples, and what the index choice costs

Research for [issue 41](https://github.com/andrewferk/url-shortener/issues/41). Facts only; the choice is made in the grilling ticket "How do Redirect event queries stay correct under sampling, and can the rollup be backfilled?".

All sources are Cloudflare's own docs, fetched as raw Markdown (`<url>index.md`, with `curl`) on **2026-10-01**. Quotes are exact.

| Key | Page | "Last updated" on page |
|---|---|---|
| SAMPLING | https://developers.cloudflare.com/analytics/analytics-engine/sampling/ | Apr 23, 2026 |
| SQLAPI | https://developers.cloudflare.com/analytics/analytics-engine/sql-api/ | Apr 23, 2026 |
| AGG | https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/ | Apr 23, 2026 |
| FAQ | https://developers.cloudflare.com/analytics/faq/wae-faqs/ | Apr 23, 2026 |
| START | https://developers.cloudflare.com/analytics/analytics-engine/get-started/ | Apr 23, 2026 |
| LIMITS | https://developers.cloudflare.com/analytics/analytics-engine/limits/ | Apr 23, 2026 |
| PRICING | https://developers.cloudflare.com/analytics/analytics-engine/pricing/ | Apr 23, 2026 |
| BILLING | https://developers.cloudflare.com/analytics/analytics-engine/recipes/usage-based-billing-for-your-saas-product/ | Sep 4, 2026 |

Also fetched, with nothing relevant found: the Analytics Engine overview, "Querying from a Worker", "Querying from Grafana" and SQL statements pages, and the Workers pricing and Workers limits pages (neither mentions Analytics Engine).

Each claim below is labelled **confirmed** (docs say it), **contradicted**, **not documented**, or **inference**.

## What the design does today

- ADR 0003: one Redirect event per Redirect; index = the Short code; doubles `duration_ms`, `weight`, `status`; percentiles from `quantileExactWeighted`, "weighted by `weight`"; `weight = 1/redirect_event_sample_rate`, default rate 1.0.
- ADR 0014: the index becomes `<Namespace ID>:<Short code>`.
- ADR 0004: the cost brake "sums today's weighted Redirect events that reached a shard (`shard-fallback`, `not-found`)".
- ADR 0011: rollup buckets store "additive weighted counts".
- No ADR mentions `_sample_interval`.

## 1. How sampling works

**Two stages. Confirmed.**

> "1. At write time, we sample if data points are written too quickly into one index.
> 2. We sample again at query time if the query is too complex." (SAMPLING)

> "Sampling can occur on write and on read. Sampling is based on the index of your dataset so that only indexes that receive large numbers of events will be sampled." (SQLAPI)

**Write time is per index value ("equitable sampling"). Confirmed.**

> "We do this through a technique called equitable sampling. This means that we will equalize the number of events we store for each unique index value. For relatively uncommon index values, we may write all of the data points that we get via `writeDataPoint()`. But if you write lots of data points to a single index value, we will start to sample." (SAMPLING)

> "Equalization happens every few seconds; if you are writing many events very close in time, then it is expected that they will be sampled at write time. The sample interval for a given index will vary from moment to moment, based on the current rate of data being written." (FAQ)

**Query time is adaptive bit rate (ABR), driven by rows to read. Confirmed.**

> "With ABR, queries that cover longer time ranges will retrieve data from a higher sample interval, allowing them to be completed within a fixed time limit. [...] we need to limit the total number of rows scanned to provide an answer to the query."

> "we store the data in multiple resolutions (that is, with different levels of detail, for instance, 100%, 10%, 1%) derived from the equitably sampled data. At query time, we select the most suitable data resolution to read based on the query's complexity. The query's complexity is determined by the number of rows to be retrieved and the probability of the query completing within a specified time limit of N seconds." (SAMPLING)

> "There is no hard and fast rule for when sampling starts at read time, but in practice reading longer periods (or more index values) will result in a higher sample interval." (FAQ)

**What `_sample_interval` means. Confirmed.**

> "every event is recorded with the `_sample_interval` field. The sample interval is the inverse of the sample rate. For example, if a one percent (1%) sample rate is applied, the `sample_interval` will be set to `100`." (SAMPLING)

> "this column indicates what the sample rate is for this row (that is, how many rows of the original data are represented by this row)" (SQLAPI, column type "integer")

> "the sample interval can vary for each row. As a result, when querying the data, you need to consider the sample interval field. Simply multiplying the query result by a constant sampling factor is not sufficient." (SAMPLING)

**The documented way to aggregate. Confirmed** (table from SAMPLING, exact):

| Use case | Example without sampling | Example with sampling |
|---|---|---|
| Count events in a dataset | `count()` | `sum(_sample_interval)` |
| Sum a quantity, for example, bytes | `sum(bytes)` | `sum(bytes * _sample_interval)` |
| Average a quantity | `avg(bytes)` | `sum(bytes * _sample_interval) / sum(_sample_interval)` |
| Compute quantiles | `quantile(0.50)(bytes)` | `quantileExactWeighted(0.50)(bytes, _sample_interval)` |

> "`quantileExactWeighted(q)(column_name, weight_column_name)` [...] Each row will be weighted by the value in `weight_column_name`. Typically this would be `_sample_interval`" (AGG)

**How to tell whether data was sampled. Confirmed.**

> "You can tell when data is sampled at read time because sample intervals will be multiples of powers of 10, for example `20` or `700`." (FAQ)

> "it is good to check the number of rows read by using count() [...] If you are extrapolating from only one or two rows, it is unlikely you have a representative result; if you are extrapolating from thousands of rows, it is very likely that your results are quite accurate." (FAQ)

No error bound is exposed: "it is difficult at present to prove that the results returned by ABR queries are within a certain error bound" (FAQ).

## 2. The design's own `weight` column

- **Not documented:** Cloudflare's docs say nothing about a caller-supplied weight. A double is just a quantity.
- **Inference** (from the "sum a quantity" row, `sum(bytes * _sample_interval)`): a stored row stands for `_sample_interval` written rows, each of which stands for `weight` Redirects. So a count of Redirects is `sum(weight * _sample_interval)`, and a quantile's weight is `weight * _sample_interval`.
- **Inference:** a query that uses `sum(weight)` or `quantileExactWeighted(q)(duration_ms, weight)` alone counts each stored row as `weight` Redirects. Whenever a row comes back with `_sample_interval > 1`, volume, the Error budget counts (eligible, fast, non-5xx) and the brake's count come out low by that row's factor. Ratios (error rate, share under threshold) and percentiles are skewed only where sample intervals differ between rows, which the docs say they do ("can vary for each row").
- **Not documented; a spike must test:** whether `quantileExactWeighted` accepts an expression (`double2 * _sample_interval`) as its weight, and a non-integer weight (`1/rate` is fractional for most rates; `_sample_interval` is an integer).

### From what write rate?

**Not documented as a rule. Confirmed that there is no fixed threshold:**

> "There is no fixed rule determining when sampling will be triggered. We have observed that for workloads like our global CDN, which distribute load around our network, each index value needs about 100 data points per second before sampling is noticeable at all. Depending on your workload and how you use Workers Analytics Engine, sampling may start at a higher or lower threshold than this." (FAQ)

Inferences from that one observed figure (about 100 data points per second per index value):

- With the Short code in the index, write-time sampling would begin only when a **single Link** takes on the order of 100 Redirects per second. Deployment-wide rate does not matter at write time.
- With a coarse index (one value per Namespace, outcome or colo), it would begin when that **one value** takes on the order of 100 Redirects per second.
- Today's traffic (about 300k Redirects a month, roughly 0.1 per second) is far below the figure under any index.
- Read-time sampling has no figure at all. It depends on rows to read, the time range and the number of index values read. The 5-minute rollup and the brake's "today" query both read across every index value, which is the case the docs say raises the sample interval.

A `doctor` check or spike would have to: write at a known rate, then compare `count()`, `sum(_sample_interval)` and the true count for the rollup and brake queries, and report the largest `_sample_interval` seen.

## 3. Index cardinality: what a near-unique index costs

**Confirmed: Cloudflare advises against a unique index value per row, and says the cost is slow aggregations.**

> "It is not recommended to write a unique index value on every row (like a UUID) for most use cases. While this will make it possible to retrieve individual data points very quickly, it will slow down most queries for aggregations and time series." (SAMPLING)

**Confirmed: reading across many index values is slow and comes back at low resolution.**

> "No, adding a large number of index values does not come without drawbacks. The tradeoff is that reading across many indices is slow. In practice, due to how ABR works, reading from many indices in one query will result in low-resolution data – possibly unusably low. On the other hand, if you pick a good index that aligns with how you read the data, your queries will run faster and you will get higher resolution results." (FAQ)

> "The index should match how users will query and view data." (SAMPLING)

**Confirmed: the index is good for all-values and one-value queries, weaker for some-values queries.** The index lets you:

> "Get accurate summary statistics about your entire dataset, across all index values." / "Get accurate summary statistics (for example, count, sum) within a particular index value."

but

> "You may not be able to run accurate queries across multiple indices at once. For example, you may only be able to query for one host at a time (or all of them) and expect accurate results." (SAMPLING)

These two statements pull in different directions for a query across all Short codes: SAMPLING lists whole-dataset statistics as accurate, and FAQ says many indices in one query gives low-resolution data. The docs do not reconcile them or give a cardinality figure. **Not documented:** at how many index values, or how many rows, a deployment-wide query drops a resolution.

**Applied to this design (inference):** the Short code is not unique per row, but a Link with one Redirect in a window is one index value per row, and every `not-found` guess is its own index value if the guessed code is written as the index. The Status page rollup and the brake read across all of them, which is the pattern the FAQ warns about. Pricing does not penalise cardinality ("There is no extra cost to add dimensions or cardinality", PRICING).

**Documented alternatives (confirmed), stated here without recommending either:**

> "It is possible to concatenate multiple values in your index field. So if you want to index on user ID and hostname, you can write, for example `"$userID:$hostname"` into your index field."

> "based on your query pattern, it may make sense to write the same dataset with different indices. It is a common misconception that one should avoid "double-writing" data. Thanks to sampling, the cost of writing data multiple times can be relatively low. However, reading data inefficiently can result in significant expenses or low-quality results due to sampling." (FAQ)

Each `writeDataPoint()` call is one billed data point (PRICING), so a second write per Redirect doubles the write count.

## 4. If the index moves off the Short code, are a low-traffic Link's events sampled away?

**Confirmed that sampling is per index value, and that rare values of a non-index field can vanish once that index value is sampled.**

> "You may not be able to observe very rare values of fields not in the index. For example, a particular URL for a hostname, if you index on host and have millions of unique URLs." (SAMPLING)

> "If you are reading from a larger index over a longer time period, and have filtered to a relatively small subgroup within that index, it may not be present due to sampling. If you need to read accurate results for that subgroup, we suggest that you add that field to your index" (FAQ)

> "If all data is sampled together, the usage of bigger customers can cause smaller customers data to be sampled to zero. Analytics Engine allows you to prevent that: in the example code above we supply the customer's unique ID as the index" (BILLING)

> "You may not be able to get accurate unique counts of fields that are not in your index." / "There is no guarantee you can retrieve any one individual record." (SAMPLING)

So, with the Short code moved to a blob under a coarse index:

- **Confirmed:** once that index value is sampled, at write time or read time, a low-traffic Link's count can be quantized or "rounded to 0 entirely" (SAMPLING), and the count of distinct Links is not reliable.
- **Inference:** below the sampling threshold nothing is dropped, so at today's traffic per-Link counts would still be complete. The loss starts at roughly 100 Redirects per second on one index value (observed figure, not a rule), or earlier at read time for long windows.
- **Confirmed:** with the Short code in the index, a per-Link query is the accurate case: "grouping by the index field so an exact count can be calculated even in the case that the data has been sampled" (SQLAPI), and "when generating bills we suggest executing one query per customer. This can result in less sampling than querying multiple customers at once." (BILLING).

## 5. Limits and pricing

**Limits. Confirmed (LIMITS):**

> "Analytics Engine will accept up to twenty blobs, twenty doubles, and one index per call to `writeDataPoint`."
> "The total size of all blobs in a request must not exceed **16 KB**. The 16 KB size limit for the blobs field applies to **each individual data point**"
> "Each index must not be more than 96 bytes."
> "You can write a maximum of 250 data points per Worker invocation (client HTTP request). Each call to `writeDataPoint` counts towards this limit."
> "Data written to Workers Analytics Engine is stored for three months."

> "While the `indexes` field accepts an array, you currently must only provide a single index. If you attempt to provide multiple indexes, your data point will not be recorded." (START)

**Pricing. Confirmed (PRICING):**

| Plan | Data points written | Read queries |
|---|---|---|
| Workers Paid | 10 million included per month (+$0.25 per additional million) | 1 million included per month (+$1.00 per additional million) |
| Workers Free | 100,000 included per day | 10,000 included per day |

> "Currently, you will not be billed for your use of Workers Analytics Engine. Pricing information here is shared in advance, so that you can estimate what your costs will be once Cloudflare starts billing for usage in the coming months."

> "Every time you call `writeDataPoint()` in a Worker, this counts as one data point written. Each data point written costs the same amount. There is no extra cost to add dimensions or cardinality"

> "Every time you post to Workers Analytics Engine's SQL API, this counts as one read query. [...] no extra cost for more or less complex queries"

Billing counts `writeDataPoint()` calls, not stored rows, so Cloudflare's write-time sampling does not reduce the bill (inference from the wording above). ADR 0003's figure of about $7.5k a month for 30B writes matches $0.25 per million.

**SQL API limits. Not documented** on any page fetched: no request rate limit, query timeout (SAMPLING says only "a specified time limit of N seconds"), response size or row limit. The LIMITS page lists only the write limits and retention above. Documented SQL restrictions: "queries can only operate on a single table. `UNION`, `JOIN` etc. are not currently supported" (statements page). The token needs "Account | Account Analytics | Read" (SQLAPI).

## 6. Were the reviews right?

| Review claim | Verdict |
|---|---|
| Provider review: "Cloudflare samples at write and query time and says to use `sum(_sample_interval)` and `quantileExactWeighted(q)(x, _sample_interval)`" | **Right.** Confirmed word for word by SAMPLING and AGG. |
| Provider review: "As written, volume, Error budgets and the cost brake undercount under load." | **Right in direction, unquantified.** The queries ignore `_sample_interval`, so any sampled row is undercounted (inference from the documented formulas). "Under load" has no documented threshold: about 100 data points per second per index value is an observation, and read-time sampling has no figure. With the Short code as the index, the read-time path (many index values in one query) is the likelier trigger than the write-time path. |
| Provider review: "Cloudflare advises against a near-unique index value per row." | **Mostly right; the wording is the review's.** The docs say "unique index value on every row (like a UUID)", and separately that "reading across many indices is slow" and gives "low-resolution data – possibly unusably low". The Short code is one value per Link, not per row. The docs also list whole-dataset statistics "across all index values" as something the index gives accurately, which the review did not mention. |
| Features review: moving the index off the Short code "would probably cause low-traffic Links' clicks to be sampled away" | **Right once sampling is active, not before.** Confirmed by SAMPLING, FAQ and BILLING ("sampled to zero"). Below the threshold nothing is sampled, so it does not apply at today's traffic (inference). |
| Attacks review: the undercount means the brake "also trips late under real load" | **Right as an inference,** same basis and same missing threshold as the second row. A flood of guessed Short codes makes many index values, which is the read pattern the FAQ says lowers resolution. The size of the delay is not documented. |

No review claim was found to be wrong.

## 7. Open questions (not documented; a spike or `doctor` check must test)

1. The write rate per index value and the query shape at which `_sample_interval` first exceeds 1 for this deployment's rollup and brake queries.
2. Whether a deployment-wide query over many Short-code index values stays accurate ("across all index values") or degrades ("many indices in one query"), and at what cardinality.
3. Whether `quantileExactWeighted` accepts `weight * _sample_interval` as an expression and a fractional weight.
4. SQL API rate limits, timeouts and response size limits.
5. Whether a write is ever dropped other than by sampling, and how long a data point takes to become queryable. No page fetched states a delivery guarantee or an ingestion delay.
6. What "three months" of retention is in days, and whether the lower-resolution copies share it.
7. When billing starts. The pricing page says "in the coming months" and has said so since at least its Apr 23, 2026 update.
