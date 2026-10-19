import { expect, test } from "bun:test";
import {
  type CoreOptions,
  createOmniview,
  createSource,
  OmniviewError,
  type SessionOptions,
} from "../src/index.ts";
import type { EditingDefinition } from "../src/sdk/index.ts";
import { fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["a"]));

test("wraps even a plugin-owned structured error from the capture getter", async () => {
  const cause = new OmniviewError("INVALID_SOURCE", "plugin getter");
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open: () => ({
          editing: {
            get capture(): never {
              throw cause;
            },
          },
        }),
      }),
    ],
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "PLUGIN_FAILED",
    cause,
    context: {
      pluginId: "fixture/text",
      sessionId: "session-1",
      sourceName: "document",
    },
  });
  await core.dispose();
});
const editable = fixturePlugin({
  open: () => ({
    editing: {
      capture: () => ({ serialize: () => ({ data: new Blob(["a"]) }) }),
    },
  }),
});

test("separates plugin editing support from host policy", async () => {
  const core = createOmniview({ plugins: [editable] });
  const session = await core.open(source);
  const initial = session.getSnapshot();
  expect(initial).toMatchObject({
    status: "ready",
    editing: {
      supported: true,
      readOnly: true,
      busy: false,
      revision: "0",
      persistedRevision: "0",
      dirty: false,
    },
  });
  session.setReadOnly(false);
  const enabled = session.getSnapshot();
  expect(enabled).toMatchObject({ editing: { readOnly: false } });
  session.setReadOnly(false);
  expect(session.getSnapshot()).toBe(enabled);
  expect(initial).not.toBe(enabled);
  if (enabled.status !== "ready") throw new Error("Expected ready");
  expect(Object.isFrozen(enabled.editing)).toBe(true);
  await core.dispose();
});

test.each([
  [undefined, undefined, true],
  [false, undefined, false],
  [true, false, false],
  [false, true, true],
] as const)(
  "resolves core %j and session %j policy to %j",
  async (corePolicy, sessionPolicy, expected) => {
    const core = createOmniview({
      plugins: [editable],
      ...(corePolicy === undefined ? {} : { readOnly: corePolicy }),
    });
    const session = await core.open(
      source,
      sessionPolicy === undefined ? {} : { readOnly: sessionPolicy },
    );
    expect(session.getSnapshot()).toMatchObject({
      editing: { readOnly: expected },
    });
    await core.dispose();
  },
);

test("snapshots caller policy objects and reads their getters once", async () => {
  const defaults = { plugins: [editable], readOnly: false };
  const core = createOmniview(defaults);
  defaults.readOnly = true;
  let reads = 0;
  const options = {
    get readOnly() {
      reads++;
      return false;
    },
  };
  const session = core.createSession(source, options);
  await session.load();
  expect(reads).toBe(1);
  expect(session.getSnapshot()).toMatchObject({ editing: { readOnly: false } });
  await core.dispose();
});

test.each([null, 0, "false"])(
  "rejects malformed host policy %j",
  async (value) => {
    expect(() =>
      createOmniview({
        plugins: [],
        readOnly: value,
      } as unknown as CoreOptions),
    ).toThrow(expect.objectContaining({ code: "INVALID_OPTIONS" }));
    const core = createOmniview({ plugins: [editable] });
    expect(() =>
      core.createSession(source, {
        readOnly: value,
      } as unknown as SessionOptions),
    ).toThrow(expect.objectContaining({ code: "INVALID_OPTIONS" }));
    expect(core.getSessions()).toEqual([]);
    const session = await core.open(source);
    expect(() => session.setReadOnly(value as unknown as boolean)).toThrow(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
    await core.dispose();
  },
);

test.each([null, [], {}, { capture: 1 }])(
  "rejects malformed editing definitions %j and cleans results",
  async (definition) => {
    let cleaned = 0;
    const core = createOmniview({
      plugins: [
        fixturePlugin({
          open: () => ({
            editing: definition as unknown as EditingDefinition,
            dispose() {
              cleaned++;
            },
          }),
        }),
      ],
    });
    await expect(core.open(source)).rejects.toMatchObject({
      code: "INVALID_EDITING",
    });
    expect(cleaned).toBe(1);
    await core.dispose();
  },
);

test("normalizes an editing definition accessor failure", async () => {
  const definition = {
    get capture(): never {
      throw null;
    },
  };
  const core = createOmniview({
    plugins: [fixturePlugin({ open: () => ({ editing: definition }) })],
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "PLUGIN_FAILED",
    cause: null,
    context: { pluginId: "fixture/text" },
  });
  await core.dispose();
});

test("keeps viewer-only compatibility and policy guard precedence", async () => {
  const core = createOmniview({ plugins: [fixturePlugin()] });
  const session = core.createSession(source);
  expect(() => session.setReadOnly(false)).toThrow(
    expect.objectContaining({ code: "SESSION_NOT_READY" }),
  );
  await session.load();
  expect(session.getSnapshot()).toMatchObject({
    editing: { supported: false },
  });
  expect(() => session.setReadOnly(false)).toThrow(
    expect.objectContaining({ code: "EDITING_UNSUPPORTED" }),
  );
  await session.dispose();
  expect(() => session.setReadOnly(false)).toThrow(
    expect.objectContaining({ code: "SESSION_CLOSED" }),
  );
  await core.dispose();
});
