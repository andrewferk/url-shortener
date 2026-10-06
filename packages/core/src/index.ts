export { createLink, type CreateLinkPorts, type CreateLinkRequest, type CreateLinkResult } from "./create-link.ts";
export {
  InMemoryCreatorAuthenticator,
  InMemoryLinkStore,
  InMemoryRedirectRecorder,
  ManualClock,
  SequenceShortCodeGenerator,
  StaticNamespaceResolver,
} from "./in-memory.ts";
export { decideRedirect, type RedirectDecision, type RedirectPorts, type RedirectRequest } from "./redirect.ts";
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
  type CreatorId,
  DEFAULT_NAMESPACE,
  type DeleteResult,
  type Deleter,
  type Deletion,
  type Link,
  type LinkId,
  linkState,
  type LinkState,
  type NamespaceId,
  toLinksValue,
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
export {
  BASE62_ALPHABET,
  type CustomAliasValidation,
  GENERATED_LENGTH,
  isPossibleShortCode,
  RandomShortCodeGenerator,
  RESERVED_ALIASES,
  validateCustomAlias,
} from "./short-code.ts";
