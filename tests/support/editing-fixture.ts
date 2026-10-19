// tests/support/editing-fixture.ts
import type { DocumentSession, EditingSnapshot } from "../../src/index.ts";
import {
  type CaptureContext,
  defineCapability,
  definePlugin,
  type EditContext,
  type EditOptions,
  type MaybePromise,
  type PluginDefinition,
  provideCapability,
  type SerializationSnapshot,
} from "../../src/sdk/index.ts";

export interface TextWork extends EditContext {
  read(): string;
  replace(value: string): void;
}

export interface TextEditor {
  read(): string;
  replace(value: string, options?: EditOptions): Promise<void>;
  run<T>(
    work: (context: TextWork) => MaybePromise<T>,
    options?: EditOptions,
  ): Promise<T>;
}

export const textEditor = defineCapability<TextEditor>("fixture.text:editor");

export interface TextFixtureOptions {
  readonly capture?: (
    text: string,
    context: CaptureContext,
  ) => SerializationSnapshot;
}

export function textPlugin(options: TextFixtureOptions = {}): PluginDefinition {
  return definePlugin({
    id: "fixture/editable-text",
    apiVersion: 1,
    supports: () => true,
    async open({ source, signal, edit, onDispose }) {
      let text = new TextDecoder().decode(await source.read({ signal }));
      onDispose(() => {
        text = "";
      });
      const run: TextEditor["run"] = (work, editOptions) =>
        edit((context) => {
          const replace = (next: string): void =>
            context.commit(() => {
              const changed = text !== next;
              text = next;
              return { changed, value: undefined };
            });
          return work({
            signal: context.signal,
            commit: context.commit,
            read: () => text,
            replace,
          });
        }, editOptions);
      return {
        capabilities: [
          provideCapability(textEditor, {
            read: () => text,
            replace: (next, editOptions) =>
              run(({ replace }) => replace(next), editOptions),
            run,
          }),
        ],
        editing: {
          capture(context) {
            const captured = text;
            return options.capture
              ? options.capture(captured, context)
              : {
                  serialize: () => ({
                    data: new TextEncoder().encode(captured),
                    mimeType: "text/plain;charset=utf-8",
                  }),
                };
          },
        },
      };
    },
  });
}

export function editingState(
  session: DocumentSession,
): Extract<EditingSnapshot, { supported: true }> {
  const snapshot = session.getSnapshot();
  if (snapshot.status !== "ready" || !snapshot.editing.supported) {
    throw new Error("Expected a ready editable document");
  }
  return snapshot.editing;
}

export function editor(session: DocumentSession): TextEditor {
  const capability = session.getCapability(textEditor);
  if (!capability) throw new Error("Expected text editor capability");
  return capability;
}
