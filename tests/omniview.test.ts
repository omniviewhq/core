import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import type { PluginDefinition } from "../src/sdk/index.ts";
import { fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["hello"], { type: "text/plain" }), {
  name: "notes.txt",
});

test("selects the first supporting plugin in registration order", async () => {
  const core = createOmniview({
    plugins: [
      fixturePlugin({ id: "image", supports: () => false }),
      fixturePlugin({ id: "text" }),
      fixturePlugin({
        id: "unused",
        open() {
          throw new Error("wrong plugin");
        },
      }),
    ],
  });
  const session = await core.open(source);
  expect(session.getSnapshot()).toMatchObject({
    status: "ready",
    pluginId: "text",
  });
  await core.dispose();
});

test("rejects unsupported sources including an empty registry", async () => {
  const empty = createOmniview({ plugins: [] });
  await expect(empty.open(source)).rejects.toMatchObject({
    code: "UNSUPPORTED_SOURCE",
  });
  const core = createOmniview({
    plugins: [fixturePlugin({ supports: () => false })],
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "UNSUPPORTED_SOURCE",
  });
  await core.dispose();
  await empty.dispose();
});

test("snapshots the registration list and preserves callback context", async () => {
  const plugin: PluginDefinition = {
    id: "context",
    apiVersion: 1,
    supports(context) {
      expect(this.id).toBe("context");
      expect(context.source).toBe(source);
      return true;
    },
    open(context) {
      expect(this.id).toBe("context");
      expect(context.source).toBe(source);
      return {};
    },
  };
  const plugins = [plugin];
  const core = createOmniview({ plugins });
  plugins.length = 0;
  await core.open(source);
  await core.dispose();
});

test.each(["", " ", "\n"])("rejects empty plugin IDs: %j", (id) => {
  expect(() => createOmniview({ plugins: [fixturePlugin({ id })] })).toThrow(
    "Plugin id must not be empty",
  );
});

test("rejects duplicate plugin IDs", () => {
  expect(() =>
    createOmniview({ plugins: [fixturePlugin(), fixturePlugin()] }),
  ).toThrow("Duplicate plugin id");
});

test.each(["supports", "open"] as const)(
  "retains %s failures as structured causes",
  async (method) => {
    const cause = new Error("parser failed");
    const plugin = fixturePlugin({
      [method]: () => {
        throw cause;
      },
    });
    const core = createOmniview({ plugins: [plugin] });
    await expect(core.open(source)).rejects.toMatchObject({
      code: "PLUGIN_FAILED",
      cause,
      context: {
        pluginId: "fixture/text",
        sourceName: "notes.txt",
        sessionId: "session-1",
      },
    });
    await core.dispose();
  },
);
