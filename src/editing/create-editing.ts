import { type ErrorContext, OmniviewError } from "../errors.ts";
import { pluginFailure } from "../plugins/resolve-plugin.ts";
import type { MaybePromise, PluginContext } from "../plugins/types.ts";
import type {
  EditingDefinition,
  SerializationSnapshot,
} from "../serialization/types.ts";
import { type BoundEditing, createEditingState } from "./state.ts";
import type {
  EditContext,
  EditingSnapshot,
  EditOptions,
  MutationResult,
  Revision,
} from "./types.ts";

/** Session orchestration supplied without a dependency on the session store. */
export interface EditingHost {
  ensureReady(): void;
  context(): ErrorContext;
  publish(): void;
}

/** Private coordination API for a document's editing protocol. */
export interface EditingController {
  attach(definition: EditingDefinition | undefined): void;
  getSnapshot(): EditingSnapshot;
  setReadOnly(value: boolean): void;
  edit: PluginContext["edit"];
  assertAvailable(): void;
  capture<T>(
    consume: (take: () => SerializationSnapshot, revision: Revision) => T,
  ): T;
  acknowledge(revision: Revision): void;
  close(reason: OmniviewError): void;
}

interface Operation {
  readonly controller: AbortController;
  done: boolean;
  finish?: () => void;
  unlink(): void;
  reject(error: OmniviewError): void;
}

