import { expect, test } from "bun:test";
import {
  createOmniview,
  createSource,
  type ReadableSource,
} from "../src/index.ts";
import { defineCapability, provideCapability } from "../src/sdk/index.ts";
import { deferred, fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["a"]));

test("isolates documents and keeps frozen membership stable between changes", async () => {
  const key = defineCapability<{ text(): string }>("fixture:text");
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        async open({ source, signal }) {
          const text = new TextDecoder().decode(await source.read({ signal }));
          return {
            capabilities: [provideCapability(key, { text: () => text })],
          };
        },
      }),
    ],
  });
  const empty = core.getSessions();
  expect(Object.isFrozen(empty)).toBe(true);
  expect(core.getSessions()).toBe(empty);
  const a = await core.open(createSource(new Blob(["alpha"])));
  const membership = core.getSessions();
  expect(core.getSessions()).toBe(membership);
  const b = await core.open(createSource(new Blob(["beta"])));
  expect(core.getSessions()).not.toBe(membership);
  expect(a.id).not.toBe(b.id);
  expect(a.getCapability(key)?.text()).toBe("alpha");
  expect(b.getCapability(key)?.text()).toBe("beta");
  a.subscribe(() => {
    if (a.getSnapshot().status === "disposed")
      expect(core.getSessions()).toEqual([b]);
  });
  await a.dispose();
  expect(b.getCapability(key)?.text()).toBe("beta");
  await core.dispose();
  expect(b.getSnapshot().status).toBe("disposed");
});

test("closes before callbacks, awaits every session, and shares core disposal", async () => {
  const finished = deferred<void>();
  const released = deferred<void>();
  let attempts = 0;
  let reentrant: Promise<void> | undefined;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open() {
          return {
            async dispose() {
              attempts++;
              reentrant = core.dispose();
              expect(() => core.createSession(source)).toThrow(
                expect.objectContaining({ code: "CORE_CLOSED" }),
              );
              if (attempts === 1) throw new Error("cleanup failure");
              await released.promise;
              finished.resolve();
            },
          };
        },
      }),
    ],
  });
  const a = await core.open(source);
  const b = await core.open(source);
  const disposing = core.dispose();
  const outcome = disposing.catch((error: unknown) => error);
  expect(core.dispose()).toBe(disposing);
  expect(() => core.createSession(source)).toThrow(
    expect.objectContaining({ code: "CORE_CLOSED" }),
  );
  released.resolve();
  await finished.promise;
  expect(await outcome).toMatchObject({ code: "CLEANUP_FAILED" });
  expect(reentrant).toBe(disposing);
  expect(attempts).toBe(2);
  expect([a, b].map((session) => session.getSnapshot().status)).toEqual([
    "disposed",
    "disposed",
  ]);
  await expect(core.open(source)).rejects.toMatchObject({
    code: "CORE_CLOSED",
  });
});

test("removes failed convenience opens while retaining explicit failed sessions", async () => {
  const core = createOmniview({ plugins: [] });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "UNSUPPORTED_SOURCE",
  });
  expect(core.getSessions()).toEqual([]);
  const session = core.createSession(source);
  const loading = session.load();
  await expect(loading).rejects.toMatchObject({ code: "UNSUPPORTED_SOURCE" });
  expect(session.load()).toBe(loading);
  expect(core.getSessions()).toEqual([session]);
  expect(session.getSnapshot()).toMatchObject({ status: "error" });
  await core.dispose();
});

test("separate core instances own independent closures and lifetimes", async () => {
  const plugin = fixturePlugin();
  const a = createOmniview({ plugins: [plugin] });
  const b = createOmniview({ plugins: [plugin] });
  const first = await a.open(source);
  const second = await b.open(source);
  await a.dispose();
  expect(first.getSnapshot().status).toBe("disposed");
  expect(second.getSnapshot().status).toBe("ready");
  await b.dispose();
});

test.each([
  null,
  {},
  { name: " ", size: 1, mimeType: "x", read() {} },
  { name: "a", size: -1, mimeType: "x", read() {} },
  { name: "a", size: 0.5, mimeType: "x", read() {} },
  { name: "a", size: 1, mimeType: 1, read() {} },
  { name: "a", size: 1, mimeType: "x", read: 1 },
])("validates custom readable sources %j", (input) => {
  const core = createOmniview({ plugins: [] });
  expect(() => core.createSession(input as unknown as ReadableSource)).toThrow(
    expect.objectContaining({ code: "INVALID_SOURCE" }),
  );
  expect(core.getSessions()).toEqual([]);
});
