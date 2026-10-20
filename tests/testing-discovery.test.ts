import { expect, test } from "bun:test";
import { createSource } from "../src/index.ts";
import { definePlugin } from "../src/sdk/index.ts";
import type {
  PluginTestFixture,
  PluginTestSuiteOptions,
} from "../src/testing/index.ts";
import { createPluginTestSuite } from "../src/testing/index.ts";

function options(): PluginTestSuiteOptions<PluginTestFixture> {
  return {
    id: "viewer.config",
    editing: false,
    createFixture: () => ({
      plugin: definePlugin({
        id: "example/viewer",
        apiVersion: 1,
        supports: () => true,
        open: () => ({}),
      }),
      createSource: () => createSource(new Blob(["a"])),
    }),
    verifyDocument() {},
    fingerprint: () => "a",
  };
}

test.each([
  null,
  { id: "bad/id" },
  { editing: undefined },
  { createFixture: 1 },
  { fingerprint: false },
  { pauseLoad: 1 },
  { unsupported: {} },
  { unsupported: [{ id: "x", createSource: 1 }] },
  {
    unsupported: [
      { id: "x", createSource() {} },
      { id: "x", createSource() {} },
    ],
  },
])("rejects malformed suite configuration %j synchronously", (value) => {
  const configuration = value === null ? null : { ...options(), ...value };
  expect(() =>
    createPluginTestSuite(
      configuration as unknown as PluginTestSuiteOptions<PluginTestFixture>,
    ),
  ).toThrow(TypeError);
});

test("reads config getters once, preserves their cause, and snapshots topology", async () => {
  const cause = new Error("accessor");
  let caught: unknown;
  try {
    createPluginTestSuite({
      ...options(),
      get id(): never {
        throw cause;
      },
    });
  } catch (error) {
    caught = error;
  }
  expect((caught as Error).cause).toBe(cause);
  let reads = 0;
  let invoked = 0;
  const config = {
    ...options(),
    get verifyDocument() {
      reads++;
      return () => {
        invoked++;
      };
    },
  };
  const suite = createPluginTestSuite(config);
  Object.defineProperty(config, "verifyDocument", {
    value: () => {
      throw new Error("changed callback");
    },
  });
  const detection = suite.cases.find((check) =>
    check.id.endsWith("/open/detection"),
  );
  if (!detection) throw new Error("Missing case");
  await detection.run();
  expect([reads, invoked]).toEqual([1, 1]);
  expect(Object.isFrozen(suite)).toBe(true);
  expect(Object.isFrozen(suite.cases[0])).toBe(true);
  expect(Object.isFrozen(suite.omitted[0])).toBe(true);
});

test("every invocation creates an independent fixture, including concurrent reruns", async () => {
  let acquired = 0;
  let disposed = 0;
  const config = options();
  const suite = createPluginTestSuite({
    ...config,
    createFixture() {
      acquired++;
      return {
        plugin: definePlugin({
          id: "fresh/viewer",
          apiVersion: 1,
          supports: () => true,
          open: () => ({}),
        }),
        createSource: () => createSource(new Blob()),
        dispose() {
          disposed++;
        },
      };
    },
  });
  const detection = suite.cases.find((check) =>
    check.id.endsWith("/open/detection"),
  );
  if (!detection) throw new Error("Missing case");
  await Promise.all([detection.run(), detection.run()]);
  expect([acquired, disposed]).toEqual([2, 2]);
});

test("discovers frozen cases without creating fixtures and runs real detection", async () => {
  let calls = 0;
  let opened = 0;
  const suite = createPluginTestSuite({
    id: "viewer.basic",
    editing: false,
    createFixture() {
      calls++;
      return {
        plugin: definePlugin({
          id: "example/viewer",
          apiVersion: 1,
          supports: () => true,
          open: () => {
            opened++;
            return {};
          },
        }),
        createSource: () => createSource(new Blob(["a"])),
      };
    },
    verifyDocument() {},
    fingerprint: () => "a",
  });
  expect(calls).toBe(0);
  const check = suite.cases.find(
    (item) => item.id === "viewer.basic/open/detection",
  );
  if (!check) throw new Error("Missing detection case");
  expect(Object.isFrozen(suite.cases)).toBe(true);
  expect(suite.omitted.some((item) => item.id === "viewer.basic/editing")).toBe(
    true,
  );
  await check.run();
  expect([calls, opened]).toEqual([1, 1]);
});
