---
status: accepted
---

> Amended by [ADR 0018](./0018-hash-the-case-folded-short-code-keep-aliases-case-sensitive-reserve-case-insensitive-mode.md): the shard number hashes `<Namespace ID>:<fold(Short code)>`, lowercasing the Short code first. Every other use of the Short code in this encoding keeps the exact form.
>
> Amended by [ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md): the Redirect event's index is `<Namespace ID>:<source>:<outcome>`, not `<Namespace ID>:<Short code>`. The Short code is a blob, and the `namespace` blob stays.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): the Redirect event index line follows ADR 0020.

# Identify every Link by an opaque Namespace plus its Short code, so one deployment can serve many Short domains

[ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md) makes the shard hash and the `LINKS` key format permanent. As decided there, they held only the Short code, so a deployment had one Short code space forever. The project is headed for open source, embedding, and possibly a SaaS in which customers bring their own Short domains. With one space, one customer's `acme.co/sale` would block every other customer's `/sale`, and adding scoping later would mean moving every Link.

Nothing is built yet, so Link identity carries a **Namespace** from day one: every Link is identified by `(Namespace, Short code)`. A Namespace has an opaque ID, and each Short domain maps to exactly one Namespace. A deployment starts with a single default Namespace, so a self-hosted deployment behaves exactly as before. Building multi-tenancy or onboarding customers' domains is not part of this decision. It only stops the data model from foreclosing either.

