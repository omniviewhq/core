/** Stable failure categories shared by host applications and plugins. */
export type ErrorCode =
  | "INVALID_SOURCE"
  | "INVALID_RANGE"
  | "INVALID_PLUGIN"
  | "DUPLICATE_PLUGIN"
  | "PLUGIN_NOT_FOUND"
  | "UNSUPPORTED_SOURCE"
  | "PLUGIN_FAILED"
  | "INVALID_CAPABILITY"
  | "CAPABILITY_CONFLICT"
  | "SESSION_NOT_READY"
  | "SESSION_CLOSED"
  | "CORE_CLOSED"
  | "CANCELLED"
  | "CLEANUP_FAILED"
  | "OBSERVER_FAILED";

/** Identifies the operation associated with a failure. */
export interface ErrorContext {
  readonly sourceName?: string;
  readonly pluginId?: string;
  readonly sessionId?: string;
}

/** Native error causes with optional document context. */
export interface OmniviewErrorOptions extends ErrorOptions {
  readonly context?: ErrorContext;
}

/** A structured failure with its original cause retained. */
export class OmniviewError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;

  constructor(
    code: ErrorCode,
    message: string,
    options: OmniviewErrorOptions = {},
  ) {
    super(message, options);
    this.name = "OmniviewError";
    this.code = code;
    this.context = Object.freeze({ ...options.context });
  }
}
