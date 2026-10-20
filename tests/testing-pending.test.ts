import { expect, test } from "bun:test";
import { createSource, OmniviewError } from "../src/index.ts";
import {
  defineCapability,
  definePlugin,
  type EditOptions,
  provideCapability,
} from "../src/sdk/index.ts";
import {
  type ControlledEdit,
  type ControlledLoad,
  createPluginTestSuite,
  type PluginConformanceError,
  type PluginTestFixture,
  type PluginTestSuiteOptions,
} from "../src/testing/index.ts";
import { type Deferred, deferred } from "./support/fixtures.ts";

const textKey = defineCapability<{
  read(): string;
  replace(value: string, options: EditOptions): Promise<void>;
}>("fixture.control:text");
interface Fixture extends PluginTestFixture {
  readonly entered: Deferred<void>;
  readonly drained: Deferred<void>;
  readonly gate: Deferred<void>;
  readonly mode: {
    loading: boolean;
    editing: boolean;
    releases: number;
    resources: number;
  };
}

test.each(["fulfill", "reject", "invalid", "cleanup-failure"] as const)(
  "observes invalid async edit control %s after the case settles",
  async (mode) => {
    const base = options();
    if (base.editing === false) throw new Error("Expected editable fixture");
    const lateControl = deferred<ControlledEdit>();
    const released = deferred<void>();
    const reported = deferred<PluginConformanceError>();
    let calls = 0;
    const cause = new Error("late release");
    await expect(
      run(
        {
          ...base,
          onLateError: reported.resolve,
          editing: {
            ...base.editing,
            pending: () => lateControl.promise as unknown as ControlledEdit,
          },
        },
        "editing/pending-cancel",
      ),
    ).rejects.toMatchObject({ phase: "fixture" });
    if (mode === "reject") {
      lateControl.reject(new Error("late rejected box"));
      return;
    }
    if (mode === "invalid") {
      lateControl.resolve(null as unknown as ControlledEdit);
      expect((await reported.promise).caseId).toBe(
        "controlled/editing/pending-cancel",
      );
      return;
    }
    lateControl.resolve({
      entered: Promise.resolve(),
      drained: Promise.resolve(),
      result: Promise.resolve(),
      release() {
        calls++;
        released.resolve();
        if (mode === "cleanup-failure") throw cause;
      },
    });
    await released.promise;
    if (mode === "cleanup-failure")
      expect((await reported.promise).cause).toBe(cause);
    expect(calls).toBe(1);
  },
);

test("a malformed synchronous load thenable releases both immediate and late controls", async () => {
  const base = options();
  const released = deferred<void>();
  let calls = 0;
  const error = await run(
    {
      ...base,
      pauseLoad: () => ({
        entered: Promise.resolve(),
        drained: Promise.resolve(),
        release() {
          calls++;
        },
        // biome-ignore lint/suspicious/noThenProperty: intentionally invalid thenable control box.
        then(resolve: (value: ControlledLoad) => void) {
          resolve({
            entered: Promise.resolve(),
            drained: Promise.resolve(),
            release() {
              calls++;
              released.resolve();
            },
          });
        },
      }),
    },
    "load/pending-cancel",
  ).catch((error: unknown) => error);
  expect(error).toMatchObject({ phase: "fixture" });
  await released.promise;
  expect(calls).toBe(2);
});

test("a failed release retains an already-failed drain alongside the primary", async () => {
  const entered = new Error("entered");
  const drain = new Error("drain");
  const release = new Error("release");
  const error = await run(
    {
      ...options(),
      pauseLoad() {
        return {
          entered: Promise.reject(entered),
          drained: Promise.reject(drain),
          release() {
            throw release;
          },
        };
      },
    },
    "load/pending-cancel",
  ).catch((error: unknown) => error);
  expect((error as PluginConformanceError).cause).toBe(entered);
  expect((error as PluginConformanceError).cleanupErrors).toEqual([
    release,
    drain,
  ]);
});

