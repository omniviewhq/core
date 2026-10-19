/**
 * Framework-independent contracts and orchestration for Omniview plugins.
 * @module
 */

export type {
  ErrorCode,
  ErrorContext,
  OmniviewErrorOptions,
} from "./errors.ts";
export { OmniviewError } from "./errors.ts";
export { createOmniview } from "./omniview.ts";
export { createSource } from "./sources/blob-source.ts";
export type {
  ReadableSource,
  ReadOptions,
  SourceMetadata,
  SourceOptions,
} from "./sources/types.ts";
export type {
  DocumentSession,
  DocumentSource,
  EditSession,
  Omniview,
  OmniviewOptions,
  OmniviewPlugin,
  ViewSession,
} from "./types.ts";
