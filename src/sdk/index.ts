/**
 * Portable contracts and helpers for authoring Omniview format plugins.
 * @module
 */

export {
  defineCapability,
  provideCapability,
} from "../capabilities/define-capability.ts";
export type {
  CapabilityEntry,
  CapabilityKey,
} from "../capabilities/types.ts";
export type {
  ErrorCode,
  ErrorContext,
  OmniviewErrorOptions,
} from "../errors.ts";
export { OmniviewError } from "../errors.ts";
export { definePlugin } from "../plugins/define-plugin.ts";
export type {
  Cleanup,
  MaybePromise,
  PluginContext,
  PluginDefinition,
  PluginDocument,
  ProbeContext,
} from "../plugins/types.ts";
export type {
  ReadableSource,
  ReadOptions,
  SourceMetadata,
  SourceOptions,
} from "../sources/types.ts";
