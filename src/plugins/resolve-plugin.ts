import { type ErrorContext, OmniviewError } from "../errors.ts";
import { abortable } from "../lifecycle/cancellation.ts";
import type { PluginDefinition, ProbeContext } from "./types.ts";

/** Wrap a plugin failure without losing its original cause or identity. */
export function pluginFailure(
  cause: unknown,
  context: ErrorContext,
): OmniviewError {
  return new OmniviewError("PLUGIN_FAILED", "Plugin operation failed", {
    cause,
    context,
  });
}

/** Select the first supporting definition in registration order. */
export async function resolvePlugin(
  plugins: readonly PluginDefinition[],
  probe: ProbeContext,
  context: ErrorContext,
  pluginId?: string,
): Promise<PluginDefinition> {
  if (pluginId !== undefined) {
    const selected = plugins.find((plugin) => plugin.id === pluginId);
    if (selected) return selected;
    throw new OmniviewError(
      "PLUGIN_NOT_FOUND",
      "Requested plugin is not registered",
      { context: { ...context, pluginId } },
    );
  }
  for (const plugin of plugins) {
    try {
      const supported = await abortable(
        () => plugin.supports(probe),
        probe.signal,
        { ...context, pluginId: plugin.id },
      );
      if (typeof supported !== "boolean")
        throw new TypeError("supports must return a boolean");
      if (supported) return plugin;
    } catch (cause) {
      if (probe.signal.aborted) throw cause;
      throw pluginFailure(cause, { ...context, pluginId: plugin.id });
    }
  }
  throw new OmniviewError(
    "UNSUPPORTED_SOURCE",
    "No plugin supports the source",
    { context },
  );
}
