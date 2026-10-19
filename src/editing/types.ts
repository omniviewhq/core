/** A session-local opaque revision identity, represented as a decimal string. */
export type Revision = string;

/** Optional caller cancellation for one edit operation. */
export interface EditOptions {
  readonly signal?: AbortSignal;
}

/** The synchronous change decision and value returned by an accepted change. */
export interface MutationResult<T> {
  readonly changed: boolean;
  readonly value: T;
}

/** One edit operation's cancellation signal and synchronous change boundary. */
export interface EditContext {
  readonly signal: AbortSignal;
  /** Apply one synchronous change; asynchronous callbacks are not accepted. */
  commit<T>(change: () => MutationResult<T>): T;
}

/** Editing support and, when supported, the session's observable editing state. */
export type EditingSnapshot =
  | { readonly supported: false }
  | {
      readonly supported: true;
      readonly readOnly: boolean;
      readonly busy: boolean;
      readonly revision: Revision;
      readonly persistedRevision: Revision;
      readonly dirty: boolean;
    };
