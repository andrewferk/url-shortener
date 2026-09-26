# TypeScript vs Rust vs Go vs JVM for Redirects, per platform

Research for [#4](https://github.com/andrewferk/url-shortener/issues/4), child of the map [#1](https://github.com/andrewferk/url-shortener/issues/1). Gathered 2026-09-26. This file holds facts and trade-offs only. The language is chosen in #6 ("Which provider, runtime topology, and language do we build on?").

The workload is a Redirect: look up the Short code, fetch the Target URL (from a cache or the datastore), and answer 302 (or 410 for an Expired link). The handler does almost no CPU work. Most of its time goes to I/O.

## TL;DR

- **Support:** Cloud Run and Fly.io run any container, so all four languages are first-class there. Lambda runs all four: Node.js and Java as managed runtimes, Rust, Go and GraalVM native binaries on the OS-only runtime. **Lambda@Edge runs only Node.js and Python.** On **Cloudflare Workers, only JS/TS is native.** Rust runs as Wasm through `workers-rs`, which is Cloudflare-maintained and self-described as having "rough edges". Go runs only through an experimental community project. The JVM can't run in a Worker at all; it needs Cloudflare Containers, which is a different topology.
- **Cold start (Lambda, hello-world floor):** Rust ~35–50 ms < Go ~65–75 ms < Node.js ~115–140 ms ≈ GraalVM native ~125–170 ms < managed Java ~180–240 ms. With a real app (SDK plus framework), the gaps grow. Java frameworks without SnapStart take 2.5–5 s.
- **Warm latency with a DynamoDB round trip is nearly the same in every language.** In AWS's own four-language sample app, warm p50 was 5.1 ms (Rust), 5.5 ms (Go), 5.3 ms (GraalVM) and 6.6 ms (TypeScript). The biggest gap is at p99: about 18–20 ms for the compiled languages vs 41 ms for TypeScript.
- **Against a ~200 ms Redirect target**, language shows up mostly in **cold starts and tail latency**, not in the median. When a Redirect is a **CDN cache hit**, compute never runs, so language doesn't matter for that request at all.
- **Cost:** Lambda and Workers charges for a Redirect-sized handler are dominated by the per-request fee, not by compute time or memory. Memory footprint matters more where you pay for provisioned instances (Cloud Run, Fly.io). There, the JVM's larger resident memory can force a bigger instance size.
- **SDKs:** TS, Go and Java have official, GA SDKs for every candidate datastore. Rust has a GA AWS SDK (DynamoDB). On GCP, Rust has **no Firestore data-plane client** and only a **preview** Spanner client. In Rust on Workers, KV is supported but D1 is alpha.

## 1. How each platform supports each language

| Platform | TypeScript | Rust | Go | JVM (HotSpot / GraalVM native) |
|---|---|---|---|---|
| **Cloudflare Workers** | Native (V8 isolates); first-class, all bindings | Wasm via [`workers-rs`](https://github.com/cloudflare/workers-rs) (Cloudflare-maintained). KV and Durable Objects supported; D1 **alpha**, Queues **beta**, RPC experimental. No Tokio (single-threaded Wasm) | Wasm via community [`syumai/workers-go`](https://github.com/syumai/workers-go) ("Caution: This is an experimental project"); TinyGo or standard Go Wasm | **Not supported** in isolates. Kotlin can target JS/Wasm; JVM bytecode can't run. A JVM would need [Cloudflare Containers](https://developers.cloudflare.com/containers/) (GA, Workers Paid, fronted by a Worker/Durable Object) |
| **AWS Lambda** | Managed `nodejs22.x` / `nodejs24.x` | OS-only `provided.al2023` + AWS [Rust runtime client](https://docs.aws.amazon.com/lambda/latest/dg/lambda-rust.html) | OS-only `provided.al2023` (the managed `go1.x` runtime was deprecated 2024-01-08) | Managed `java21` / `java25`, with SnapStart; GraalVM native image on `provided.al2023` |
| **Lambda@Edge** | Node.js | **No** | **No** | **No** |
| **CloudFront Functions** | JS only (10 KB code, 2 MB memory) | No | No | No |
| **GCP Cloud Run** | Any container | Any container | Any container | Any container |
| **Fly.io** | Any container (Firecracker microVM) | Any container | Any container | Any container |

Sources:
- Workers: [languages](https://developers.cloudflare.com/workers/languages/), [Rust](https://developers.cloudflare.com/workers/languages/rust/), [workers-rs README](https://github.com/cloudflare/workers-rs), [workers-go README](https://github.com/syumai/workers-go).
- Lambda: [runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).
- Lambda@Edge: [restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html) ("supports the latest versions of Node.js and Python runtimes"). Also: x86 only, us-east-1 only, no environment variables, no container images, no provisioned concurrency.
- CloudFront Functions: [quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html). Its KeyValueStore is capped at 5 MB, which can't hold 1B Links.

Platform limits that interact with language choice:
- **Workers:** 128 MB memory per isolate, covering both the JS heap and Wasm allocations. Global scope must finish startup within 1 s. CPU time is capped at 10 ms per request on Free and defaults to 30 s on Paid. ([limits](https://developers.cloudflare.com/workers/platform/limits/)) Cloudflare warns that "Workers that use WebAssembly are typically larger than an equivalent Worker written in JavaScript" and that larger Workers take longer to start ([Wasm docs](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)).
- **Lambda:** 128–10,240 MB memory. CPU scales with memory, and 1,769 MB equals one vCPU ([memory docs](https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html)). At 128 MB a function gets roughly 7% of a vCPU, which slows CPU-heavy init work such as JVM class loading.
- **Cloud Run:** minimum memory is 128 MiB on the first-generation execution environment and 512 MiB on the second. CPU below 1 vCPU caps memory (0.08 vCPU allows up to 512 MiB) ([memory limits](https://docs.cloud.google.com/run/docs/configuring/services/memory-limits)).

## 2. Cold-start and warm-request evidence

### 2a. Runtime floor: lambda-perf (hello-world, daily)

Source: [maxday/lambda-perf](https://github.com/maxday/lambda-perf), data file `data/2026-09-25.json` (generated 2026-09-25). Each run is a hello-world function invoked cold 10 times per day. It reports Lambda's `Init Duration` and max memory used. zip packages, 128 MB unless noted.

| Runtime | Arch | Avg init (ms) | Min–max (ms) | Max memory used (MB) | First-invoke duration (ms) |
|---|---|---|---|---|---|
| Rust (`provided.al2023`) | x86_64 | 34.5 | 21.6–89.3 | 18 | 1.4 |
| Rust (`provided.al2023`) | arm64 | 47.0 | 17.5–89.9 | 18 | 1.4 |
| Go (`provided.al2023`) | arm64 | 63.3 | 41.5–107.5 | 21 | 1.6 |
| Go (`provided.al2023`) | x86_64 | 72.8 | 53.7–121.3 | 22 | 1.5 |
| LLRT (AWS low-latency JS, `provided.al2023`) | arm64 | 96.5 | 54.5–140.1 | 35 | 1.7 |
| Node.js 22 | arm64 | 116.6 | 100.0–137.2 | 73 | 10.6 |
| Node.js 24 | arm64 | 119.4 | 95.9–137.4 | 76 | 16.3 |
| Node.js 24 | x86_64 | 127.6 | 97.5–148.5 | 77 | 7.8 |
| GraalVM Java 21 native (`provided.al2023`) | arm64 | 131.0 | 88.8–206.3 | 36 | 147 (128 MB), 13 (1024 MB) |
| GraalVM Java 21 native | x86_64 | 169.7 | 126.2–231.6 | 37 | 154 |
| Java 25 (managed) | x86_64 | 180.7 | 153.0–206.9 | 87 | 297 (128 MB), 10 (1024 MB) |
| Java 21 (managed) | x86_64 | 232.4 | 196.1–282.0 | 93 | 90 (128 MB), 6 (1024 MB) |
| Bun (`provided.al2`) | x86_64 | 345.9 | 314.6–401.3 | 65 | 296 |

**Quality flags:**
- The function does nothing: no SDK, no TLS connection pool, no framework. The numbers are a lower bound for each runtime.
- `Init Duration` leaves out platform time (placement, code download) and the first handler run. For the JVM and for GraalVM at 128 MB, the first-invoke duration is large, so init alone understates their cold-start cost.
- The sample is small (10 per config per day). It's still an independent source, updated daily, with open code and data.
- It doesn't test SnapStart; the author considers that meaningless for hello-world.

### 2b. Realistic app: AWS's multi-language serverless samples (API Gateway → Lambda → DynamoDB)

AWS published the same "products" CRUD app (API Gateway, four Lambda functions, one DynamoDB table) in several languages. Each was load-tested with Artillery at 300 req/s for 10 min. Duration = `initDuration + duration` from CloudWatch Logs Insights.

| Language (sample) | Config | Warm p50 / p90 / p99 (ms) | Cold p50 / p99 (ms) | Cold starts / total |
|---|---|---|---|---|
| Rust ([serverless-rust-demo](https://github.com/aws-samples/serverless-rust-demo)) | 128 MB arm64, `provided.al2023` per current template | 5.13 / 13.29 / 20.09 | 122.8 / 145.8 | 106 / 468,696 |
| Go ([serverless-go-demo](https://github.com/aws-samples/serverless-go-demo)) | 128 MB arm64 (README) | 5.47 / 9.23 / 17.69 | 458.9 / 521.6 | 272 / 468,404 |
| Java, GraalVM native ([serverless-graalvm-demo](https://github.com/aws-samples/serverless-graalvm-demo)) | custom runtime | 5.29 / 7.63 / 19.46 | 542.9 / 577.6 | 1,316 / 314,242 |
| TypeScript ([serverless-typescript-demo](https://github.com/aws-samples/serverless-typescript-demo)) | Node.js 14/16 era, 256 MB in current stack, esbuild, Powertools | 6.61 / 15.09 / 41.03 | 690.8 / 866.9 | 48 / 1,822,488 |

Java frameworks on the managed runtime, from AWS's [serverless-java-frameworks-samples](https://github.com/aws-samples/serverless-java-frameworks-samples) (100 req/s for 10 min):

| Mode | Framework | Cold p50 / p99 (ms) | Warm p50 / p99 (ms) |
|---|---|---|---|
| Managed JVM | Quarkus | 2,525 / 4,055 | 7.5 / 29.9 |
| Managed JVM | Spring Boot | 5,311 / 6,183 | 8.1 / 30.0 |
| SnapStart | Quarkus | 487 / 732 | 7.4 / 25.2 |
| SnapStart | Spring Boot | 1,047 / 1,597 | 7.6 / 27.7 |
| GraalVM native | Quarkus | 467 / 802 | 6.7 / 24.0 |
| GraalVM native | Spring Boot | 620 / 721 | 9.1 / 23.6 |

**Quality flags:**
- These are vendor sample apps. The results are single runs shown as screenshots.
- Runtime versions differ and some are old. The TS results are from the Node 14/16 era. The Go numbers likely predate the `go1.x` deprecation.
- Memory differs too: the TS sample is 256 MB, the others 128 MB. The fetched Java-frameworks README doesn't state its memory.
- The warm numbers are handler time only. They exclude API Gateway and client network time.
- The app shape (DynamoDB get or put behind HTTP) is close to a Redirect lookup, so this is the most Redirect-relevant comparison found.

### 2c. Cloudflare Workers

- V8 isolates warm a Worker "in under 5 milliseconds". Cloudflare starts loading the Worker when the TLS ClientHello arrives, so for small scripts the cold start is hidden in the handshake ([Cloudflare blog, 2020-07-30](https://blog.cloudflare.com/eliminating-cold-starts-with-cloudflare-workers/)).
- The 2025 follow-up says larger scripts, a 400 ms startup-CPU budget and TLS 1.3's single round trip mean "cold starts for complex applications began to lose the TLS handshake race". Sharding traffic raised the enterprise warm-request rate from 99.9% to 99.99% ([Cloudflare blog, 2025-09-26](https://blog.cloudflare.com/eliminating-cold-starts-2-shard-and-conquer/)).
- A Rust or Go Wasm Worker is a larger bundle than the equivalent JS, and bundle size drives startup time ([Wasm docs](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)). An older third-party report ([nickb.dev, 2021](https://nickb.dev/blog/reality-check-for-cloudflare-wasm-workers-and-rust/); dated, pre-dates current limits) hit the then-1 MB gzip bundle cap. It also noted that Wasm has to copy data across the JS↔Wasm memory boundary. For a Redirect, the work is mostly calling JS-host APIs (KV, fetch, Cache), so each call crosses that boundary and Wasm has little CPU-bound work to speed up.
- No reputable published benchmark was found comparing JS and Rust-Wasm Workers on an I/O-bound handler. Vendor and third-party blog claims of "0–5 ms Wasm cold starts, 2–10× faster" are for CPU-heavy work, unsourced, and not relied on here.

### 2d. Cloud Run and Fly.io

- **Cloud Run** startup = pull the container image + run the entrypoint + wait for the port to listen. Google recommends startup CPU boost and min instances to cut cold starts ([general tips](https://docs.cloud.google.com/run/docs/tips/general)). No first-party per-language cold-start numbers exist. Relative differences follow the same runtime-floor ordering as §2a, plus image size (static Rust/Go binaries in distroless or scratch images are smallest). One instance serves up to 80 concurrent requests by default, so cold starts are rarer per request than on Lambda's one-request-per-environment model.
- **Fly.io** Machines are Firecracker microVMs. Autostop/autostart can stop or suspend idle Machines ([autostop](https://docs.fly.io/reference/fly-proxy-autostop-autostart/)). Resume from suspend takes "hundreds of milliseconds instead of multiple seconds" and falls back to a full cold start if the snapshot can't be restored ([suspend/resume](https://fly.io/docs/reference/suspend-resume/)). With an always-on Machine there is no cold start in any language.
- **Benchmark to ignore for this decision:** TechEmpower Framework Benchmarks. Round 23 (Feb 2025) is dominated at the top by Rust, C/C++, Java and C# frameworks, with Go close behind and mainstream Node.js well below. But it runs on bare-metal 56-core servers with 40 Gbps networking and measures maximum throughput, not serverless latency. The project's repository was archived in 2026 ([R23 blog](https://www.techempower.com/blog/2025/03/17/framework-benchmarks-round-23/), [repo](https://github.com/TechEmpower/FrameworkBenchmarks)). It matters only if the service ends up on long-running, CPU-saturated instances.

## 3. Memory footprint and cost

| Platform | Billing driver | Effect of language |
|---|---|---|
| **Workers** | $5/mo Paid includes 10M requests and 30M CPU-ms; then $0.30/M requests and $0.02/M CPU-ms. **No charge for wall time or memory.** Free plan: 100k requests/day, 10 ms CPU per request ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | Waiting on KV or fetch isn't billed. A Redirect uses about 1 ms of CPU or less, which costs about $0.02 per million, against $0.30 per million in request fees. A faster language saves CPU-ms, but the request fee dominates. Everything must fit in 128 MB per isolate. |
| **Lambda** | $0.20/M requests + $0.0000166667/GB-s on x86 (Arm is about 20% cheaper). 1 ms granularity. Free tier: 1M requests + 400k GB-s/month ([pricing](https://aws.amazon.com/lambda/pricing/)). Since 2025-08-01, INIT time is billed for managed runtimes too ([AWS blog](https://aws.amazon.com/blogs/compute/aws-lambda-standardizes-billing-for-init-phase/)) | Worked example: 5 ms warm at 128 MB = 625 GB-s per million ≈ $0.01/M. The same 5 ms at 1,024 MB, a common JVM setting, = 5,000 GB-s ≈ $0.08/M. Both are well under the $0.20/M request fee. Measured resident memory: Rust ~18 MB, Go ~21 MB, GraalVM native ~36 MB, Node ~75 MB, HotSpot Java ~90 MB (§2a). Every language fits in 128 MB, but JVM and GraalVM run slowly at 128 MB because CPU scales with memory. SnapStart costs nothing extra on Java (Python and .NET pay cache and restore fees) ([SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)). Lambda@Edge costs $0.60/M requests + $0.00000625125 per 128 MB-s. |
| **Cloud Run** | Request-based billing: $0.000024/vCPU-s, $0.0000025/GiB-s, $0.40/M requests. Instance time is rounded up to 100 ms. Free tier: 2M requests, 180k vCPU-s, 360k GiB-s per month. Min instances are billed while idle ([pricing](https://cloud.google.com/run/pricing)) | Concurrent requests share one instance's billed time, so per-request compute is small. Memory sets the instance size: 128–256 MiB is plenty for Rust, Go and Node, while a HotSpot JVM with a framework usually needs ≥512 MiB, which also means second-generation environment minimums. Keeping a warm min instance to avoid JVM cold starts adds a fixed monthly cost. |
| **Fly.io** | Per-second billing. Shared CPU $0.00000075/s (≈ $1.94/mo for shared-cpu-1x with 256 MB); extra RAM $0.00000193/GB-s (≈ $1.25/mo per extra 256 MB). Stopped Machines pay only rootfs storage at $0.15/GB-month. Dedicated IPv4 $2/mo. Credit card required; no free allowance is documented ([pricing](https://docs.fly.io/about/pricing/)) | Fixed cost per always-on Machine: 256 MB ≈ $1.94/mo, 512 MB ≈ $3.19/mo, 1 GB ≈ $6.94/mo (iad, computed from the listed rates). Rust, Go and Node fit in 256 MB; a JVM usually pushes you to 512 MB–1 GB. |

Against the ≤$20/mo budget, language changes cost materially only on instance-billed platforms (Cloud Run min instances, Fly.io), and only through memory sizing. On Workers and Lambda, request fees dominate.

## 4. Does a faster language change end-to-end Redirect latency?

A Redirect's end-to-end latency = Visitor ↔ edge RTT + (on a cache miss) edge ↔ compute + compute ↔ cache/datastore + handler CPU.

- **Handler CPU is small in every language.** Warm hello-world durations are 1–2 ms for Rust, Go and LLRT, and single-digit to low-double-digit ms for Node and JVM on first invoke (§2a). With a DynamoDB call included, warm p50 lands within 1.5 ms across Rust, Go, GraalVM and TS (§2b), because the network round trip dominates.
- **The tail and cold starts are where language shows.** Warm p99 was about 18–20 ms for Rust, Go and GraalVM vs 41 ms for TS in the AWS samples. Cold p50 ranged from 123 ms (Rust) to 459 ms (Go, older runtime), 543 ms (GraalVM), 691 ms (TS), and 2.5–5 s for managed-JVM frameworks without SnapStart. Against a ~200 ms target, a Rust cold start fits inside the budget. Node, GraalVM and SnapStart-JVM cold starts roughly use up the budget or exceed it. A plain managed-JVM framework cold start is 10–25× the budget. How often cold starts happen depends on traffic and topology (per-request environments on Lambda vs 80-way concurrency on Cloud Run vs near-zero on Workers), not on language.
- **CDN-cached Redirects skip compute entirely.** Cloudflare's [Workers Cache](https://blog.cloudflare.com/workers-cache/) (GA 2026-07-06, all plans) is a two-tier cache that serves hits without running the Worker ("your Worker doesn't run at all"). Hits still pay the request fee but no CPU. Cloudflare's CDN caches 302s for 20 min by default when no `Cache-Control` is sent ([status-code TTLs](https://developers.cloudflare.com/cache/how-to/configure-cache-status-code/)). CloudFront caches GET responses under the cache policy. On those hits, language has no effect on latency or cost. The caching policy itself (TTL vs Expiry, purge on delete) is out of scope here and listed under "Not yet specified" on the map.

## 5. Library and SDK maturity for likely datastore and cache clients

| Client | TypeScript | Rust | Go | JVM |
|---|---|---|---|---|
| **DynamoDB (AWS SDK)** | v3, GA | GA since 2023-11-28 ([announcement](https://aws.amazon.com/blogs/developer/announcing-general-availability-of-the-aws-sdk-for-rust/)) | v2, GA | v2, GA |
| **Firestore (data plane)** | Official, GA | **Not implemented** in the official `google-cloud-rust` as of the Aug 2026 update; only admin APIs ([status discussion](https://github.com/googleapis/google-cloud-rust/discussions/2707)); community crates only | Official, GA | Official, GA |
| **Spanner** | Official, GA | Official, **preview** ([same discussion](https://github.com/googleapis/google-cloud-rust/discussions/2707)) | Official, GA | Official, GA |
| **Bigtable (data plane)** | Official, GA | Not implemented (official) | Official, GA | Official, GA |
| **Cloud Storage / Pub/Sub** | GA | GA | GA | GA |
| **Workers KV / D1 / Durable Objects** | Native bindings (first-class) | `workers-rs`: KV and Durable Objects supported; D1 **alpha**; Queues beta | `workers-go`: KV, D1, Cache, R2, Durable Objects, but the whole project is experimental | N/A |
| **Redis (TCP)** | `node-redis` (Redis-maintained), `ioredis` | `redis-rs` (community) | `go-redis` (Redis-maintained) | Jedis and Lettuce (Redis-maintained / widely used) |
| **Upstash Redis HTTP SDK** (for serverless/edge) | Official `@upstash/redis` | No official SDK (TCP clients work) | No official SDK (TCP clients work) | No official SDK (TCP clients work) |
| **Lambda runtime/tooling** | Managed; Powertools | AWS `aws-lambda-rust-runtime`; Cargo Lambda (third-party) | `aws-lambda-go` | Managed; SnapStart; GraalVM via custom runtime |

Sources: [Lambda Rust docs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-rust.html); [Google Cloud Rust reference](https://docs.cloud.google.com/rust/docs/reference); [workers-rs](https://github.com/cloudflare/workers-rs); [workers-go](https://github.com/syumai/workers-go); [Upstash SDK overview](https://upstash.com/docs/redis/sdks/overview).

## 6. Trade-offs by platform (facts, no pick)

- **Cloudflare Workers:** TS is the only first-class option. Rust-Wasm works for KV and Durable Objects, with rough edges and a larger bundle. Go is experimental. The JVM is ruled out unless a Container is added behind the Worker. The platform nearly eliminates cold starts, and billing ignores I/O wait. So a faster language buys the least here in latency, and only CPU-ms in cost.
- **AWS Lambda (regional):** all four languages are supported. Rust has the lowest cold start and memory; Go is close. Node's cold start is about 3× Rust's. Managed-JVM frameworks need SnapStart or GraalVM native to get near the 200 ms budget on a cold path. Warm DynamoDB latency is nearly identical across languages.
- **Lambda@Edge:** Node.js (or Python) only, so the language question is settled if this topology is picked. CloudFront Functions is JS only and too small to hold the Link table.
- **GCP Cloud Run:** all four languages are supported. The language shows up in image size and cold start, and in memory sizing. The JVM needs ≥512 MiB and likely a min instance. The official Rust SDK lacks a Firestore data-plane client, and its Spanner client is only in preview.
- **Fly.io:** all four languages are supported. Always-on Machines have no cold starts. Memory sets the monthly price: about $1.94 at 256 MB vs $3.19–$6.94 at 512 MB–1 GB per Machine. The datastore client depends on the datastore chosen.
