import type { OmniviewError } from "../errors.ts";
import type { PluginDefinition } from "../plugins/types.ts";
import type {
  DocumentSession,
  LoadOptions,
  SessionOptions,
} from "../sessions/types.ts";
import type { ReadableSource } from "../sources/types.ts";

/** Headless composition and out-of-band failure reporting. */
export interface CoreOptions {
  /** Default host policy for new sessions; defaults to true. */
  readonly readOnly?: boolean;
  /** Ordered registrations, captured at construction; definitions remain read-only. */
  readonly plugins: readonly PluginDefinition[];
  /** Receive observer and detached cleanup failures; defaults to console.error. */
  readonly onError?: (error: OmniviewError) => void;
}

/** Options for creating and awaiting a managed session. */
export interface OpenOptions extends SessionOptions, LoadOptions {}

/** A registry and independently managed document sessions. */
export interface Omniview {
  /** Track a session without starting plugin detection or loading. */
  createSession(
    source: ReadableSource,
    options?: SessionOptions,
  ): DocumentSession;
  /** Create and load; remove the temporary session on failure. */
  open(source: ReadableSource, options?: OpenOptions): Promise<DocumentSession>;
  /** Return a frozen collection stable until a session is added or disposed. */
  getSessions(): readonly DocumentSession[];
  /** Close the core and await every owned session, aggregating cleanup failures. */
  dispose(): Promise<void>;
}
