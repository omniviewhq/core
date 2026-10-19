import { type ErrorContext, OmniviewError } from "../errors.ts";
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
): Promise<PluginDefinition> {
  for (const plugin of plugins) {
    try {
      if (await plugin.supports(probe)) return plugin;
    } catch (cause) {
      throw pluginFailure(cause, { ...context, pluginId: plugin.id });
    }
  }
  throw new OmniviewError(
    "UNSUPPORTED_SOURCE",
    "No plugin supports the source",
    { context },
  );
}