Decided in [Does Link identity carry a namespace so one deployment can serve many domains?](https://github.com/andrewferk/url-shortener/issues/31).

## Decision

### The Namespace

- **A Short code is unique within its Namespace,** and never reissued there ([ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)'s rule, now per Namespace). The same Short code may exist in two Namespaces as two unrelated Links.
- **Namespace IDs are opaque.**
  - The default Namespace is `default` in every deployment. It needs no bootstrap step and adds no deployment value to config ([ADR 0013](./0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md)).
  - Any later Namespace is `ns_` plus 10 base62 characters, minted like Creator IDs.
  - A Namespace ID never contains `:` or `/`. Neither does a Short code, so every key below parses unambiguously.
- **Short domains map to Namespaces.**
  - Each Short domain maps to exactly one Namespace.
  - The model allows a Namespace to be served on several Short domains. Each Namespace names one primary Short domain, which `short_url` is built from.
  - A deployment today maps its `base_domain` to `default`, and serves nothing else.

### Resolving a Redirect

- **The domain core has a `NamespaceResolver` port** that maps a request's hostname to a Namespace.
  - Today's adapter is static Worker config, rendered like every other deployment input ([ADR 0007](./0007-opentofu-wrangler-split-links-data-worker-account-isolation.md)).
  - A later adapter, for example a KV lookup cached per isolate, can serve many Short domains without changing the core.
- **An unmapped hostname answers 404** with the `malformed` outcome, before any lookup, like a path that can't be a Short code ([ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)).

### Encoding

This encoding is as permanent as ADR 0008's hash, which it replaces.

- **Shard number:** the first byte of SHA-256 over the UTF-8 bytes of `<Namespace ID>:<Short code>`, 0–255.
  - Hashing the Namespace in spreads one Namespace's Custom aliases across all 256 shards.
  - Shard object names stay `shard-<n>`.
- **The shard's `links` table** gains `namespace TEXT NOT NULL`. Its primary key is `(namespace, short_code)`.
- **The outbox's** primary key is `(namespace, short_code, destination)`.
- **`LINKS` keys** are `<shard as 2 lowercase hex digits>:<Namespace ID>:<Short code>`, for example `07:default:Ab3xYz9`. A per-shard prefix list still finds every key a shard owns, so the reconcile is unchanged. `LINKS` values don't repeat the Namespace, because it's in the key.
- **ADR 0006's per-colo cache key** is derived from the `LINKS` key.
- **Change-log entries** carry `namespace`. Log objects, compactions and snapshots are sorted by `(namespace, short_code)`, which is the shard's primary-key order.
- **The domain core owns this function,** pinned by test vectors.

### Creators and the Link API

- **A Creator is bound to exactly one Namespace** when it is admitted.
  - `creator:<id>` in `AUTH` records it.
  - `creators add` takes `--namespace`, defaulting to `default`.
  - A Creator creates, reads, lists and deletes only in its own Namespace.
- **The Link API doesn't change.**
  - `/v1/links/{shortCode}` is resolved inside the caller's Namespace, so it stays unambiguous.
  - `short_url` is built from the Namespace's primary Short domain.
  - The rule against self-referencing Target URLs covers every mapped Short domain and its subdomains, not only `base_domain`.
- **The Creator list** stays keyed by `(created_at, short_code)`: a Creator's Links all share one Namespace.
- **ADR 0009's key-derived Short codes** don't change. The Creator ID already implies the Namespace, and the candidate is claimed at `(Creator's Namespace, candidate)`.

### Operator operations

- **ADR 0010's operations address a Link by Short URL** (`https://acme.co/sale`), which is resolved through the same mapping. `--namespace` plus a Short code is also accepted.
- **Anything an operation prints or reads back as a list** (`links find`, `ops review --claim-only`) uses Short URLs or `<Namespace ID>:<Short code>`.

### Redirect events

- **The index** is `<Namespace ID>:<Short code>`, the Link's full identity, and what future click analytics would key on. ([ADR 0020](./0020-index-redirect-events-by-namespace-source-and-outcome-and-heal-rollup-gaps.md) changed the index to `<Namespace ID>:<source>:<outcome>`, and per-Link analytics gets its own dataset.)
- **A new `namespace` blob** makes per-Namespace volume queryable later.
- **The Status page and the Objectives stay deployment-wide** ([ADR 0003](./0003-status-page-from-redirect-events-and-external-probes.md), [ADR 0011](./0011-objectives-error-budgets-and-email-alerts.md)).

### What stays deployment-wide

- **ADR 0004's edge flood ceiling and daily cost brake.** They protect the Operator's zone and bill, not a Namespace.
- **The Creator burst limit and daily cap,** which stay per Creator.
- **ADR 0002's reserved-alias list:** the same fixed list in every Namespace.
- **The Canary link,** which lives in `default`.
- **ADR 0013's dedicated zone per Short domain.** Serving customers' domains as Cloudflare for SaaS custom hostnames on the Operator's zone would be a later SaaS decision. Host-based resolution doesn't foreclose it.

## Cost

**Today:** $0.

**Peak** (1B Links): `default:` adds 8 bytes to every `LINKS` key, about 8 GB, or ≈$4/mo of KV storage. The shard, the log and the per-colo cache grow by a similar, negligible amount.

## Considered options

- **One Short code space per deployment** (ADR 0008 as decided). A SaaS on it would share one space across every customer's Short domain. Adding Namespaces later would mean re-hashing and re-keying every Link in the shards, KV, the change log and the Creator lists.
- **Namespaces keyed on the Short domain string.** No mapping would be needed, but every Link would be welded to one hostname: a Namespace could never be served on a second or replacement domain. It would also bake a deployment value into every key.
- **Reserving the encoding only:** keeping `hash(code)` and `<shard>:<code>` for the default Namespace, and defining a prefixed form for later ones. It's free today, but it needs two encodings forever. SQLite can't change a primary key additively, so later Namespaces would need a second table or would have to smuggle `ns/code` into `short_code`.
- **A separate set of 256 shards per Namespace.** It leaves the row schema alone, but compaction, reconciles and restores all walk shards. They would multiply by the number of Namespaces, and a small Namespace would get 256 near-empty shards.
- **Creators choosing a Namespace per request.** Reads and deletes would need `/v1/links/{namespace}/{shortCode}` or an opaque Link ID. The Creator list's key and ADR 0009's derivation would both gain the Namespace. Binding a Creator to one Namespace keeps all three as decided, and a per-request choice can still be added later: an optional field on create, plus a new path form.

## Consequences

- **Amends ADR 0002:** Short codes are unique, and never reissued, per Namespace. The reserved list applies in every Namespace.
- **Amends ADR 0008:** the shard hash input, the shard and outbox primary keys, the `LINKS` key format and the change log's sort order all include the Namespace. These are just as permanent.
- **Amends ADRs 0003, 0005, 0006, 0010 and 0013** as described above.
- **A Namespace outlives its Short domains.** Serving a Namespace on a second domain is possible later without moving Links. A domain that has been shared still can't be dropped without breaking its Short URLs, so ADR 0013's advice stands.
- **A SaaS tenant with several Namespaces needs a Creator per Namespace** until a per-request choice is added.
- **Nothing creates, lists or deletes Namespaces yet.** The only Namespace is `default`, and the mapping is static config. Managing Namespaces belongs to whoever builds multi-tenancy.