test("a drain failing after release failure reaches the late error sink", async () => {
  const entered = new Error("entered");
  const drain = deferred<void>();
  const reported = deferred<PluginConformanceError>();
  const cause = new Error("late drain");
  await expect(
    run(
      {
        ...options(),
        onLateError: reported.resolve,
        pauseLoad() {
          return {
            entered: Promise.reject(entered),
            drained: drain.promise,
            release() {
              throw new Error("release");
            },
          };
        },
      },
      "load/pending-cancel",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
  drain.reject(cause);
  expect((await reported.promise).cause).toBe(cause);
});

test("a drain failing during environment cleanup remains a cleanup error", async () => {
  const base = options();
  const entered = new Error("entered");
  const release = new Error("release");
  const cause = new Error("drain during cleanup");
  const drain = deferred<void>();
  const late: PluginConformanceError[] = [];
  const error = await run(
    {
      ...base,
      async createFixture() {
        const fixture = await base.createFixture();
        return {
          ...fixture,
          async dispose() {
            drain.reject(cause);
            await drain.promise.catch(() => undefined);
            // Environment teardown includes actual asynchronous resource work.
            await new Blob(["environment"]).text();
            await fixture.dispose?.();
          },
        };
      },
      pauseLoad() {
        return {
          entered: Promise.reject(entered),
          drained: drain.promise,
          release() {
            throw release;
          },
        };
      },
      onLateError(error) {
        late.push(error);
      },
    },
    "load/pending-cancel",
  ).catch((error: unknown) => error);
  expect((error as PluginConformanceError).cause).toBe(entered);
  expect((error as PluginConformanceError).cleanupErrors).toEqual([
    release,
    cause,
  ]);
  expect(late).toEqual([]);
});

test("a malformed release still retains an already rejected drain", async () => {
  const cause = new Error("drain without release");
  const error = await run(
    {
      ...options(),
      pauseLoad() {
        return {
          entered: Promise.resolve(),
          drained: Promise.reject(cause),
          release: null,
        } as unknown as ControlledLoad;
      },
    },
    "load/pending-cancel",
  ).catch((error: unknown) => error);
  expect(error).toMatchObject({ phase: "fixture" });
  expect((error as PluginConformanceError).cleanupErrors).toEqual([cause]);
});

test("detects a real capability swallowing cancellation and still drains its resources", async () => {
  const base = options({ swallowCancellation: true });
  let fixture: Fixture | undefined;
  await expect(
    run(
      {
        ...base,
        async createFixture() {
          fixture = await base.createFixture();
          return fixture;
        },
      },
      "editing/pending-cancel",
    ),
  ).rejects.toMatchObject({
    phase: "check",
    cause: new Error("Expected CANCELLED rejection"),
  });
  expect(fixture?.mode.releases).toBe(1);
  expect(fixture?.mode.resources).toBe(0);
});

function options(
  settings: { swallowCancellation?: boolean } = {},
): PluginTestSuiteOptions<Fixture> {
  return {
    id: "controlled",
    createFixture() {
      const entered = deferred<void>();
      const drained = deferred<void>();
      const gate = deferred<void>();
      const mode = {
        loading: false,
        editing: false,
        releases: 0,
        resources: 0,
      };
      return {
        entered,
        drained,
        gate,
        mode,
        dispose() {
          gate.resolve();
        },
        createSource: () => createSource(new Blob(["before"])),
        plugin: definePlugin({
          id: "fixture/controlled",
          apiVersion: 1,
          supports: () => true,
          async open({ source, edit, onDispose, signal }) {
            mode.resources++;
            onDispose(() => {
              mode.resources--;
            });
            try {
              if (mode.loading) {
                entered.resolve();
                await gate.promise;
              }
              let text = new TextDecoder().decode(
                await source.read({
                  signal: mode.loading ? new AbortController().signal : signal,
                }),
              );
              return {
                capabilities: [
                  provideCapability(textKey, {
                    read: () => text,
                    replace(next, editOptions) {
                      let completion: Promise<void> | undefined;
                      const result = edit(async ({ commit }) => {
                        if (mode.editing) {
                          entered.resolve();
                          completion = gate.promise.then(() => {
                            try {
                              commit(() => {
                                const changed = text !== next;
                                text = next;
                                return { changed, value: undefined };
                              });
                            } finally {
                              drained.resolve();
                            }
                          });
                          await completion;
                        } else
                          commit(() => {
                            const changed = text !== next;
                            text = next;
                            return { changed, value: undefined };
                          });
                      }, editOptions);
                      return settings.swallowCancellation
                        ? result.catch((error: unknown) => {
                            if (
                              !(error instanceof OmniviewError) ||
                              error.code !== "CANCELLED"
                            )
                              throw error;
                          })
                        : result;
                    },
                  }),
                ],
                editing: {
                  capture() {
                    const captured = text;
                    return {
                      serialize: () => ({
                        data: new TextEncoder().encode(captured),
                      }),
                    };
                  },
                },
              };
            } finally {
              if (mode.loading) drained.resolve();
            }
          },
        }),
      };
    },
    verifyDocument({ session }) {
      if (session.getCapability(textKey)?.read() !== "before")
        throw new Error("Wrong text");
    },
    fingerprint({ session }) {
      const api = session.getCapability(textKey);
      if (!api) throw new Error("Missing text");
      return api.read();
    },
    editing: {
      async change({ session }, editOptions) {
        const api = session.getCapability(textKey);
        if (!api) throw new Error("Missing text");
        await api.replace("after", editOptions);
      },
      verifyChanged({ session }) {
        if (session.getCapability(textKey)?.read() !== "after")
          throw new Error("Wrong changed text");
      },
      async verifyOutput({ output, expectedFingerprint }) {
        if (
          new TextDecoder().decode(await output.source.read()) !==
          expectedFingerprint
        )
          throw new Error("Output differs");
      },
      pending({ fixture, session }, editOptions) {
        fixture.mode.editing = true;
        const api = session.getCapability(textKey);
        if (!api) throw new Error("Missing text");
        const result = api.replace("after", editOptions);
        return {
          result,
          entered: fixture.entered.promise,
          drained: fixture.drained.promise,
          release() {
            fixture.mode.releases++;
            fixture.gate.resolve();
          },
        };
      },
    },
    pauseLoad(fixture) {
      fixture.mode.loading = true;
      return {
        entered: fixture.entered.promise,
        drained: fixture.drained.promise,
        release() {
          fixture.mode.releases++;
          fixture.gate.resolve();
        },
      };
    },
    verifyDisposed({ mode }) {
      if (mode.resources !== 0) throw new Error("Resource leak");
    },
  };
}

async function run<T extends PluginTestFixture>(
  configuration: PluginTestSuiteOptions<T>,
  suffix: string,
): Promise<void> {
  const entry = createPluginTestSuite(configuration).cases.find(
    (item) => item.id === `${configuration.id}/${suffix}`,
  );
  if (!entry) throw new Error(`Missing case ${suffix}`);
  await entry.run();
}

test("cancels actual pending plugin loading before releasing its dependency", async () => {
  await run(options(), "load/pending-cancel");
});

test("disposes pending loading without waiting for its dependency", async () => {
  await run(options(), "load/pending-dispose");
});

test.each(["cancel", "revoke", "dispose", "writer"] as const)(
  "coordinates pending edit %s with the actual plugin operation",
  async (action) => {
    let fixture: Fixture | undefined;
    const base = options();
    await run(
      {
        ...base,
        async createFixture() {
          fixture = await base.createFixture();
          return fixture;
        },
      },
      `editing/pending-${action}`,
    );
    expect(fixture?.mode.releases).toBe(1);
    expect(fixture?.mode.resources).toBe(0);
  },
);

test.each(["null", "release", "entered", "drained", "then"] as const)(
  "malformed %s controls still observe other milestones",
  async (field) => {
    let released = 0;
    const base = options();
    const error = await run(
      {
        ...base,
        pauseLoad() {
          if (field === "null") return null as unknown as ControlledLoad;
          const control: Record<string, unknown> = {
            release() {
              released++;
            },
            entered: Promise.resolve(),
            drained: Promise.resolve(),
          };
          if (field === "then")
            // biome-ignore lint/suspicious/noThenProperty: malformed control must exercise then getter failure.
            Object.defineProperty(control, "then", {
              get() {
                throw null;
              },
            });
          else control[field] = field === "entered" ? null : {};
          return control as unknown as ControlledLoad;
        },
      },
      "load/pending-cancel",
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ phase: "fixture" });
    expect(released).toBe(field === "null" || field === "release" ? 0 : 1);
  },
);

test("rejecting entered milestones preserve their original failure", async () => {
  const base = options();
  const cause = new Error("entered failed");
  await expect(
    run(
      {
        ...base,
        pauseLoad(fixture) {
          const control = base.pauseLoad?.(fixture);
          if (!control || "then" in control)
            throw new Error("Expected immediate control");
          return { ...control, entered: Promise.reject(cause) };
        },
      },
      "load/pending-cancel",
    ),
  ).rejects.toMatchObject({ phase: "fixture", cause });
});

test("a milestone resolving non-void cannot certify a control", async () => {
  const base = options();
  await expect(
    run(
      {
        ...base,
        pauseLoad(fixture) {
          const control = base.pauseLoad?.(fixture);
          if (!control || "then" in control)
            throw new Error("Expected immediate control");
          return {
            ...control,
            entered: Promise.resolve(1) as unknown as Promise<void>,
          };
        },
      },
      "load/pending-cancel",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
});

test("release failure skips the unreleased drain and still closes core and environment", async () => {
  const base = options();
  const cause = new Error("release failed");
  let fixture: Fixture | undefined;
  const error = await run(
    {
      ...base,
      async createFixture() {
        fixture = await base.createFixture();
        return fixture;
      },
      pauseLoad(target) {
        const control = base.pauseLoad?.(target);
        if (!control || "then" in control)
          throw new Error("Expected immediate control");
        return {
          ...control,
          release() {
            throw cause;
          },
        };
      },
    },
    "load/pending-cancel",
  ).catch((error: unknown) => error);
  expect(error).toMatchObject({ phase: "cleanup", cleanupErrors: [cause] });
  if (!fixture) throw new Error("Missing fixture");
  await fixture.drained.promise;
  expect(fixture.mode.resources).toBe(0);
});

test("drain rejection is a cleanup error after cancellation", async () => {
  const base = options();
  const cause = new Error("drain failed");
  await expect(
    run(
      {
        ...base,
        pauseLoad(fixture) {
          const control = base.pauseLoad?.(fixture);
          if (!control || "then" in control)
            throw new Error("Expected immediate control");
          return { ...control, drained: Promise.reject(cause) };
        },
      },
      "load/pending-cancel",
    ),
  ).rejects.toMatchObject({ phase: "cleanup", cleanupErrors: [cause] });
});

test.each(["load", "edit"] as const)(
  "normalizes %s control factory exceptions",
  async (kind) => {
    const base = options();
    const cause = new Error("control factory");
    if (base.editing === false) throw new Error("Expected editable options");
    const configured =
      kind === "load"
        ? {
            ...base,
            pauseLoad(): never {
              throw cause;
            },
          }
        : {
            ...base,
            editing: {
              ...base.editing,
              pending(): never {
                throw cause;
              },
            },
          };
    await expect(
      run(
        configured,
        kind === "load" ? "load/pending-cancel" : "editing/pending-cancel",
      ),
    ).rejects.toMatchObject({ phase: "fixture", cause });
  },
);

test("prematurely completed operations fail instead of waiting forever for entered", async () => {
  const base = options();
  if (base.editing === false) throw new Error("Expected editable options");
  await expect(
    run(
      {
        ...base,
        editing: {
          ...base.editing,
          pending() {
            return {
              entered: deferred<void>().promise,
              drained: Promise.resolve(),
              result: Promise.resolve(),
              release() {},
            };
          },
        },
      },
      "editing/pending-cancel",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
});

test("a controlled edit must actually hold a busy writer", async () => {
  const base = options();
  const entered = deferred<void>();
  if (base.editing === false) throw new Error("Expected editable options");
  await expect(
    run(
      {
        ...base,
        editing: {
          ...base.editing,
          pending() {
            entered.resolve();
            return {
              entered: entered.promise,
              drained: Promise.resolve(),
              result: deferred<void>().promise,
              release() {},
            };
          },
        },
      },
      "editing/pending-cancel",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
});

test.each(["result", "entered"] as const)(
  "invalid edit %s fields still clean up the acquired control",
  async (field) => {
    const base = options();
    let released = 0;
    if (base.editing === false) throw new Error("Expected editable options");
    await expect(
      run(
        {
          ...base,
          editing: {
            ...base.editing,
            pending() {
              return {
                entered: Promise.resolve(),
                drained: Promise.resolve(),
                result: Promise.resolve(),
                release() {
                  released++;
                },
                [field]: null,
              } as unknown as ControlledEdit;
            },
          },
        },
        "editing/pending-cancel",
      ),
    ).rejects.toMatchObject({ phase: "fixture" });
    expect(released).toBe(1);
  },
);
