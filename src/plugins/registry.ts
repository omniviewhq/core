import { OmniviewError } from "../errors.ts";
import type { PluginDefinition } from "./types.ts";

/** Capture ordered registrations independently of the caller's array. */
export function createRegistry(
  definitions: readonly PluginDefinition[],
): readonly PluginDefinition[] {
  const ids = new Set<string>();
  for (const plugin of definitions) {
    if (plugin.id.trim() === "")
      throw new OmniviewError("INVALID_PLUGIN", "Plugin id must not be empty");
    if (ids.has(plugin.id))
      throw new OmniviewError(
        "DUPLICATE_PLUGIN",
        `Duplicate plugin id: ${plugin.id}`,
      );
    ids.add(plugin.id);
  }
  return Object.freeze([...definitions]);
}
