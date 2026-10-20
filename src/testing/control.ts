import { BoundaryFailure, type Outcome, observe } from "./assertions.ts";
import type { ControlledEdit, ControlledLoad } from "./types.ts";

/** Observed milestones cannot leave a rejection unhandled while a case is busy. */
export interface HeldLoad {
  readonly entered: Promise<Outcome<void>>;
  readonly drained: Promise<Outcome<void>>;
  release(): Promise<Outcome<void>>;
}
export interface HeldEdit extends HeldLoad {
  readonly result: Promise<Outcome<void>>;
}
export interface ControlScope {
  load(value: ControlledLoad): HeldLoad;
  edit(value: ControlledEdit): HeldEdit;
  cleanup(): Promise<readonly unknown[]>;
}

function milestone(value: unknown): Promise<Outcome<void>> {
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    throw new TypeError("Expected promise-like control milestone");
  const then = "then" in value ? value.then : undefined;
  if (typeof then !== "function")
    throw new TypeError("Expected promise-like control milestone");
  return observe(
    new Promise<void>((resolve, reject) => {
      then.call(value, resolve, reject);
    }),
  ).then((outcome) =>
    outcome.ok && outcome.value !== undefined
      ? {
          ok: false,
          cause: new TypeError("Control milestones must resolve undefined"),
        }
      : outcome,
  );
}

interface Entry {
  readonly release: (() => Promise<Outcome<void>>) | undefined;
  readonly drained: Promise<Outcome<void>> | undefined;
  drainOutcome: Outcome<void> | undefined;
  detached: boolean;
}

/** Acquire cleanup before validation; release every gate before awaiting drains. */
export function createControlScope(
  reportLate: (cause: unknown) => void,
): ControlScope {
  const entries: Entry[] = [];
  let disposal: Promise<readonly unknown[]> | undefined;
  function acquire(value: unknown, edit: boolean): HeldEdit | HeldLoad {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new BoundaryFailure(
        "fixture",
        new TypeError("Expected synchronous control box"),
      );
    let invalid: { cause: unknown } | undefined;
    let release!: () => Promise<Outcome<void>>;
    let drained!: Promise<Outcome<void>>;
    let entered!: Promise<Outcome<void>>;
    let result!: Promise<Outcome<void>>;
    try {
      const callback = "release" in value ? value.release : undefined;
      if (typeof callback !== "function")
        throw new TypeError("Control release must be callable");
      let released: Promise<Outcome<void>> | undefined;
      release = () => {
        released ??= observe(
          Promise.resolve().then(() => callback.call(value)),
        );
        return released;
      };
    } catch (cause) {
      invalid = { cause };
    }
    try {
      entered = milestone("entered" in value ? value.entered : undefined);
    } catch (cause) {
      invalid ??= { cause };
    }
    try {
      drained = milestone("drained" in value ? value.drained : undefined);
    } catch (cause) {
      invalid ??= { cause };
    }
    if (edit) {
      try {
        result = milestone("result" in value ? value.result : undefined);
      } catch (cause) {
        invalid ??= { cause };
      }
    }
    const entry: Entry = {
      release,
      drained,
      drainOutcome: undefined,
      detached: false,
    };
    entries.push(entry);
    if (drained)
      void drained.then((outcome) => {
        entry.drainOutcome = outcome;
        if (entry.detached && !outcome.ok) reportLate(outcome.cause);
      });
    try {
      const then = "then" in value ? value.then : undefined;
      if (typeof then === "function") {
        void new Promise<unknown>((resolve, reject) => {
          then.call(value, resolve, reject);
        }).then(
          async (late) => {
            const scope = createControlScope(reportLate);
            try {
              if (edit) scope.edit(late as ControlledEdit);
              else scope.load(late as ControlledLoad);
            } catch (cause) {
              reportLate(
                cause instanceof BoundaryFailure ? cause.cause : cause,
              );
            }
            for (const cause of await scope.cleanup()) reportLate(cause);
          },
          () => {},
        );
        throw new TypeError("Control box must be synchronous");
      }
    } catch (cause) {
      invalid ??= { cause };
    }
    if (invalid) throw new BoundaryFailure("fixture", invalid.cause);
    // Successful validation acquired all required methods/milestones above.
    const handle: HeldLoad = { entered, drained, release };
    return edit ? { ...handle, result } : handle;
  }
  return {
    load(value) {
      return acquire(value, false);
    },
    edit(value) {
      return acquire(value, true) as HeldEdit;
    },
    cleanup() {
      disposal ??= (async () => {
        const errors: unknown[] = [];
        const released = await Promise.all(
          entries.map((entry) =>
            entry.release ? entry.release() : Promise.resolve(undefined),
          ),
        );
        for (const [index, entry] of entries.entries()) {
          const outcome = released[index];
          if (!entry.release || (outcome && !outcome.ok)) {
            if (outcome && !outcome.ok) errors.push(outcome.cause);
            if (entry.drainOutcome && !entry.drainOutcome.ok)
              errors.push(entry.drainOutcome.cause);
            else if (!entry.drainOutcome) entry.detached = true;
            continue;
          }
          if (entry.drained) {
            const drain = await entry.drained;
            if (!drain.ok) errors.push(drain.cause);
          }
        }
        return errors;
      })();
      return disposal;
    },
  };
}
