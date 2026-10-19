import type { Revision } from "../editing/types.ts";
import type { Cleanup, MaybePromise } from "../plugins/types.ts";
import type { ReadableSource } from "../sources/types.ts";

/** Optional caller cancellation for one serialization request. */
export interface SerializeOptions {
  readonly signal?: AbortSignal;
}

/** Cancellation and the fixed revision associated with one encoder invocation. */
export interface SerializeContext {
  readonly signal: AbortSignal;
  readonly revision: Revision;
}

/** Encoded bytes and optional overrides for the original source metadata. */
export interface SerializedData {
  readonly data: Blob | Uint8Array;
  readonly name?: string;
  readonly mimeType?: string;
}

/** An immutable document capture with its encoder and optional owned cleanup. */
export interface SerializationSnapshot {
  /** Encode this capture without observing later document changes. */
  serialize(context: SerializeContext): MaybePromise<SerializedData>;
  /** Release capture resources once encoding or the owning session finishes. */
  readonly dispose?: Cleanup;
}

/** The fixed revision to capture synchronously from the plugin's document. */
export interface CaptureContext {
  readonly revision: Revision;
}

/** Optional document editing support with a synchronous immutable capture. */
export interface EditingDefinition {
  /** Capture this revision synchronously, before any asynchronous encoding. */
  capture(context: CaptureContext): SerializationSnapshot;
}

/** Encoded output and the exact-object receipt for host persistence acknowledgement. */
export interface SerializationResult {
  readonly revision: Revision;
  readonly source: ReadableSource;
}
