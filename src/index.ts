/**
 * Framework-independent contracts and orchestration for Omniview plugins.
 * @module
 */

export type { CapabilityEntry, CapabilityKey } from "./capabilities/types.ts";
export { createOmniview } from "./core/create-core.ts";
export type { CoreOptions, Omniview, OpenOptions } from "./core/types.ts";
export type {
  ErrorCode,
  ErrorContext,
  OmniviewErrorOptions,
} from "./errors.ts";
export { OmniviewError } from "./errors.ts";
export type { PluginDefinition } from "./plugins/types.ts";
export type {
  DocumentSession,
  LoadOptions,
  SessionIdentity,
  SessionOptions,
  SessionSnapshot,
} from "./sessions/types.ts";
export { createSource } from "./sources/blob-source.ts";
export type {
  ReadableSource,
  ReadOptions,
  SourceMetadata,
  SourceOptions,
} from "./sources/types.ts";