/** Own the optional protocol and independent host policy. */
export function createEditing(
  host: EditingHost,
  readOnly: boolean,
): EditingController {
  const state = createEditingState(readOnly, host.publish);
  let active: Operation | undefined;
  const error = (
    code: OmniviewError["code"],
    message: string,
    cause?: unknown,
  ): OmniviewError =>
    new OmniviewError(code, message, { context: host.context(), cause });
  const available = (): BoundEditing => {
    host.ensureReady();
    if (!state.definition)
      throw error("EDITING_UNSUPPORTED", "Document does not support editing");
    if (state.exclusive) throw error("EDIT_BUSY", "Document model is in use");
    return state.definition;
  };
  const writable = (): void => {
    available();
    if (state.readOnly) throw error("READ_ONLY", "Document is read-only");
  };
  const release = (operation: Operation): boolean => {
    if (operation.done) return false;
    operation.done = true;
    operation.unlink();
    if (active === operation) {
      active = undefined;
      state.busy = false;
    }
    return true;
  };
  const reject = (
    operation: Operation,
    failure: OmniviewError,
    notify: boolean,
  ): void => {
    if (!release(operation)) return;
    const finish = (): void => {
      operation.controller.abort(failure);
      operation.reject(failure);
    };
    // Invalidate immediately, but expose only a coherent accepted revision.
    if (state.exclusive === "applying") operation.finish = finish;
    else {
      if (notify) state.notify();
      finish();
    }
  };
  return {
    attach(definition) {
      if (definition === undefined) return;
      let capture: EditingDefinition["capture"] | undefined;
      try {
        capture = definition?.capture;
      } catch (cause) {
        throw pluginFailure(cause, host.context());
      }
      if (
        !definition ||
        typeof definition !== "object" ||
        Array.isArray(definition) ||
        typeof capture !== "function"
      ) {
        throw new OmniviewError(
          "INVALID_EDITING",
          "Expected an editing definition with callable capture",
          { context: host.context() },
        );
      }
      state.definition = { receiver: definition, capture };
    },
    getSnapshot: state.getSnapshot,
    assertAvailable: available,
    capture(consume) {
      const definition = available();
      const revision = state.counter.toString();
      state.exclusive = "capturing";
      try {
        return consume(
          () =>
            definition.capture.call(
              definition.receiver,
              Object.freeze({ revision }),
            ),
          revision,
        );
      } finally {
        state.exclusive = undefined;
      }
    },
    acknowledge(revision) {
      available();
      if (state.persistedRevision === revision) return;
      state.persistedRevision = revision;
      state.notify();
    },
    edit<T>(
      work: (context: EditContext) => MaybePromise<T>,
      options: EditOptions = {},
    ): Promise<T> {
      let external: AbortSignal | undefined;
      try {
        writable();
        if (active)
          throw error("EDIT_BUSY", "An edit operation is already active");
        try {
          external = options.signal;
        } catch (cause) {
          throw error("EDIT_FAILED", "Cannot read edit options", cause);
        }
        writable();
        if (active)
          throw error("EDIT_BUSY", "An edit operation is already active");
        if (external?.aborted)
          throw error("CANCELLED", "Edit cancelled", external.reason);
      } catch (failure) {
        return Promise.reject(failure);
      }
      const controller = new AbortController();
      let resolveResult!: (value: T | PromiseLike<T>) => void;
      let rejectResult!: (reason: OmniviewError) => void;
      const result = new Promise<T>((resolve, rejectPromise) => {
        resolveResult = resolve;
        rejectResult = rejectPromise;
      });
      const operation: Operation = {
        controller,
        done: false,
        unlink() {
          external?.removeEventListener("abort", abort);
        },
        reject: rejectResult,
      };
      const abort = (): void =>
        reject(
          operation,
          error("CANCELLED", "Edit cancelled", external?.reason),
          true,
        );
      active = operation;
      state.busy = true;
      external?.addEventListener("abort", abort, { once: true });
      const context: EditContext = Object.freeze({
        signal: controller.signal,
        commit<T>(change: () => MutationResult<T>): T {
          host.ensureReady();
          if (operation.done || active !== operation)
            throw error(
              "CANCELLED",
              "Edit context is no longer active",
              controller.signal.reason,
            );
          writable();
          if (state.notificationDepth)
            throw error(
              "EDIT_BUSY",
              "Cannot change a document during notification",
            );
          state.exclusive = "applying";
          let value!: T;
          let failure: OmniviewError | undefined;
          try {
            const changed = change();
            if (!changed || typeof changed !== "object")
              throw new TypeError("Change must return a mutation result");
            const then = "then" in changed ? changed.then : undefined;
            if (typeof then === "function") {
              void new Promise((resolve, rejectPromise) => {
                then.call(changed, resolve, rejectPromise);
              }).catch(() => {});
              throw new TypeError("Change callbacks must be synchronous");
            }
            const decision = changed.changed;
            value = changed.value;
            if (typeof decision !== "boolean" || !("value" in changed))
              throw new TypeError("Invalid mutation result");
            if (decision) state.counter++;
          } catch (cause) {
            state.counter++;
            failure = error("EDIT_FAILED", "Document change failed", cause);
            reject(operation, failure, false);
          } finally {
            state.exclusive = undefined;
          }
          state.notify();
          operation.finish?.();
          if (failure) throw failure;
          return value;
        },
      });
      state.notify();
      void Promise.resolve()
        .then(() => {
          if (operation.done) throw controller.signal.reason;
          return work(context);
        })
        .then(
          (value) => {
            if (!release(operation)) return;
            state.notify();
            resolveResult(value);
          },
          (cause: unknown) =>
            reject(
              operation,
              error("EDIT_FAILED", "Edit operation failed", cause),
              true,
            ),
        );
      return result;
    },
    setReadOnly(value) {
      available();
      if (typeof value !== "boolean")
        throw new OmniviewError("INVALID_OPTIONS", "readOnly must be boolean", {
          context: host.context(),
        });
      if (state.readOnly === value) return;
      state.readOnly = value;
      if (value && active)
        reject(
          active,
          error(
            "CANCELLED",
            "Editing permission revoked",
            error("READ_ONLY", "Document is read-only"),
          ),
          true,
        );
      else state.notify();
    },
    close(reason) {
      if (active)
        reject(active, error("CANCELLED", "Edit cancelled", reason), false);
    },
  };
}
