/** A Namespace's opaque ID: `default`, or `ns_` plus 10 base62 characters (ADR 0014). */
export type NamespaceId = string;

/** Every Deployment starts with this Namespace, and it needs no bootstrap (ADR 0014). */
export const DEFAULT_NAMESPACE: NamespaceId = "default";

/** A Creator's opaque ID: `cr_` plus random base62 (ADR 0005). */
export type CreatorId = string;

/** A Link's identity: its Short code within its Namespace (ADR 0014). */
export interface LinkId {
  readonly namespace: NamespaceId;
  readonly shortCode: string;
}
