---
status: accepted
---

> Amended by [ADR 0009](./0009-idempotent-link-creation-by-key-derived-short-codes.md): a create that carries an `Idempotency-Key` derives its generated Short code from SHA-256 of the Creator ID, the key and an attempt number, instead of drawing it from a CSPRNG. Uniqueness still rests only on the claim.
>
> Amended by [ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md): a Short code is unique, and never reissued, within its Namespace rather than the whole deployment. The reserved-alias list applies unchanged in every Namespace.
>
> Amended by [ADR 0018](./0018-hash-the-case-folded-short-code-keep-aliases-case-sensitive-reserve-case-insensitive-mode.md): Custom aliases and generated Short codes stay case-sensitive, but the shard number now hashes the case-folded Short code, and a future opt-in case-insensitive mode is reserved: it would lowercase such aliases at creation and refuse any new Short code whose folded form already exists.
>
> Amended by [ADR 0023](./0023-take-abuse-reports-at-abuse-alert-at-the-daily-cap-and-suspend-past-a-daily-ceiling.md): the plain-text bodies of the apex's 404 and 410 answers name the deployment's abuse address and the URL of its abuse policy. The apex gains no route.
>
> Amended by [ADR 0024](./0024-state-what-each-credential-can-do-gate-operator-methods-and-move-auth-writes-into-links-data.md): non-enumerability holds against Visitors and Creators only. The `production` and `production-plan` credentials can list every Short code, Target URL and Creator ID in `LINKS`.

> Amended in place by [Amend the PRD and ADRs with the re-chart's decisions and the no-decision amendments](https://github.com/andrewferk/url-shortener/issues/60): `.`, `/` and `+` are permanently excluded from Short codes and Custom aliases, because future routes depend on it.

# Generate Short codes at random and rely on the shard's conditional claim, not a counter and bijection

The original sketch generated Short codes from an incrementing counter passed through a keyed bijection, with a hash of the Target URL as a fallback. We don't do that. A generated Short code is 7 base62 characters drawn from a CSPRNG and proposed to `LinkRegistry.claim`, the atomic insert-if-absent on the owning Durable Object shard ([ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)). If the claim fails, the caller draws again. Custom aliases need that same claim anyway to guard the shared namespace, so random generation adds no machinery. A counter would add a strongly consistent counter, a leasing protocol, and a permanent secret key, and would still have to pass through the claim.

Decided in [How are Short codes generated?](https://github.com/andrewferk/url-shortener/issues/5).

## Decision

- **Generated Short codes:** a fixed 7 characters of base62 from a CSPRNG. They are case-sensitive and never grow in length. At 1B Links, a claim collides about 0.03% of the time, so the retry budget is small and bounded. Random codes also spread evenly across the 256 shards.
- **Non-enumerable by construction:** there's no counter to walk and no key to leak or rotate. Density at 1B Links is about 1 live Link per 3,500 random guesses. Rate limiting on Redirects handles guessing; generation doesn't try to.
- **No hash-of-Target-URL fallback, and no dedupe:** every create makes a new Link, even for a Target URL that's already been shortened.
- **Custom aliases:** 3–32 characters from `[A-Za-z0-9_-]`, matched exactly and case-sensitively like generated codes. An alias may have any shape, including 7-character base62. The claim is the only collision guard in either direction.
- **`.`, `/` and `+` are permanently excluded** from Short codes and Custom aliases. The alphabet above already leaves them out; this makes it a rule that can't be relaxed. Future routes on the Short domain depend on it: QR codes, preview pages (`<code>+`), `robots.txt` and `.well-known` files. None is built, and none could be added if a Link might own such a path.
- **Reserved aliases:** a fixed list (`api`, `status`, `admin`, `health`, `login`, `www`), rejected case-insensitively. The list stays tiny because the short domain serves only Redirects. The Link creation API and the Status page live on their own subdomains, so no future route can clash with a Short code.
- **No word filter** on generated codes.
- **Never reissued:** deleting a Link or letting it expire leaves its claimed row in place, so a later claim for the same Short code fails.

## Considered options

- **Counter + keyed bijection** (Feistel/FPE with cycle-walking, or multiplicative inverse mod 62ⁿ), coordinated by leasing blocks from a counter Durable Object or per shard. It never collides, but it needs a counter home and a lease protocol. Its secret key is permanent: a leaked key makes codes invertible and walkable, and a rotated key can collide with codes already issued. It still needs the claim to guard against Custom aliases.
- **Length that grows with the counter** (5 → 6 → 7). Early codes would sit in a nearly full 5-character space, where almost any guess hits a Link, and it only works with a counter.
- **6 characters.** Enough space for 1B Links, but a random guess hits a live Link 1 time in 57.
- **Custom aliases in a shape disjoint from generated codes.** Not needed, because the claim already guards the shared namespace.

## Consequences

- **Uniqueness depends entirely on the claim.** Any future generator, or any bulk import, has to go through `LinkRegistry.claim`, just as ADR 0001 requires.
- **Changing the generated length later is cheap** (new codes only). The alias rules, the excluded characters and the reserved list are public contract once Creators rely on them.
