import { type ErrorContext, OmniviewError } from "../errors.ts";

/** Construct a cancellation retaining the signal's original reason. */
export function cancellation(
  signal: AbortSignal,
  context: ErrorContext,
): OmniviewError {
  return new OmniviewError("CANCELLED", "Operation cancelled", {
    cause: signal.reason,
    context,
  });
}

/** Race work against cancellation while observing the underlying promise. */
export function abortable<T>(
  start: () => T | PromiseLike<T>,
  signal: AbortSignal | undefined,
  context: ErrorContext,
): Promise<T> {
  if (!signal) return Promise.resolve().then(start);
  if (signal.aborted) return Promise.reject(cancellation(signal, context));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = (): void => {
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(cancellation(signal, context));
    };
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve()
      .then(() => {
        if (signal.aborted) throw cancellation(signal, context);
        return start();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          if (!settled) {
            settled = true;
            resolve(value);
          }
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          if (!settled) {
            settled = true;
            reject(error);
          }
        },
      );
  });
}
