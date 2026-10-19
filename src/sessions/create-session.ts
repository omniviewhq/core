import type { ErrorReporter } from "../lifecycle/reporting.ts";
import { pluginFailure, resolvePlugin } from "../plugins/resolve-plugin.ts";
import type { PluginDefinition, PluginDocument } from "../plugins/types.ts";
import type { ReadableSource } from "../sources/types.ts";
import { createStore } from "./state.ts";
import type { DocumentSession } from "./types.ts";

/** Construct one tracked document lifetime. */
export function createSession(
  id: string,
  source: ReadableSource,
  plugins: readonly PluginDefinition[],
  onDisposed: () => void,
  report: ErrorReporter,
): DocumentSession {
  const identity = {
    id,
    source: Object.freeze({
      name: source.name,
      mimeType: source.mimeType,
      size: source.size,
    }),
  };
  const store = createStore({ ...identity, status: "created" }, report, {
    sessionId: id,
    sourceName: source.name,
  });
  let loading: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  let document: PluginDocument | undefined;
  const controller = new AbortController();
  return {
    id,
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    getCapability: () => undefined,
    load() {
      if (loading) return loading;
      loading = Promise.resolve().then(async () => {
        const context = { sessionId: id, sourceName: source.name };
        const plugin = await resolvePlugin(
          plugins,
          { source, signal: controller.signal },
          context,
        );
        try {
          document = await plugin.open({
            source,
            signal: controller.signal,
            sessionId: id,
            onDispose: () => () => {},
          });
        } catch (cause) {
          throw pluginFailure(cause, { ...context, pluginId: plugin.id });
        }
        store.publish({ ...identity, status: "ready", pluginId: plugin.id });
      });
      store.publish({ ...identity, status: "loading" });
      return loading;
    },
    dispose() {
      if (disposal) return disposal;
      disposal = Promise.resolve().then(async () => {
        await document?.dispose?.();
      });
      onDisposed();
      store.publish({ ...identity, status: "disposed" });
      store.close();
      return disposal;
    },
  };
}
