// Modules are listed in dependency order: each imports only from modules
// above it, so the core has no import cycles.
export { type CreatorId, DEFAULT_NAMESPACE, type LinkId, type NamespaceId } from "./link-id.ts";
export {
  BASE62_ALPHABET,
  type CustomAliasValidation,
  GENERATED_LENGTH,
  isPossibleShortCode,
  RESERVED_ALIASES,
  validateCustomAlias,
} from "./short-code.ts";
export {
  creatorObjectName,
  decodeLinksValue,
  type DeletedBy,
  encodeLinksValue,
  fold,
  keyedCandidate,
  linksKey,
  type LinksValue,
  type LiveLinksValue,
  shardNumber,
  shardObjectName,
  targetUrlSha256,
  type TombstoneLinksValue,
} from "./encoding.ts";
export {
  applyDelete,
  type DeleteResult,
  type Deleter,
  type Deletion,
  type Link,
  linkState,
  type LinkState,
  mergeLinkRecords,
  toLinksValue,
  type VoidRecord,
} from "./link.ts";
export type {
  AuthenticatedCreator,
  ClaimResult,
  Clock,
  CreatorAuthenticator,
  LinkReader,
  LinkRegistry,
  NamespaceResolver,
  RedirectEvent,
  RedirectOutcome,
  RedirectRecorder,
  ShortCodeGenerator,
} from "./ports.ts";
export { RandomShortCodeGenerator } from "./generator.ts";
export {
  InMemoryCreatorAuthenticator,
  InMemoryLinkStore,
  InMemoryRedirectRecorder,
  ManualClock,
  SequenceShortCodeGenerator,
  StaticNamespaceResolver,
} from "./in-memory.ts";
export { createLink, type CreateLinkPorts, type CreateLinkRequest, type CreateLinkResult } from "./create-link.ts";
export { decideRedirect, type RedirectDecision, type RedirectPorts, type RedirectRequest } from "./redirect.ts";
