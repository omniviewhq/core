import { collectCapabilities } from "../capabilities/registry.ts";
import type { CapabilityKey } from "../capabilities/types.ts";
import { type ErrorContext, OmniviewError } from "../errors.ts";
import { abortable, cancellation } from "../lifecycle/cancellation.ts";
import type { ErrorReporter } from "../lifecycle/reporting.ts";
import { createResources } from "../lifecycle/resources.ts";
import { pluginFailure, resolvePlugin } from "../plugins/resolve-plugin.ts";
import type { PluginDefinition } from "../plugins/types.ts";
import type { ReadableSource } from "../sources/types.ts";
import { createStore } from "./state.ts";
import type { DocumentSession, SessionOptions } from "./types.ts";

/** Construct one tracked document lifetime. */
export function createSession(
  id: string,
  source: ReadableSource,
  plugins: readonly PluginDefinition[],
  onDisposed: () => void,
  report: ErrorReporter,
  options: SessionOptions = {},
): DocumentSession {
  const identity = {
    id,
    source: Object.freeze({
      name: source.name,
      mimeType: source.mimeType,
      size: source.size,
    }),
  };
  const context = { sessionId: id, sourceName: identity.source.name };
  const requestedPlugin = options.pluginId;
  const store = createStore(
    { ...identity, status: "created" },
    report,
    context,
  );
  const controller = new AbortController();
  const resources = createResources(report, context);
  let loading: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  let cleanupReported = false;
  let capabilities: ReadonlyMap<string, object> = new Map();
  let operationContext: ErrorContext = context;

  async function run(): Promise<void> {
    if (controller.signal.aborted)
      throw cancellation(controller.signal, context);
    const plugin = await resolvePlugin(
      plugins,
      { source, signal: controller.signal },
      context,
      requestedPlugin,
    );
    const pluginContext = { ...context, pluginId: plugin.id };
    operationContext = pluginContext;
    const captured = await abortable(
      async () => {
        try {
          const result = await plugin.open({
            source,
            signal: controller.signal,
            sessionId: id,
            onDispose: resources.add,
          });
          if (!result || typeof result !== "object" || Array.isArray(result)) {
            throw new TypeError(
              "open must return a document with optional callable dispose",
            );
          }
          // Late results enter the closed scope and cannot resurrect the session.
          const cleanup = result.dispose;
          if (cleanup !== undefined && typeof cleanup !== "function")
            throw new TypeError("Document dispose must be callable");
          if (cleanup) resources.add(() => cleanup.call(result));
          return { entries: result.capabilities };
        } catch (cause) {
          throw pluginFailure(cause, pluginContext);
        }
      },
      controller.signal,
      pluginContext,
    );
    if (controller.signal.aborted)
      throw cancellation(controller.signal, pluginContext);
    capabilities = collectCapabilities(captured.entries, pluginContext);
    if (controller.signal.aborted)
      throw cancellation(controller.signal, pluginContext);
    store.publish({ ...identity, status: "ready", pluginId: plugin.id });
  }

  return {
    id,
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    getCapability<T extends object>(key: CapabilityKey<T>): T | undefined {
      const status = store.getSnapshot().status;
      if (status === "disposed")
        throw new OmniviewError("SESSION_CLOSED", "Session is disposed", {
          context,
        });
      if (status !== "ready")
        throw new OmniviewError("SESSION_NOT_READY", "Session is not ready", {
          context,
        });
      // Validated registration binds the canonical ID to its author-provided type.
      return capabilities.get(key.id) as T | undefined;
    },
    load(loadOptions = {}) {
      if (store.getSnapshot().status === "disposed")
        return Promise.reject(
          new OmniviewError("SESSION_CLOSED", "Session is disposed", {
            context,
          }),
        );
      if (loading) return loading;
      const external = loadOptions.signal;
      const abort = (): void => {
        const status = store.getSnapshot().status;
        if (status === "created" || status === "loading")
          controller.abort(external?.reason);
      };
      if (external?.aborted) abort();
      else external?.addEventListener("abort", abort, { once: true });
      loading = Promise.resolve()
        .then(run)
        .catch(async (cause: unknown) => {
          const error =
            cause instanceof OmniviewError
              ? cause
              : pluginFailure(cause, operationContext);
          const cleanup = resources.dispose();
          if (store.getSnapshot().status !== "disposed") {
            store.publish({
              ...identity,
              status: error.code === "CANCELLED" ? "cancelled" : "error",
              error,
            });
          }
          controller.abort(error);
          try {
            await cleanup;
          } catch (cleanupError) {
            if (!disposal) {
              cleanupReported = true;
              report(cleanupError as OmniviewError);
            }
          }
          throw error;
        })
        .finally(() => external?.removeEventListener("abort", abort));
      store.publish({ ...identity, status: "loading" });
      return loading;
    },
    dispose() {
      if (disposal) return disposal;
      disposal = resources.dispose().catch((error: unknown) => {
        if (!cleanupReported) throw error;
      });
      capabilities = new Map();
      onDisposed();
      store.publish({ ...identity, status: "disposed" });
      store.close();
      controller.abort(
        new OmniviewError("SESSION_CLOSED", "Session is disposed", { context }),
      );
      return disposal;
    },
  };
}
