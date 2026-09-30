---
status: accepted
---

> Amended by [ADR 0009](./0009-idempotent-link-creation-by-key-derived-short-codes.md): a create that carries an `Idempotency-Key` derives its generated Short code from SHA-256 of the Creator ID, the key and an attempt number, instead of drawing it from a CSPRNG. Uniqueness still rests only on the claim.

# Generate Short codes at random and rely on the shard's conditional claim, not a counter and bijection

The original sketch generated Short codes from an incrementing counter passed through a keyed bijection, with a hash of the Target URL as a fallback. We don't do that. A generated Short code is 7 base62 characters drawn from a CSPRNG and proposed to `LinkRegistry.claim`, the atomic insert-if-absent on the owning Durable Object shard ([ADR 0001](./0001-cloudflare-workers-typescript-durable-objects-kv.md)). If the claim fails, the caller draws again. Custom aliases need that same claim anyway to guard the shared namespace, so random generation adds no machinery. A counter would add a strongly consistent counter, a leasing protocol, and a permanent secret key, and would still have to pass through the claim.

Decided in [How are Short codes generated?](https://github.com/andrewferk/url-shortener/issues/5).

## Decision

- **Generated Short codes:** a fixed 7 characters of base62 from a CSPRNG. They are case-sensitive and never grow in length. At 1B Links, a claim collides about 0.03% of the time, so the retry budget is small and bounded. Random codes also spread evenly across the 256 shards.
- **Non-enumerable by construction:** there's no counter to walk and no key to leak or rotate. Density at 1B Links is about 1 live Link per 3,500 random guesses. Rate limiting on Redirects handles guessing; generation doesn't try to.
- **No hash-of-Target-URL fallback, and no dedupe:** every create makes a new Link, even for a Target URL that's already been shortened.
- **Custom aliases:** 3–32 characters from `[A-Za-z0-9_-]`, matched exactly and case-sensitively like generated codes. An alias may have any shape, including 7-character base62. The claim is the only collision guard in either direction.
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
- **Changing the generated length later is cheap** (new codes only). The alias rules and the reserved list are public contract once Creators rely on them.
