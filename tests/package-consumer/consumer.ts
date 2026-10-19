import { createOmniview, createSource, OmniviewError } from "@omniview/core";
import {
  defineCapability,
  definePlugin,
  OmniviewError as PluginError,
  provideCapability,
} from "@omniview/core/sdk";

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
