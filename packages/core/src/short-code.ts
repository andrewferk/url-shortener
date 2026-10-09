// Reordering these digits changes every keyed Short code ever derived.
export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const GENERATED_LENGTH = 7;

export const RESERVED_ALIASES: readonly string[] = ["api", "status", "admin", "health", "login", "www"];

const GENERATED_SHAPE = /^[0-9A-Za-z]{7}$/;

// `.`, `/` and `+` stay excluded for good: future routes on the Short domain need them.
const ALIAS_CHARACTERS = /^[0-9A-Za-z_-]*$/;
const ALIAS_MIN_LENGTH = 3;
const ALIAS_MAX_LENGTH = 32;

export type CustomAliasValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "length" | "characters" | "reserved" };

export function validateCustomAlias(alias: string): CustomAliasValidation {
  if (alias.length < ALIAS_MIN_LENGTH || alias.length > ALIAS_MAX_LENGTH) return { valid: false, reason: "length" };
  if (!ALIAS_CHARACTERS.test(alias)) return { valid: false, reason: "characters" };
  if (RESERVED_ALIASES.includes(alias.toLowerCase())) return { valid: false, reason: "reserved" };
  return { valid: true };
}

export function isPossibleShortCode(candidate: string): boolean {
  return GENERATED_SHAPE.test(candidate) || validateCustomAlias(candidate).valid;
}
