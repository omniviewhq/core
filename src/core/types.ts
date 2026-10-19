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
  readonly plugins: readonly PluginDefinition[];
  readonly onError?: (error: OmniviewError) => void;
}

/** Options for creating and awaiting a managed session. */
export interface OpenOptions extends SessionOptions, LoadOptions {}

/** A registry and independently managed document sessions. */
export interface Omniview {
  createSession(
    source: ReadableSource,
    options?: SessionOptions,
  ): DocumentSession;
  open(source: ReadableSource, options?: OpenOptions): Promise<DocumentSession>;
  getSessions(): readonly DocumentSession[];
  dispose(): Promise<void>;
}
