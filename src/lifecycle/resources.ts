import { type ErrorContext, OmniviewError } from "../errors.ts";
import type { Cleanup } from "../plugins/types.ts";
import type { ErrorReporter } from "./reporting.ts";

/** A session-owned collection of independent cleanup registrations. */
export interface ResourceScope {
  add(cleanup: Cleanup): () => void;
  dispose(): Promise<void>;
}

/** Close once, await known resources in LIFO order, and observe late resources. */
export function createResources(
  report: ErrorReporter,
  context: ErrorContext,
): ResourceScope {
  const entries = new Set<{ cleanup: Cleanup }>();
  let disposal: Promise<void> | undefined;
  const failure = (errors: unknown[]): OmniviewError =>
    new OmniviewError("CLEANUP_FAILED", "Resource cleanup failed", {
      cause: new AggregateError(errors),
      context,
    });
  return {
    add(cleanup) {
      const entry = { cleanup };
      if (disposal) {
        void Promise.resolve()
          .then(cleanup)
          .catch((cause: unknown) => report(failure([cause])));
      } else entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
    dispose() {
      if (disposal) return disposal;
      const owned = [...entries].reverse();
      entries.clear();
      disposal = Promise.resolve().then(async () => {
        const errors: unknown[] = [];
        for (const entry of owned) {
          try {
            await entry.cleanup();
          } catch (cause) {
            errors.push(cause);
          }
        }
        if (errors.length) throw failure(errors);
      });
      return disposal;
    },
  };
}
