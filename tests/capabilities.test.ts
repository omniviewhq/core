import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import {
  defineCapability,
  type PluginDocument,
  provideCapability,
} from "../src/sdk/index.ts";
import { fixturePlugin } from "./support/fixtures.ts";

const text = defineCapability<{ getText(): string }>("example.text:content");
const source = createSource(new Blob(["hello"]));

test.each(["index", "iterator"] as const)(
  "normalizes failures from a capability array %s",
  async (stage) => {
    const entries: never[] = [];
    if (stage === "index")
      Object.defineProperty(entries, "0", {
        get() {
          throw null;
        },
      });
    else
      entries[Symbol.iterator] = () => {
        throw null;
      };
    const core = createOmniview({
      plugins: [fixturePlugin({ open: () => ({ capabilities: entries }) })],
    });
    const session = core.createSession(source);
    await expect(session.load()).rejects.toMatchObject({
      code: "PLUGIN_FAILED",
      cause: null,
      context: { pluginId: "fixture/text" },
    });
    expect(session.getSnapshot().status).toBe("error");
    await core.dispose();
  },
);

test("rejects promise-like capability collections instead of assimilating them", async () => {
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open: () =>
          ({ capabilities: Promise.resolve([]) }) as unknown as PluginDocument,
      }),
    ],
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "INVALID_CAPABILITY",
  });
  await core.dispose();
});

test("wraps failures while inspecting the result and cleans acquired resources", async () => {
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ onDispose }) {
          onDispose(() => {
            cleaned++;
          });
          return {
            get capabilities(): never {
              throw null;
            },
          };
        },
      }),
    ],
  });
  const session = core.createSession(source);
  await expect(session.load()).rejects.toMatchObject({
    code: "PLUGIN_FAILED",
    cause: null,
  });
  expect(session.getSnapshot()).toMatchObject({ status: "error" });
  expect(cleaned).toBe(1);
  await core.dispose();
});

test.each(["document", "entry"] as const)(
  "disposal reentered from %s capability inspection remains terminal",
  async (stage) => {
    const core = createOmniview({
      plugins: [
        fixturePlugin({
          open() {
            if (stage === "document")
              return {
                get capabilities() {
                  void session.dispose();
                  return [];
                },
              };
            return {
              capabilities: [
                {
                  key: text,
                  get value() {
                    void session.dispose();
                    return { getText: () => "late" };
                  },
                },
              ],
            };
          },
        }),
      ],
    });
    const session = core.createSession(source);
    await expect(session.load()).rejects.toMatchObject({ code: "CANCELLED" });
    expect(session.getSnapshot().status).toBe("disposed");
    expect(core.getSessions()).toEqual([]);
    await core.dispose();
  },
);

test("exposes typed capabilities by canonical ID during the session lifetime", async () => {
  const value = { getText: () => "hello" };
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open: () => ({ capabilities: [provideCapability(text, value)] }),
      }),
    ],
  });
  const session = core.createSession(source);
  expect(() => session.getCapability(text)).toThrow(
    expect.objectContaining({ code: "SESSION_NOT_READY" }),
  );
  await session.load();
  expect(
    session.getCapability(defineCapability<{ getText(): string }>(text.id)),
  ).toBe(value);
  expect(session.getCapability(text)?.getText()).toBe("hello");
  expect(
    session.getCapability(defineCapability("other:missing")),
  ).toBeUndefined();
  await session.dispose();
  expect(() => session.getCapability(text)).toThrow(
    expect.objectContaining({ code: "SESSION_CLOSED" }),
  );
  await core.dispose();
});

test.each([
  {
    capabilities: [
      provideCapability(text, { getText: () => "a" }),
      provideCapability(text, { getText: () => "b" }),
    ],
    code: "CAPABILITY_CONFLICT",
  },
  {
    capabilities: [{ key: { id: "bad" }, value: {} }],
    code: "INVALID_CAPABILITY",
  },
  { capabilities: [{ key: text, value: null }], code: "INVALID_CAPABILITY" },
  { capabilities: [null], code: "INVALID_CAPABILITY" },
  { capabilities: {}, code: "INVALID_CAPABILITY" },
])(
  "validates capabilities before readiness %j",
  async ({ capabilities, code }) => {
    const core = createOmniview({
      plugins: [
        fixturePlugin({
          open: () => ({ capabilities }) as unknown as PluginDocument,
        }),
      ],
    });
    const session = core.createSession(source);
    await expect(session.load()).rejects.toMatchObject({ code });
    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: { code },
    });
    await core.dispose();
  },
);
