import type { CapabilityKey } from "../capabilities/types.ts";
import type { OmniviewError } from "../errors.ts";
import type { SourceMetadata } from "../sources/types.ts";

/** Stable identity and captured source metadata for one document. */
export interface SessionIdentity {
  readonly id: string;
  readonly source: SourceMetadata;
}

/** An immutable view of a managed document's lifecycle. */
export type SessionSnapshot = SessionIdentity &
  (
    | { readonly status: "created" | "loading" }
    | { readonly status: "ready"; readonly pluginId: string }
    | { readonly status: "error" | "cancelled"; readonly error: OmniviewError }
    | { readonly status: "disposed" }
  );

/** Cancellation applies to the first load operation, not a ready document. */
export interface LoadOptions {
  readonly signal?: AbortSignal;
}

/** Select a plugin explicitly instead of detecting the format. */
export interface SessionOptions {
  readonly pluginId?: string;
}

/** One document's managed lifetime. */
export interface DocumentSession {
  /** Identity unique within its owning core instance. */
  readonly id: string;
  /** Return the same frozen snapshot until the next lifecycle transition. */
  getSnapshot(): SessionSnapshot;
  /** Observe synchronous transitions; the returned unsubscribe is idempotent. */
  subscribe(listener: () => void): () => void;
  /** Load once; failures are terminal and subsequent calls share the promise. */
  load(options?: LoadOptions): Promise<void>;
  /** Retrieve a plugin API while ready; returned APIs share this session's lifetime. */
  getCapability<T extends object>(key: CapabilityKey<T>): T | undefined;
  /** Become disposed immediately, abort work, and await all known cleanup. */
  dispose(): Promise<void>;
}
