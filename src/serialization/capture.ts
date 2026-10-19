import { type ErrorContext, OmniviewError } from "../errors.ts";
import type { ErrorReporter } from "../lifecycle/reporting.ts";
import { createResources } from "../lifecycle/resources.ts";
import type { MaybePromise } from "../plugins/types.ts";
import type { SerializeContext, SerializedData } from "./types.ts";

/** One capture's snapshotted methods and once-only resource scope. */
export interface OwnedCapture {
  accept(
    value: unknown,
  ): (context: SerializeContext) => MaybePromise<SerializedData>;
  dispose(): Promise<void>;
}

/** Validate before promise assimilation; acquire cleanup before other fields. */
export function createCapture(
  context: ErrorContext,
  report: ErrorReporter,
): OwnedCapture {
  const resources = createResources(report, context);
  const collect = (value: object): void => {
    const cleanup = "dispose" in value ? value.dispose : undefined;
    if (cleanup !== undefined && typeof cleanup !== "function")
      throw new TypeError("Capture dispose must be callable");
    if (cleanup) resources.add(() => cleanup.call(value));
  };
  return {
    accept(value) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Expected a synchronous serialization capture");
      let invalid: { cause: unknown } | undefined;
      try {
        collect(value);
      } catch (cause) {
        invalid = { cause };
      }
      let then: unknown;
      try {
        then = "then" in value ? value.then : undefined;
      } catch (cause) {
        throw invalid ? invalid.cause : cause;
      }
      if (typeof then === "function") {
        void new Promise<unknown>((resolve, reject) => {
          then.call(value, resolve, reject);
        }).then(
          async (late) => {
            const scope = createResources(report, context);
            try {
              if (late && typeof late === "object") {
                const cleanup = "dispose" in late ? late.dispose : undefined;
                if (cleanup !== undefined && typeof cleanup !== "function")
                  throw new TypeError("Capture dispose must be callable");
                if (cleanup) scope.add(() => cleanup.call(late));
              }
            } catch (cause) {
              report(
                new OmniviewError(
                  "CLEANUP_FAILED",
                  "Late capture cleanup failed",
                  { context, cause },
                ),
              );
              return;
            }
            try {
              await scope.dispose();
            } catch (cause) {
              report(cause as OmniviewError);
            }
          },
          () => {},
        );
        throw invalid
          ? invalid.cause
          : new TypeError("Capture must be synchronous");
      }
      if (invalid) throw invalid.cause;
      const serialize = "serialize" in value ? value.serialize : undefined;
      if (typeof serialize !== "function")
        throw new TypeError("Capture serialize must be callable");
      return (context) => serialize.call(value, context);
    },
    dispose: resources.dispose,
  };
}
