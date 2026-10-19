import type { PluginDefinition } from "./types.ts";

/** Preserves author metadata and contextual callback types in a definition. */
export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition;
}
