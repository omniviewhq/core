import type { CapabilityEntry } from "../capabilities/types.ts";
import type { ReadableSource } from "../sources/types.ts";

/** A synchronous result or a promise-compatible asynchronous result. */
export type MaybePromise<T> = T | PromiseLike<T>;

/** Releases a document-owned resource synchronously or asynchronously. */
export type Cleanup = () => MaybePromise<void>;

/** Read-only input and cancellation for format detection. */
export interface ProbeContext {
  readonly source: ReadableSource;
  readonly signal: AbortSignal;
}

/** One document's lifetime and session-owned resource registration. */
export interface PluginContext extends ProbeContext {
  readonly sessionId: string;
  onDispose(cleanup: Cleanup): () => void;
}

/** A format plugin's opened document and optional owned resources. */
export interface PluginDocument {
  readonly capabilities?: readonly CapabilityEntry[];
  readonly dispose?: Cleanup;
}

/** A reusable format plugin definition with independent document opens. */
export interface PluginDefinition {
  readonly id: string;
  readonly apiVersion: 1;
  supports(context: ProbeContext): MaybePromise<boolean>;
  open(context: PluginContext): MaybePromise<PluginDocument>;
}
