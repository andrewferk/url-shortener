export type NamespaceId = string;

export const DEFAULT_NAMESPACE: NamespaceId = "default";

export type CreatorId = string;

export type EpochMs = number;

export interface LinkId {
  readonly namespace: NamespaceId;
  readonly shortCode: string;
}

export function sameLink(a: LinkId, b: LinkId): boolean {
  return a.namespace === b.namespace && a.shortCode === b.shortCode;
}
