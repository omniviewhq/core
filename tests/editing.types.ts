import type {
  DocumentSession,
  EditingSnapshot,
  Revision,
  SerializationResult,
} from "../src/index.ts";
import type {
  CaptureContext,
  EditContext,
  EditingDefinition,
  EditOptions,
  MaybePromise,
  MutationResult,
  PluginContext,
  SerializationSnapshot,
  SerializeContext,
  SerializedData,
} from "../src/sdk/index.ts";

export function checkEdits(context: EditContext): void {
  const result: string = context.commit(() => ({
    changed: true,
    value: "text",
  }));
  const noChange: MutationResult<void> = { changed: false, value: undefined };
  context.commit(() => noChange);
  // @ts-expect-error A change callback cannot return a Promise.
  context.commit(async () => ({ changed: true, value: "text" }));
  // @ts-expect-error changed must be boolean.
  context.commit(() => ({ changed: "yes", value: "text" }));
  void result;
}

export function checkContracts(
  state: EditingSnapshot,
  revision: Revision,
  output: SerializationResult,
  options: EditOptions,
  capture: CaptureContext,
  encoder: SerializeContext,
  snapshot: SerializationSnapshot,
  definition: EditingDefinition,
): void {
  if (state.supported) {
    const current: string = state.revision;
    const dirty: boolean = state.dirty;
    void [current, dirty];
  }
  const data: SerializedData = { data: new Uint8Array([97]) };
  const pending: MaybePromise<SerializedData> = Promise.resolve(data);
  // @ts-expect-error Revision metadata is a string, not a numeric counter.
  const numeric: number = revision;
  void [
    output,
    options,
    capture,
    encoder,
    snapshot,
    definition,
    pending,
    numeric,
  ];
}

export function checkManagedEditing(
  session: DocumentSession,
  plugin: PluginContext,
  result: SerializationResult,
): void {
  const operation: Promise<string> = plugin.edit(async ({ commit }) => {
    await Promise.resolve();
    return commit(() => ({ changed: true, value: "result" }));
  });
  const encoded: Promise<SerializationResult> = session.serialize();
  session.setReadOnly(true);
  session.markPersisted(result);
  // @ts-expect-error Acknowledgements require issued results, not revision strings.
  session.markPersisted("1");
  // @ts-expect-error Policy values are boolean.
  session.setReadOnly("false");
  void [operation, encoded];
}
