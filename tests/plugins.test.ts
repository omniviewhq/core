import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import type { PluginDefinition } from "../src/sdk/index.ts";
import { deferred, fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["a"]), { name: "a.txt" });

test("awaits probes in order and stops at the first match", async () => {
  const probe = deferred<boolean>();
  const started = deferred<void>();
  const calls: string[] = [];
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        id: "first",
        supports() {
          calls.push("first");
          started.resolve();
          return probe.promise;
        },
      }),
      fixturePlugin({
        id: "second",
        supports() {
          calls.push("second");
          return true;
        },
      }),
    ],
  });
  const session = core.createSession(source);
  const loading = session.load();
  await started.promise;
  expect(calls).toEqual(["first"]);
  probe.resolve(true);
  await loading;
  expect(calls).toEqual(["first"]);
  await core.dispose();
});

test("explicit selection bypasses all probes", async () => {
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        supports() {
          throw new Error("must bypass");
        },
      }),
    ],
  });
  const session = await core.open(source, { pluginId: "fixture/text" });
  expect(session.getSnapshot()).toMatchObject({
    status: "ready",
    pluginId: "fixture/text",
  });
  await expect(
    core.open(source, { pluginId: "missing" }),
  ).rejects.toMatchObject({ code: "PLUGIN_NOT_FOUND" });
  await core.dispose();
});

test.each([
  null,
  {},
  { id: 2 },
  { id: "x", apiVersion: 2, supports() {}, open() {} },
  { id: "x", apiVersion: 1, supports: 1, open() {} },
  { id: "x", apiVersion: 1, supports() {}, open: null },
])("rejects malformed JavaScript registrations %j", (plugin) => {
  expect(() =>
    createOmniview({ plugins: [plugin as unknown as PluginDefinition] }),
  ).toThrow(expect.objectContaining({ code: "INVALID_PLUGIN" }));
});

test.each(["supports", "open"] as const)(
  "wraps asynchronous %s failures without fallback",
  async (method) => {
    const cause = new Error("async failure");
    let fallback = false;
    const core = createOmniview({
      plugins: [
        fixturePlugin({ [method]: () => Promise.reject(cause) }),
        fixturePlugin({
          id: "fallback",
          supports() {
            fallback = true;
            return true;
          },
        }),
      ],
    });
    await expect(core.open(source)).rejects.toMatchObject({
      code: "PLUGIN_FAILED",
      cause,
      context: {
        pluginId: "fixture/text",
        sourceName: "a.txt",
        sessionId: "session-1",
      },
    });
    expect(fallback).toBe(false);
    await core.dispose();
  },
);

test.each([null, false, 123, [], { dispose: false }])(
  "rejects malformed open results %j",
  async (result) => {
    const core = createOmniview({
      plugins: [
        fixturePlugin({
          open: (() => result) as unknown as PluginDefinition["open"],
        }),
      ],
    });
    await expect(core.open(source)).rejects.toMatchObject({
      code: "PLUGIN_FAILED",
      cause: expect.any(TypeError),
    });
    await core.dispose();
  },
);

test("rejects nonboolean detection results", async () => {
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        supports: (() => "yes") as unknown as PluginDefinition["supports"],
      }),
    ],
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "PLUGIN_FAILED",
    cause: expect.any(TypeError),
  });
  await core.dispose();
});
