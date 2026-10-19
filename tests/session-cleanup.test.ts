import { expect, test } from "bun:test";
import {
  createOmniview,
  createSource,
  type OmniviewError,
} from "../src/index.ts";
import type { Cleanup } from "../src/sdk/index.ts";
import { deferred, fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["a"]));

test("captures a result cleanup accessor once", async () => {
  let reads = 0;
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open: () => ({
          get dispose() {
            reads++;
            return () => {
              cleaned++;
            };
          },
        }),
      }),
    ],
  });
  const session = await core.open(source);
  expect(reads).toBe(1);
  await session.dispose();
  expect(cleaned).toBe(1);
  await core.dispose();
});

test("disposal takes ownership before cleanup or disposed observers can unregister resources", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  let unregister!: () => void;
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ onDispose }) {
          unregister = onDispose(() => {
            cleaned++;
          });
          return {
            async dispose() {
              entered.resolve();
              await release.promise;
            },
          };
        },
      }),
    ],
  });
  const session = await core.open(source);
  session.subscribe(() => {
    if (session.getSnapshot().status === "disposed") unregister();
  });
  const disposing = session.dispose();
  await entered.promise;
  unregister();
  release.resolve();
  await disposing;
  expect(cleaned).toBe(1);
  await core.dispose();
});

test("convenience open retains its primary error when an error observer disposes reentrantly", async () => {
  const errors: OmniviewError[] = [];
  const cause = new Error("primary");
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ onDispose }) {
          const session = core.getSessions()[0];
          session?.subscribe(() => {
            if (session.getSnapshot().status === "error")
              void session.dispose().catch(() => {});
          });
          onDispose(() => {
            throw new Error("secondary");
          });
          throw cause;
        },
      }),
    ],
    onError: (error) => errors.push(error),
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "PLUGIN_FAILED",
    cause,
  });
  expect(core.getSessions()).toEqual([]);
  expect(errors.map((error) => error.code)).toEqual(["CLEANUP_FAILED"]);
  await core.dispose();
});

test("awaits LIFO cleanup, preserves result context, and shares reentrant disposal", async () => {
  const calls: string[] = [];
  const waiting = deferred<void>();
  let reentrant: Promise<void> | undefined;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ onDispose }) {
          const same = () => {
            calls.push("same");
          };
          onDispose(same);
          onDispose(same);
          const unregister = onDispose(() => {
            calls.push("removed");
          });
          unregister();
          unregister();
          onDispose(async () => {
            calls.push("waiting");
            await waiting.promise;
            calls.push("finished");
          });
          const result = {
            tag: "result",
            dispose() {
              calls.push(this.tag);
              reentrant = session.dispose();
            },
          };
          return result;
        },
      }),
    ],
  });
  const session = await core.open(source);
  const disposing = session.dispose();
  expect(session.getSnapshot().status).toBe("disposed");
  expect(core.getSessions()).toEqual([]);
  waiting.resolve();
  await disposing;
  expect(reentrant).toBe(disposing);
  expect(session.dispose()).toBe(disposing);
  expect(calls).toEqual(["result", "waiting", "finished", "same", "same"]);
  await core.dispose();
});

test("attempts all cleanup and aggregates explicit disposal failures", async () => {
  const first = new Error("first");
  const last = new Error("last");
  const calls: string[] = [];
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ onDispose }) {
          onDispose(() => {
            calls.push("first");
            throw first;
          });
          onDispose(() => {
            calls.push("middle");
          });
          return {
            dispose() {
              calls.push("last");
              return Promise.reject(last);
            },
          };
        },
      }),
    ],
  });
  const session = await core.open(source);
  const error = await session.dispose().catch((reason: unknown) => reason);
  if (!(error instanceof Error) || !(error.cause instanceof AggregateError))
    throw new Error("missing aggregate");
  expect(error).toMatchObject({ code: "CLEANUP_FAILED" });
  expect(error.cause.errors).toEqual([last, first]);
  expect(calls).toEqual(["last", "middle", "first"]);
  await core.dispose();
});

test("preserves load errors and reports secondary cleanup exactly once", async () => {
  const errors: OmniviewError[] = [];
  const cause = new Error("open");
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ onDispose }) {
          onDispose(() => {
            throw new Error("cleanup");
          });
          throw cause;
        },
      }),
    ],
    onError: (error) => errors.push(error),
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "PLUGIN_FAILED",
    cause,
  });
  await core.dispose();
  expect(errors.map((error) => error.code)).toEqual(["CLEANUP_FAILED"]);
});

test("cleans a result when capability validation fails", async () => {
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open: () => ({
          capabilities: [null] as never,
          dispose() {
            cleaned++;
          },
        }),
      }),
    ],
  });
  await expect(core.open(source)).rejects.toMatchObject({
    code: "INVALID_CAPABILITY",
  });
  expect(cleaned).toBe(1);
  await core.dispose();
  expect(cleaned).toBe(1);
});

test("runs late registrations asynchronously and reports their failures", async () => {
  let register!: (cleanup: Cleanup) => () => void;
  const diagnostic = deferred<OmniviewError>();
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ onDispose }) {
          register = onDispose;
          return {};
        },
      }),
    ],
    onError: (error) => diagnostic.resolve(error),
  });
  const session = await core.open(source);
  await session.dispose();
  let called = false;
  const unregister = register(() => {
    called = true;
    throw new Error("late");
  });
  expect(called).toBe(false);
  expect(await diagnostic.promise).toMatchObject({ code: "CLEANUP_FAILED" });
  unregister();
  unregister();
  await core.dispose();
});
