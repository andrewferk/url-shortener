---
status: accepted
---

> Amended by [ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md): a keyed create that finds its own earlier attempt already deleted compares the request's Target URL against the row's `target_url_sha256`, since the row no longer holds the URL.

> Amended in place by [Bring older ADRs, the glossary and the PRD in line with their amendments](https://github.com/andrewferk/url-shortener/issues/75): "the `Idempotency-Key` is stored but never logged" is stated here. The PRD's "never logged" rule read as if nothing kept the key.

> Amended by [ADR 0028](./0028-void-a-forged-or-mistaken-delete-and-never-lose-a-delete-in-a-restore.md): a keyed create whose own earlier attempt is now a Deleted link answers `201` with the Link as it is now, `state: deleted` and no `target_url`.

# Make Link creation idempotent by deriving the Short code from the client's Idempotency-Key

A retried `POST /v1/links` would draw a new random Short code ([ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md)). The new code usually lands on a different shard, so a lost response turns into a second, orphaned Link. An idempotency record can't live in the shard that claims the Link, because the retry doesn't know which shard that is ([ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md)). The Creator's Durable Object is kept off the create path ([ADR 0004](./0004-abuse-protection-edge-ceiling-worker-limits-cost-brake.md)). So we don't store the key anywhere separate. When a request carries an `Idempotency-Key`, the Short code is **derived from the key** instead of drawn at random. A retry then recomputes the same code, reaches the same shard, and finds its own row. The existing atomic claim is the only coordination.

Decided in [What does the Link API on api. look like?](https://github.com/andrewferk/url-shortener/issues/21).

## Decision

- **The header is optional.** The client (the Creator's script, app or CI job) generates one random value per Link it intends to create and resends it on every retry of that create. Keys are 16–64 characters of `[A-Za-z0-9_-]`, and a UUIDv4 is the documented choice.
  - Without a key, creation works exactly as ADR 0002 says. A retry can mint a second Link, which costs one Short code and one unit of the daily cap.
  - CI's operations Creator always sends a key.
- **Candidate *n*** (0, 1, 2, …) for a keyed create with a generated Short code:
  - `h = SHA-256(creator_id + ":" + key + ":" + n)`, using decimal *n* and UTF-8.
  - Read the first 8 bytes of `h` as a big-endian unsigned integer, reduce it mod 62⁷, and base62-encode it, zero-padded to 7 characters. The modulo bias is about 10⁻⁷.
  - The domain core owns this function, pinned by test vectors, just like the shard hash.
- **The shard row gains `idempotency_key TEXT`,** NULL for unkeyed creates. It's an additive migration, and it rides the change log like every other column. It isn't copied to `LINKS` or to the Creator list.
- **The `Idempotency-Key` is stored but never logged.** The shard row and the change log hold it, because that is how a retry is recognised. No Worker log line, Redirect event, audit record, Workflow parameter or CI log holds one.
- **Claiming a keyed create** walks the candidates in order:
  - **The claim succeeds:** a new Link, answered `201`.
  - **The row belongs to this Creator and has this key:** it's an earlier attempt of the same create. It's replayed as `201` with the Link as its body plus `Idempotent-Replayed: true` if the Target URL, Custom alias and Expiry match (after normalization: WHATWG `href`, Expiry truncated to the second). If they differ, it answers `422 idempotency_key_reused`.
    - **The body is the Link as it is now,** not a stored copy of the first response. If the earlier attempt has since been deleted, the Target URL is compared by hash (ADR 0019) and the replay answers `201` with `state: deleted` and no `target_url` ([ADR 0028](./0028-void-a-forged-or-mistaken-delete-and-never-lose-a-delete-in-a-restore.md)). The Link API docs tell clients to read `state` on a replay.
  - **Any other row:** a collision, so the walk moves to *n*+1.
  - **The walk gives up after 8 candidates** with `503 unavailable`. At 1B Links, that's about (3×10⁻⁴)⁸ likely.
- **A keyed create with a Custom alias** uses the alias as its only candidate. The key only tells "my earlier attempt" (replay) apart from "taken" (`409 alias_taken`).
- **Concurrent duplicates** race on the same candidate's atomic claim. One inserts, and the other sees the winner's row and replays it.
- **Replays are exempt from the daily cap.** While the Creator's cap flag is set, a keyed create still walks its candidates read-only and replays a match. Only if none matches does it answer `429 daily_cap_reached`. Otherwise, the client that made its 300th Link and lost the response would be refused a Link that exists. Replays still count toward the burst limit.
- **No expiry window.** A key is bound to its Link for as long as the row exists, which is forever.

## Considered options

- **No server-side idempotency.** The simplest option. A duplicate Link is cheap, but the client can't tell a duplicate happened, and a retried create silently burns Short codes and daily cap.
- **An idempotency record in a shard chosen by hashing `(creator_id, key)`,** separate from the Link's own shard. That's two extra Durable Object calls per keyed create (reserve, then record the code), plus a recovery path for a record left "pending" by a crash between them.
- **An idempotency record in the Creator's Durable Object.** It puts that object back on the create path, which ADR 0004 took it off.
- **An idempotency record in KV.** KV is eventually consistent for up to about 60 s, which is the exact window in which retries happen.
- **A required key.** Every create would be retry-safe, but every caller would need to mint a UUID, including a one-off `curl`. The failure it prevents (a spare Link) is cheap.
- **Keying the derivation with a server secret** (HMAC). It would keep codes unpredictable even for a Creator using weak keys, but it brings back the permanent secret ADR 0002 rejected.

## Consequences

- **Amends ADR 0002:** a keyed create's generated Short code is a hash of `(creator_id, key, n)`, not a CSPRNG draw. It is still 7 base62 characters, spread evenly across shards, and uniqueness still rests only on the claim.
- **Non-enumerability now depends on the key too.** Anyone who knows a Creator's ID *and* one of its keys could compute that Link's code. Creator IDs never appear in the Link API, and the docs require random keys. A Creator that sends predictable keys weakens only its own Links.
- **The derivation is permanent.** Changing it would break replay for keys already used, so it's as fixed as the shard hash.
- **Key reuse is detected only when the codes coincide.** Reusing a key with a different Target URL or Expiry is caught (`422`). Reusing it with a different Custom alias just creates a second Link, because each alias is its own code.
- **A shard rebuilt from `LINKS` loses its `idempotency_key` values** (ADR 0008's last-minute case). A retry of one of those creates would then look like a collision and mint a new Link.
