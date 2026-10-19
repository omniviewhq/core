import { OmniviewError } from "../errors.ts";

/** Reports detached failures without allowing a handler to corrupt lifecycle. */
export type ErrorReporter = (error: OmniviewError) => void;

/** Use the host's diagnostic sink, with a safe default and nonrecursive fallback. */
export function createReporter(handler?: ErrorReporter): ErrorReporter {
  return (error) => {
    try {
      if (handler) handler(error);
      else console.error(error);
    } catch (cause) {
      console.error(
        new OmniviewError("OBSERVER_FAILED", "Error handler failed", { cause }),
      );
    }
  };
}
