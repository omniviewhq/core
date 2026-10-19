import type {
  DocumentSession,
  DocumentSource,
  Omniview,
  OmniviewOptions,
} from "./types.ts";

/** Create a headless instance with explicitly supplied plugins. */
export function createOmniview(options: OmniviewOptions): Omniview {
  const plugins = [...options.plugins];
  const ids = new Set<string>();

  for (const plugin of plugins) {
    if (plugin.id.trim() === "") {
      throw new Error("Plugin id must not be empty");
    }
    if (ids.has(plugin.id)) {
      throw new Error(`Duplicate plugin id: ${plugin.id}`);
    }
    ids.add(plugin.id);
  }

  return {
    async open(source: DocumentSource): Promise<DocumentSession> {
      for (const plugin of plugins) {
        if (plugin.supports(source)) {
          return plugin.open(source);
        }
      }
      throw new Error(`No plugin supports: ${source.name}`);
    },
  };
}
