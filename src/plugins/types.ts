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
  /** Stable identity for this open, unique within the owning core. */
  readonly sessionId: string;
  /** Register one resource cleanup; call the returned function to unregister it. */
  onDispose(cleanup: Cleanup): () => void;
}

/** A format plugin's opened document and optional owned resources. */
export interface PluginDocument {
  /** Named object APIs, validated and snapshotted before the session becomes ready. */
  readonly capabilities?: readonly CapabilityEntry[];
  /** Optional cleanup registered after resources acquired during open. */
  readonly dispose?: Cleanup;
}

/** A reusable format plugin definition with independent document opens. */
export interface PluginDefinition {
  /** Nonblank registration identity; duplicate IDs are rejected within a core. */
  readonly id: string;
  /** Runtime protocol version, independent of the package's release version. */
  readonly apiVersion: 1;
  /** Probe without retaining resources; detection is awaited in registry order. */
  supports(context: ProbeContext): MaybePromise<boolean>;
  /** Create independent document state and register resources as they are acquired. */
  open(context: PluginContext): MaybePromise<PluginDocument>;
}
