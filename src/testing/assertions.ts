import { type ErrorCode, OmniviewError } from "../errors.ts";
import type { MaybePromise } from "../plugins/types.ts";
import type { PluginConformancePhase } from "./types.ts";

/** Internal marker separating fixture boundaries from assertion failures. */
export class BoundaryFailure {
  constructor(
    readonly phase: PluginConformancePhase,
    readonly cause: unknown,
  ) {}
}

/** Raise a readable assertion without importing any test runner. */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Observe a rejection at acquisition, before a later cancellation trigger. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly cause: unknown };
export function observe<T>(value: MaybePromise<T>): Promise<Outcome<T>> {
  return Promise.resolve(value).then(
    (value) => ({ ok: true, value }),
    (cause: unknown) => ({ ok: false, cause }),
  );
}

/** Verify a public error category and return its original contextual instance. */
export async function rejects(
  start: () => MaybePromise<unknown>,
  code: ErrorCode,
): Promise<OmniviewError> {
  let failure: { cause: unknown } | undefined;
  try {
    await start();
  } catch (cause) {
    failure = { cause };
  }
  check(failure?.cause instanceof OmniviewError, `Expected ${code} rejection`);
  check(
    failure.cause.code === code,
    `Expected ${code}, received ${failure.cause.code}`,
  );
  return failure.cause;
}
