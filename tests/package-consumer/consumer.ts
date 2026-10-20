import { createOmniview, createSource, OmniviewError } from "@omniview/core";
import {
  defineCapability,
  definePlugin,
  type EditOptions,
  OmniviewError as PluginError,
  provideCapability,
} from "@omniview/core/sdk";
import {
  createPluginTestSuite,
  PluginConformanceError,
} from "@omniview/core/testing";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  OmniviewError === PluginError,
  "Public entries must share the error class",
);
const textContent = defineCapability<{ getText(): string }>("consumer:text");
const cleanup: string[] = [];
const plugin = definePlugin({
  id: "consumer/text",
  apiVersion: 1,
  supports: () => true,
  async open({ source, signal, onDispose }) {
    const text = new TextDecoder().decode(await source.read({ signal }));
    onDispose(() => {
      cleanup.push("resource");
    });
    return {
      capabilities: [provideCapability(textContent, { getText: () => text })],
      dispose() {
        cleanup.push("document");
      },
    };
  },
});
const core = createOmniview({ plugins: [plugin] });
const session = core.createSession(createSource(new Blob(["packed consumer"])));
const states: string[] = [];
session.subscribe(() => states.push(session.getSnapshot().status));
await session.load();
const capability = session.getCapability(textContent);
assert(capability, "The typed capability must cross the SDK/root boundary");
const text: string = capability.getText();
assert(text === "packed consumer", "The plugin must read the source bytes");
await core.dispose();
assert(
  states.join() === "loading,ready,disposed",
  "The host must observe load and disposal",
);
assert(
  cleanup.join() === "document,resource",
  "The core must await owned cleanup",
);
assert(
  session.getSnapshot().status === "disposed",
  "Disposal must be terminal",
);

const cause = new PluginError("INVALID_SOURCE", "Plugin-owned error");
const failing = createOmniview({
  plugins: [
    definePlugin({
      id: "consumer/failure",
      apiVersion: 1,
      supports: () => true,
      open() {
        throw cause;
      },
    }),
  ],
});
try {
  await failing.open(createSource(new Blob(["failure"])));
  throw new Error("Expected the plugin failure to reject");
} catch (error) {
  assert(
    error instanceof OmniviewError,
    "Plugin failures must use the root error class",
  );
  assert(
    error instanceof PluginError,
    "Plugin failures must use the SDK error class",
  );
  assert(
    error.code === "PLUGIN_FAILED",
    "Plugin failures must retain their category",
  );
  assert(
    error.cause === cause,
    "Plugin failures must retain their original cause",
  );
} finally {
  await failing.dispose();
}

const editableText = defineCapability<{
  read(): string;
  replace(value: string, options?: EditOptions): Promise<void>;
}>("consumer:editable-text");
const editablePlugin = definePlugin({
  id: "consumer/editable-text",
  apiVersion: 1,
  supports: () => true,
  async open({ source, signal, edit }) {
    let text = new TextDecoder().decode(await source.read({ signal }));
    return {
      capabilities: [
        provideCapability(editableText, {
          read: () => text,
          replace: (next, options) =>
            edit(async ({ commit }) => {
              await Promise.resolve();
              commit(() => {
                const changed = next !== text;
                text = next;
                return { changed, value: undefined };
              });
            }, options),
        }),
      ],
      editing: {
        capture() {
          const captured = text;
          return {
            serialize: () => ({ data: new TextEncoder().encode(captured) }),
          };
        },
      },
    };
  },
});
const editingCore = createOmniview({ plugins: [editablePlugin] });
try {
  const managed = await editingCore.open(createSource(new Blob(["before"])), {
    readOnly: false,
  });
  const api = managed.getCapability(editableText);
  assert(api, "Editable capability must retain its public type");
  await api.replace("after");
  const output = await managed.serialize();
  const revision: string = output.revision;
  assert(revision === "1", "Async edit must advance the revision");
  assert(
    new TextDecoder().decode(await output.source.read()) === "after",
    "Output bytes must match the capture",
  );
  const dirty = managed.getSnapshot();
  assert(
    dirty.status === "ready" && dirty.editing.supported && dirty.editing.dirty,
    "Encoding alone must not mark persisted",
  );
  managed.markPersisted(output);
  const clean = managed.getSnapshot();
  assert(
    clean.status === "ready" && clean.editing.supported && !clean.editing.dirty,
    "Host acknowledgement must mark this revision clean",
  );
  managed.setReadOnly(true);
  try {
    await api.replace("denied");
    throw new Error("Expected read-only denial");
  } catch (error) {
    assert(
      error instanceof OmniviewError && error.code === "READ_ONLY",
      "Retained capability must use core policy and shared error identity",
    );
  }
} finally {
  await editingCore.dispose();
}

let fixturesCreated = 0;
let fixturesDisposed = 0;
const conformance = createPluginTestSuite({
  id: "consumer.text",
  createFixture() {
    fixturesCreated++;
    return {
      plugin: editablePlugin,
      createSource: () => createSource(new Blob(["before"])),
      dispose() {
        fixturesDisposed++;
      },
    };
  },
  verifyDocument({ session }) {
    assert(
      session.getCapability(editableText)?.read() === "before",
      "Expected initial fixture content",
    );
  },
  fingerprint({ session }) {
    const api = session.getCapability(editableText);
    assert(api, "Missing editable API");
    return api.read();
  },
  editing: {
    async change({ session }, options) {
      const api = session.getCapability(editableText);
      assert(api, "Missing editable API");
      await api.replace("after", options);
    },
    verifyChanged({ session }) {
      assert(
        session.getCapability(editableText)?.read() === "after",
        "Expected actual changed content",
      );
    },
    async verifyOutput({ output, expectedFingerprint }) {
      assert(
        new TextDecoder().decode(await output.source.read()) ===
          expectedFingerprint,
        "Expected captured serialized content",
      );
    },
  },
});
assert(fixturesCreated === 0, "Discovery must not invoke fixture factories");
for (const check of conformance.cases) await check.run();
assert(
  fixturesCreated === conformance.cases.length &&
    fixturesDisposed === fixturesCreated,
  "Each case must own its fixture",
);
assert(
  conformance.omitted.some((item) => item.id.endsWith("/editing/pending")),
  "Unavailable checks must be reported",
);
const broken = createPluginTestSuite({
  id: "consumer.broken",
  createFixture: () => ({
    plugin,
    createSource: () => createSource(new Blob()),
  }),
  verifyDocument() {
    throw null;
  },
  fingerprint: () => "",
  editing: false,
});
try {
  await broken.cases[0]?.run();
  throw new Error("Expected conformance failure");
} catch (error) {
  assert(
    error instanceof PluginConformanceError && error.cause === null,
    "Packed testing entry must preserve error identity and cause",
  );
}
