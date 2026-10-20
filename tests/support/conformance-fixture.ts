import { createSource, type DocumentSession } from "../../src/index.ts";
import {
  defineCapability,
  definePlugin,
  type PluginDefinition,
  provideCapability,
} from "../../src/sdk/index.ts";
import type {
  PluginTestFixture,
  PluginTestSuiteOptions,
} from "../../src/testing/index.ts";
import { editor, textPlugin } from "./editing-fixture.ts";

export interface ConformanceFixture extends PluginTestFixture {
  readonly resources: { active: number };
}

export const viewerText = defineCapability<{ read(): string }>(
  "fixture.conformance:text",
);

export interface ViewerFixtureSettings {
  readonly detects?: boolean;
  readonly wrongContent?: boolean;
  readonly sharedState?: boolean;
  readonly leak?: boolean;
}

/** An actual viewer model, including deliberately broken variants for checks. */
export function viewerSuiteOptions(
  settings: ViewerFixtureSettings = {},
): PluginTestSuiteOptions<ConformanceFixture> {
  return {
    id: "viewer",
    editing: false,
    createFixture() {
      const resources = { active: 0 };
      let shared = "before";
      const plugin: PluginDefinition = definePlugin({
        id: "fixture/conformance-viewer",
        apiVersion: 1,
        supports: ({ source }) =>
          (settings.detects ?? true) && source.mimeType === "text/plain",
        async open({ source, signal, onDispose }) {
          let text = new TextDecoder().decode(await source.read({ signal }));
          if (settings.wrongContent) text = "wrong";
          shared = text;
          resources.active++;
          onDispose(() => {
            if (!settings.leak) resources.active--;
            text = "";
            if (settings.sharedState) shared = "";
          });
          return {
            capabilities: [
              provideCapability(viewerText, {
                read: () => (settings.sharedState ? shared : text),
              }),
            ],
          };
        },
      });
      return {
        plugin,
        resources,
        createSource: () =>
          createSource(new TextEncoder().encode("before"), {
            name: "document.txt",
            mimeType: "text/plain",
          }),
      };
    },
    verifyDocument({ session }) {
      if (session.getCapability(viewerText)?.read() !== "before") {
        throw new Error("Expected initial viewer text");
      }
    },
    fingerprint({ session }) {
      const text = session.getCapability(viewerText);
      if (!text) throw new Error("Missing viewer text");
      return text.read();
    },
    unsupported: [
      {
        id: "binary",
        createSource: () =>
          createSource(new Uint8Array([1, 2]), {
            name: "unsupported.bin",
            mimeType: "application/octet-stream",
          }),
      },
    ],
    verifyDisposed({ resources }) {
      if (resources.active !== 0) throw new Error("Plugin resource leak");
    },
  };
}

/** Shared known-good editable setup; content is inspected via its real API. */
export function editableSuiteOptions(): PluginTestSuiteOptions<PluginTestFixture> {
  const read = (session: DocumentSession): string => editor(session).read();
  return {
    id: "editable",
    createFixture: () => ({
      plugin: textPlugin(),
      createSource: () =>
        createSource(new TextEncoder().encode("before"), {
          name: "document.txt",
          mimeType: "text/plain",
        }),
    }),
    verifyDocument({ session }) {
      if (read(session) !== "before") throw new Error("Expected initial text");
    },
    fingerprint: ({ session }) => read(session),
    editing: {
      change: ({ session }, options) =>
        editor(session).replace("after", options),
      noChange: ({ session }, options) =>
        editor(session).replace(read(session), options),
      verifyChanged({ session }) {
        if (read(session) !== "after") throw new Error("Expected changed text");
      },
      async verifyOutput({ output, expectedFingerprint }) {
        if (
          new TextDecoder().decode(await output.source.read()) !==
          expectedFingerprint
        ) {
          throw new Error("Unexpected serialized text");
        }
      },
    },
  };
}
