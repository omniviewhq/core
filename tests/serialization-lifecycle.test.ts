import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import type { SerializedData } from "../src/sdk/index.ts";
import { textPlugin } from "./support/editing-fixture.ts";
import { deferred } from "./support/fixtures.ts";

test.each(["pre", "capture", "queued", "encoder", "cleanup"] as const)(
  "cancels at %s while awaiting only capture cleanup",
  async (stage) => {
    const controller = new AbortController();
    const reason = new Error(stage);
    const encoding = deferred<SerializedData>();
    const started = deferred<void>();
    const cleanStarted = deferred<void>();
    const cleanGate = deferred<void>();
    let captures = 0;
    let encoders = 0;
    let cleaned = 0;
    const core = createOmniview({
      plugins: [
        textPlugin({
          capture: () => {
            captures++;
            if (stage === "capture") controller.abort(reason);
            return {
              serialize({ signal }) {
                encoders++;
                started.resolve();
                expect(signal.aborted).toBe(false);
                return stage === "cleanup"
                  ? { data: new Blob() }
                  : encoding.promise;
              },
              async dispose() {
                cleaned++;
                cleanStarted.resolve();
                if (stage === "cleanup") await cleanGate.promise;
              },
            };
          },
        }),
      ],
    });
    const session = await core.open(createSource(new Blob(["a"])));
    if (stage === "pre") controller.abort(reason);
    const outcome = session
      .serialize({ signal: controller.signal })
      .catch((error: unknown) => error);
    if (stage === "queued") controller.abort(reason);
    if (stage === "encoder") {
      await started.promise;
      controller.abort(reason);
    }
    if (stage === "cleanup") {
      await cleanStarted.promise;
      controller.abort(reason);
      cleanGate.resolve();
    }
    expect(await outcome).toMatchObject({ code: "CANCELLED", cause: reason });
    expect(captures).toBe(stage === "pre" ? 0 : 1);
    expect(cleaned).toBe(captures);
    expect(encoders).toBe(stage === "encoder" || stage === "cleanup" ? 1 : 0);
    if (stage === "encoder") encoding.reject(new Error("late encoding"));
    await core.dispose();
  },
);

test("completed callers cannot cancel later tickets or their session", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])));
  const controller = new AbortController();
  const first = await session.serialize({ signal: controller.signal });
  const second = session.serialize();
  controller.abort("late");
  expect((await second).revision).toBe("0");
  expect((await first.source.read()).length).toBe(1);
  expect(session.getSnapshot().status).toBe("ready");
  await core.dispose();
});

test("session claims capture failure before a blocked later LIFO cleanup", async () => {
  const errors: unknown[] = [];
  const gate = deferred<void>();
  const laterStarted = deferred<void>();
  const encodeStarted = deferred<void>();
  const never = deferred<SerializedData>();
  let register!: (cleanup: () => Promise<void>) => () => void;
  let cleaned = 0;
  const plugin = textPlugin({
    capture: () => ({
      serialize() {
        encodeStarted.resolve();
        return never.promise;
      },
      dispose() {
        cleaned++;
        throw new Error("capture cleanup");
      },
    }),
  });
  const core = createOmniview({
    onError: (error) => errors.push(error),
    plugins: [
      {
        ...plugin,
        open(context) {
          register = context.onDispose;
          return plugin.open(context);
        },
      },
    ],
  });
  const session = await core.open(createSource(new Blob(["a"])));
  const result = session.serialize().catch((error: unknown) => error);
  await encodeStarted.promise;
  register(async () => {
    laterStarted.resolve();
    await gate.promise;
  });
  const disposal = session.dispose().catch((error: unknown) => error);
  await laterStarted.promise;
  expect(await result).toMatchObject({ code: "CANCELLED" });
  expect(errors).toEqual([]);
  expect(cleaned).toBe(1);
  gate.resolve();
  expect(await disposal).toMatchObject({ code: "CLEANUP_FAILED" });
  expect(errors).toEqual([]);
  expect(cleaned).toBe(1);
  never.resolve({ data: new Blob() });
  await core.dispose();
});

test("cleanup can initiate owner disposal without waiting on itself", async () => {
  let session!: import("../src/index.ts").DocumentSession;
  let reentrant: Promise<void> | undefined;
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture: () => ({
          serialize: () => ({ data: new Blob() }),
          dispose() {
            cleaned++;
            reentrant = session.dispose();
          },
        }),
      }),
    ],
  });
  session = await core.open(createSource(new Blob(["a"])));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "CANCELLED",
  });
  if (!reentrant) throw new Error("Expected reentrant disposal");
  expect(session.dispose()).toBe(reentrant);
  await reentrant;
  expect(cleaned).toBe(1);
  await core.dispose();
});

test("a capture returned after reentrant disposal has only local cleanup ownership", async () => {
  const errors: unknown[] = [];
  let cleaned = 0;
  let session!: import("../src/index.ts").DocumentSession;
  const core = createOmniview({
    onError: (error) => errors.push(error),
    plugins: [
      textPlugin({
        capture: () => ({
          get serialize() {
            void session.dispose();
            return () => {
              throw new Error("must not encode");
            };
          },
          dispose() {
            cleaned++;
            throw new Error("late cleanup");
          },
        }),
      }),
    ],
  });
  session = await core.open(createSource(new Blob(["a"])));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "CANCELLED",
  });
  await session.dispose();
  expect(cleaned).toBe(1);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ code: "CLEANUP_FAILED" });
  await core.dispose();
});

test("rechecks lifetime after a caller signal getter closes the session", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])));
  const operation = session.serialize({
    get signal() {
      void session.dispose();
      return new AbortController().signal;
    },
  });
  await expect(operation).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  await core.dispose();
});

test("disposes known capture resources without awaiting ignored encoding", async () => {
  const started = deferred<void>();
  const encoded = deferred<SerializedData>();
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture: () => ({
          serialize() {
            started.resolve();
            return encoded.promise;
          },
          dispose() {
            cleaned++;
          },
        }),
      }),
    ],
  });
  const session = await core.open(createSource(new Blob(["a"])));
  const outcome = session.serialize().catch((error: unknown) => error);
  await started.promise;
  await session.dispose();
  expect(await outcome).toMatchObject({ code: "CANCELLED" });
  expect(cleaned).toBe(1);
  encoded.reject(new Error("late encoder rejection is observed"));
  await core.dispose();
  expect(session.getSnapshot().status).toBe("disposed");
  expect(cleaned).toBe(1);
});
