---
status: accepted
---

> Amended by [ADR 0031](./0031-touch-shards-through-a-workflow-tag-links-data-with-its-bundle-hash-and-state-the-case-insensitive-limit.md): the reserved mode's limit is stated and accepted: a Link created before the mode is enabled stays case-sensitive for good and blocks its folded twins, deleting it doesn't free them, and there is no convert operation.

# Hash the case-folded Short code into the shard number, keep Custom aliases case-sensitive, and reserve an opt-in case-insensitive mode

[ADR 0002](./0002-random-short-codes-claimed-by-conditional-insert.md) makes Custom aliases case-sensitive, so `Sale` and `sale` are two Links. The PRD's [features review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5942436020) called that the one one-way door in the design: once real Creators hold mixed-case aliases, case-insensitive matching can never be added, and the [security review](https://github.com/andrewferk/url-shortener/issues/40#issuecomment-5942073170) noted that case-sensitive matching lets one Creator squat a confusable variant of another's alias in a shared Namespace. Both suggested lowercasing aliases at creation.

Aliases stay case-sensitive. The door is kept open differently: the shard number now hashes the case-folded Short code, so every case variant of a code lives on one shard, where a future claim can refuse variants atomically. A case-insensitive mode is reserved as an opt-in extension and is not built. Only the hash input changes, and it changes before any data is written.

