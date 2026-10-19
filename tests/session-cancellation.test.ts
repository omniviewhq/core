import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import type { PluginDocument } from "../src/sdk/index.ts";
import { deferred, fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["a"]));

test("caller cancellation from a ready observer cannot abort a ready document", async () => {
  const external = new AbortController();
  let retained!: AbortSignal;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ signal }) {
          retained = signal;
          return {};
        },
      }),
    ],
  });
  const session = core.createSession(source);
  session.subscribe(() => {
    if (session.getSnapshot().status === "ready")
      external.abort("already ready");
  });
  await session.load({ signal: external.signal });
  expect(retained.aborted).toBe(false);
  await core.dispose();
});

test("disposes without waiting for open and cleans its late result exactly once", async () => {
  const started = deferred<void>();
  const result = deferred<PluginDocument>();
  const cleaned = deferred<void>();
  let calls = 0;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open() {
          started.resolve();
          return result.promise;
        },
      }),
    ],
  });
  const session = core.createSession(source);
  const outcome = session.load().catch((error: unknown) => error);
  await started.promise;
  await session.dispose();
  expect(await outcome).toMatchObject({ code: "CANCELLED" });
  result.resolve({
    dispose() {
      calls++;
      cleaned.resolve();
    },
  });
  await cleaned.promise;
  expect(calls).toBe(1);
  expect(session.getSnapshot().status).toBe("disposed");
  await core.dispose();
});

test.each(["before", "probe", "open", "queued"] as const)(
  "cancels %s loading and retains its reason",
  async (stage) => {
    const controller = new AbortController();
    const reason = new Error("cancel");
    const started = deferred<void>();
    const probe = deferred<boolean>();
    const result = deferred<PluginDocument>();
    let probes = 0;
    let opens = 0;
    const core = createOmniview({
      plugins: [
        fixturePlugin({
          supports() {
            probes++;
            if (stage === "probe") {
              started.resolve();
              return probe.promise;
            }
            return true;
          },
          open() {
            opens++;
            started.resolve();
            return result.promise;
          },
        }),
      ],
    });
    const session = core.createSession(source);
    if (stage === "before") controller.abort(reason);
    const loading = session.load({ signal: controller.signal });
    const outcome = loading.catch((error: unknown) => error);
    if (stage === "probe" || stage === "open") await started.promise;
    controller.abort(reason);
    expect(await outcome).toMatchObject({ code: "CANCELLED", cause: reason });
    expect(session.load()).toBe(loading);
    expect(session.getSnapshot()).toMatchObject({ status: "cancelled" });
    expect(opens).toBe(stage === "open" ? 1 : 0);
    expect(probes).toBe(stage === "open" || stage === "probe" ? 1 : 0);
    probe.resolve(true);
    result.reject(new Error("late rejection is observed"));
    // The unused deferred promise in pre-probe paths has no runtime owner.
    if (stage !== "open") await result.promise.catch(() => {});
    await core.dispose();
  },
);

test("unlinks the caller signal after ready but aborts the retained plugin signal on disposal", async () => {
  const external = new AbortController();
  let retained!: AbortSignal;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ signal }) {
          retained = signal;
          return {};
        },
      }),
    ],
  });
  const session = await core.open(source, { signal: external.signal });
  external.abort("later");
  expect(retained.aborted).toBe(false);
  expect(session.getSnapshot().status).toBe("ready");
  await session.dispose();
  expect(retained.aborted).toBe(true);
  await expect(session.load()).rejects.toMatchObject({
    code: "SESSION_CLOSED",
  });
  await core.dispose();
});

test("disposal during a loading notification wins before queued work starts", async () => {
  let opened = 0;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open() {
          opened++;
          return {};
        },
      }),
    ],
  });
  const session = core.createSession(source);
  const calls: string[] = [];
  let disposing!: Promise<void>;
  session.subscribe(() => {
    if (session.getSnapshot().status === "loading")
      disposing = session.dispose();
  });
  session.subscribe(() => calls.push(session.getSnapshot().status));
  await expect(session.load()).rejects.toMatchObject({ code: "CANCELLED" });
  await disposing;
  expect(calls).toEqual(["disposed"]);
  expect(opened).toBe(0);
  await core.dispose();
});
