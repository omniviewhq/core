import {
  type CapabilityEntry,
  type CapabilityKey,
  type Cleanup,
  defineCapability,
  definePlugin,
  type ErrorCode,
  type ErrorContext,
  type MaybePromise,
  type OmniviewErrorOptions,
  type PluginContext,
  type PluginDefinition,
  type PluginDocument,
  type ProbeContext,
  provideCapability,
  type ReadableSource,
  type ReadOptions,
  type SourceMetadata,
  type SourceOptions,
} from "../src/sdk/index.ts";

const text = defineCapability<{ getText(): string }>("example.text:content");
provideCapability(text, { getText: () => "hello" });
// @ts-expect-error The key fixes the capability value type.
provideCapability(text, { getText: () => 123 });
// @ts-expect-error Capability identifiers require a namespace.
defineCapability<{ getText(): string }>("content");

export const plugin = definePlugin({
  id: "example/text",
  apiVersion: 1,
  authorLabel: "example",
  supports: ({ source }) => source.name.endsWith(".txt"),
  open: ({ signal, onDispose, sessionId }) => {
    const id: string = sessionId;
    const unregister: () => void = onDispose(() => {
      void signal.aborted;
    });
    void id;
    void unregister;
    return {
      capabilities: [provideCapability(text, { getText: () => "hello" })],
    };
  },
});

export const authorLabel: string = plugin.authorLabel;

definePlugin({
  id: "example/future",
  // @ts-expect-error Only protocol version 1 is supported.
  apiVersion: 2,
  supports: () => true,
  open: () => ({}),
});

// Public contracts are available without importing private source modules.
export function assertSdkTypes(
  context: PluginContext,
  cleanup: Cleanup,
  thenable: PromiseLike<PluginDocument>,
  key: CapabilityKey<{ getText(): string }>,
  readOptions: ReadOptions,
  sourceOptions: SourceOptions,
  code: ErrorCode,
  errorContext: ErrorContext,
): void {
  const probe: ProbeContext = context;
  const source: ReadableSource = probe.source;
  const metadata: SourceMetadata = source;
  const definition: PluginDefinition = plugin;
  const document: MaybePromise<PluginDocument> = thenable;
  const entry: CapabilityEntry = provideCapability(key, { getText: () => "a" });
  const options: OmniviewErrorOptions = { context: errorContext };
  void [
    cleanup,
    readOptions,
    sourceOptions,
    code,
    metadata,
    definition,
    document,
    entry,
    options,
  ];
}
