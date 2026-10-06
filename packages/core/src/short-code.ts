/**
 * The base62 digits in value order: 0–9, then A–Z, then a–z. ADR 0009's key
 * derivation encodes with this order, so it is as permanent as the derivation.
 */
export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A generated Short code is always exactly 7 base62 characters (ADR 0002). */
export const GENERATED_LENGTH = 7;

/**
 * Aliases no Creator may claim, in any case (ADRs 0002, 0018). The same fixed
 * list applies in every Namespace (ADR 0014).
 */
export const RESERVED_ALIASES: readonly string[] = ["api", "status", "admin", "health", "login", "www"];

const GENERATED_SHAPE = /^[0-9A-Za-z]{7}$/;

// Letters, digits, `-` and `_` only. `.`, `/` and `+` are permanently excluded
// from every Short code, because future routes on the Short domain depend on
// it (ADR 0002). This rule can't be relaxed.
const ALIAS_CHARACTERS = /^[0-9A-Za-z_-]*$/;
const ALIAS_MIN_LENGTH = 3;
const ALIAS_MAX_LENGTH = 32;

export type CustomAliasValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "length" | "characters" | "reserved" };

/** A Custom alias is 3–32 characters of `[A-Za-z0-9_-]`, and not reserved. */
export function validateCustomAlias(alias: string): CustomAliasValidation {
  if (alias.length < ALIAS_MIN_LENGTH || alias.length > ALIAS_MAX_LENGTH) return { valid: false, reason: "length" };
  if (!ALIAS_CHARACTERS.test(alias)) return { valid: false, reason: "characters" };
  if (RESERVED_ALIASES.includes(alias.toLowerCase())) return { valid: false, reason: "reserved" };
  return { valid: true };
}

/**
 * The malformed-shape check (ADR 0004): whether a requested path could be a
 * Short code at all. It passes only 7 base62 characters, or a valid, unreserved
 * Custom alias, so a malformed path never costs a lookup.
 */
export function isPossibleShortCode(candidate: string): boolean {
  return GENERATED_SHAPE.test(candidate) || validateCustomAlias(candidate).valid;
}