Decided in [Are Custom aliases case-insensitive?](https://github.com/andrewferk/url-shortener/issues/49).

## Decision

### Case stays as ADR 0002 decided

- **Custom aliases and generated Short codes are case-sensitive,** matched exactly. An alias may have any shape, including 7-character base62. `Sale` and `sale` are two Links, and a Visitor who types the wrong case gets a 404.
- **Nothing is folded at creation.** The API stores and returns the alias the Creator sent. The reserved list is still rejected case-insensitively.
- **Confusable squatting is accepted** until the mode below exists. Creators are admitted by the Operator ([ADR 0005](./0005-creator-api-keys-and-github-oidc-for-ci.md)), and a Namespace ([ADR 0014](./0014-link-identity-carries-an-opaque-namespace.md)) bounds who can squat whom. Confusables other than case (`0`/`O`, `1`/`l`/`I`, `_`/`-`) are out of scope and are never folded.

### The shard number hashes the case-folded code

This replaces ADR 0014's hash input and is as permanent.

- **Shard number:** the first byte of SHA-256 over the UTF-8 bytes of `<Namespace ID>:<fold(Short code)>`, 0–255, where `fold` lowercases ASCII letters. Short codes are ASCII (`[A-Za-z0-9_-]`), so there is no other case to fold.
- **Everything else keeps the exact code:** the shard's `links` and outbox rows, `LINKS` keys (`07:default:Ab3xYz9`), the per-colo cache key, change-log entries and their sort order, Creator lists and the Redirect event index. Only the choice of shard folds.
- **Distribution stays uniform.** SHA-256 over the folded string spreads codes over 256 shards exactly as before. Folding only means `Ab3xYz9`, `ab3xyz9` and every other variant share a shard.
- **Operator operations by Short URL** ([ADR 0010](./0010-operator-operations-as-workflows-and-shard-freezes.md)) compute the shard from the folded code. The per-shard reconcile is unchanged, because it lists a `<shard>:<Namespace ID>:` prefix.
- **The domain core owns the function, pinned by test vectors** in slice 1.2, including at least one mixed-case code and its lowercase variant landing on the same shard.

### Open extension: case-insensitive aliases

Not built. It is written here so that slice 1.2 and everything after it don't foreclose it, and so the reviews' finding is answered where it was raised.

- **Granularity is undecided:** per deployment, per Namespace, or per alias. Whichever it is, the rules below hold wherever it is enabled.
- **Creation lowercases a case-insensitive alias** and stores the lowercase form.
- **No new conflict is allowed.** Once the mode is enabled, a claim for any Short code, Custom alias or generated, is refused if a Link whose folded form matches already exists on the shard, whatever that Link's own flag. A refused generated draw is redrawn, like any other collision; the extra collisions are negligible. A keyed create ([ADR 0009](./0009-idempotent-link-creation-by-key-derived-short-codes.md)) treats a folded match as "any other row" and moves to its next candidate.
- **The claim is check-then-insert on the folded form.** A Durable Object runs one transaction at a time, so the check and the insert are atomic without a unique index. That matters because of the next point.
- **Conflicts from before the mode are tolerated.** Links that were case variants of each other before enabling stay. No unique index is ever required over the folded column, because legacy duplicates would make it impossible to create.
- **The mode is complete only if it is enabled before Creators hold mixed-case aliases** ([ADR 0031](./0031-touch-shards-through-a-workflow-tag-links-data-with-its-bundle-hash-and-state-the-case-insensitive-limit.md)). A Link from before stays case-sensitive for good and blocks its folded twins: with `Sale` already a Link, no one can ever create a case-insensitive `sale`, and a Visitor who types `sale` gets a 404. Deleting `Sale` doesn't free `sale`, because the Deleted link's row still matches on the folded form. No operation converts an existing Link ([ADR 0019](./0019-links-are-immutable-and-deletion-erases-the-target-url.md)). This limit is accepted.
- **Redirect:** look up the exact path first; an exact match always wins. On a miss, look up the folded form, and serve it only if the Link found is case-insensitive. A legacy conflict is therefore served exactly as today.
- **Everything it needs is additive:** a nullable flag column and a folded-form index on the shard (lazy, additive migrations as in [ADR 0008](./0008-link-data-model-shards-kv-creator-lists-backups.md)), a bumped `LINKS` value version where an absent flag means case-sensitive, and an optional Link API field, which today answers `422 unknown_field`.

### When

Slice 1.2 ships the folded hash and its test vectors, before anything writes data. Prod can be wiped only until `v0.1.0`; after that, the hash input never changes.

## Cost

**Today and at peak:** $0. One `toLowerCase` before a hash that is already computed.

## Considered options

- **Lowercase Custom aliases at creation** (both reviews' suggestion). It closes the squatting hole and keeps nothing to decide later, but it makes case-insensitivity mandatory for every deployment, changes what the Creator sent, and still leaves a lowercase alias and a mixed-case generated code able to be case variants of each other across shards, which the claim can't prevent.
- **Reject aliases that aren't already lowercase.** The same namespace outcome with no silent change, and cheap to loosen later. Rejected for the same reason: every deployment would be forced into one rule.
- **A case-insensitive Short code space** (8 lowercase base36 generated codes, every lookup folded once). The cleanest end state, but it reopens ADR 0002's length, ADR 0009's derivation, the glossary and the PRD, and it is as much a one-way door as the current rule, in the other direction.
- **A Custom alias shape disjoint from generated codes** (no alias of exactly 7 characters of `[a-z0-9]`). It would stop a generated code from ever being a case variant of an alias without touching the hash, but it's only needed if the hash keeps the exact code, and it reverses ADR 0002's "any shape".
- **Keep the exact code in the hash.** It costs nothing now and still allows a future "exact wins, variants coexist" mode. It forecloses the rule chosen here, "no new conflict", because case variants would sit on different shards and no claim could refuse them atomically.
- **Fold on a Redirect miss today,** with nothing flagged. It would always answer 404 and cost a second lookup on every uppercase miss, for nothing.

## Consequences

- **Amends ADR 0002:** case rules are unchanged; the extension above is recorded, and lowercasing at creation is explicitly not the chosen answer to the reviews.
- **Amends ADR 0008 and ADR 0014:** the shard hash input is `<Namespace ID>:<fold(Short code)>`. The exact code is still what every row, key and log entry holds.
- **ADR 0009 is unchanged.** A replay compares the exact alias. A folded match is a collision like any other.
- **Grinding case variants onto one shard is now possible by construction:** every variant of one alias lands on the same shard. ADR 0008 already relies on Creator limits and the 10 GB ceiling to bound grinding, and a Creator may make only 300 Links a day.
- **The PRD's slice 1.2 line** ("the shard hash over `<Namespace ID>:<Short code>`") is amended through the closing ticket.
- **The future mode's granularity is a real decision for whoever builds it.** Per-alias is the most flexible and needs the per-Link flag; per-deployment or per-Namespace could fold every lookup once the mode is on. All three fit the rules above.
