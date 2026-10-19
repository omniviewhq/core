import { type ErrorContext, OmniviewError } from "../errors.ts";
import type { ErrorReporter } from "../lifecycle/reporting.ts";
import type { SessionSnapshot } from "./types.ts";

/** Private external-store implementation used by managed sessions. */
export interface SessionStore {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  publish(snapshot: SessionSnapshot): void;
  close(): void;
}

/** Keep stable snapshots and isolate reentrant/throwing observers. */
export function createStore(
  initial: SessionSnapshot,
  report: ErrorReporter,
  context: ErrorContext,
): SessionStore {
  let snapshot = Object.freeze(initial);
  let revision = 0;
  let closed = false;
  const listeners = new Set<{ listener: () => void }>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      const entry = { listener };
      if (!closed) listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    publish(next) {
      snapshot = Object.freeze(next);
      const currentRevision = ++revision;
      for (const entry of [...listeners]) {
        if (currentRevision !== revision) break;
        if (!listeners.has(entry)) continue;
        try {
          entry.listener();
        } catch (cause) {
          report(
            new OmniviewError("OBSERVER_FAILED", "Session observer failed", {
              cause,
              context,
            }),
          );
        }
      }
    },
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
