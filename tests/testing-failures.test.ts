import { expect, spyOn, test } from "bun:test";
import { createSource } from "../src/index.ts";
import { definePlugin } from "../src/sdk/index.ts";
import {
  createPluginTestSuite,
  PluginConformanceError,
  type PluginTestFixture,
  type PluginTestSuiteOptions,
} from "../src/testing/index.ts";
import { deferred } from "./support/fixtures.ts";

test("non-string semantic fingerprints are fixture errors", async () => {
  await expect(
    run(
      {
        ...options(),
        fingerprint: (() =>
          1) as unknown as PluginTestSuiteOptions<PluginTestFixture>["fingerprint"],
      },
      "session/independence",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
});

test("core cleanup failures retain cleanup ownership and do not skip fixture disposal", async () => {
  let cleaned = false;
  const cause = new Error("plugin resource");
  const error = await run({
    ...options(),
    createFixture: () => ({
      plugin: definePlugin({
        id: "broken/cleanup",
        apiVersion: 1,
        supports: () => true,
        open: () => ({
          dispose() {
            throw cause;
          },
        }),
      }),
      createSource: () => createSource(new Blob()),
      dispose() {
        cleaned = true;
      },
    }),
  }).catch((error: unknown) => error);
  expect(error).toMatchObject({ phase: "cleanup" });
  expect((error as PluginConformanceError).cleanupErrors).toHaveLength(1);
  expect(cleaned).toBe(true);
});

test("invalid resource-verification data retains fixture phase", async () => {
  await expect(
    run({
      ...options(),
      verifyDisposed: (() => false) as unknown as NonNullable<
        PluginTestSuiteOptions<PluginTestFixture>["verifyDisposed"]
      >,
    }),
  ).rejects.toMatchObject({ phase: "fixture" });
});

test("invalid source metadata discovered by the core remains a fixture failure", async () => {
  const base = options();
  await expect(
    run(
      {
        ...base,
        async createFixture() {
          const fixture = await base.createFixture();
          let reads = 0;
          return {
            ...fixture,
            createSource: () => ({
              get name() {
                reads++;
                return reads <= 2 ? "before" : (1 as unknown as string);
              },
              mimeType: "text/plain",
              size: 0,
              read: async () => new Uint8Array(),
            }),
          };
        },
      },
      "open/explicit",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
});

test("plugin failure during explicit open remains a check failure", async () => {
  await expect(
    run(
      {
        ...options(),
        createFixture: () => ({
          plugin: definePlugin({
            id: "broken/open",
            apiVersion: 1,
            supports: () => true,
            open() {
              throw null;
            },
          }),
          createSource: () => createSource(new Blob()),
        }),
      },
      "open/explicit",
    ),
  ).rejects.toMatchObject({ phase: "check" });
});

test("unsupported source factories must return readable sources", async () => {
  await expect(
    run(
      {
        ...options(),
        unsupported: [
          {
            id: "invalid",
            createSource: () =>
              null as unknown as ReturnType<typeof createSource>,
          },
        ],
      },
      "unsupported/invalid",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
});

test.each(["cleanup/plugin", "session/lifetime"])(
  "explicit disposal in %s retains cleanup phase and one owner",
  async (suffix) => {
    const error = await run(
      {
        ...options(),
        verifyDisposed() {},
        createFixture: () => ({
          plugin: definePlugin({
            id: "broken/dispose",
            apiVersion: 1,
            supports: () => true,
            open: () => ({
              dispose() {
                throw new Error("dispose failure");
              },
            }),
          }),
          createSource: () => createSource(new Blob()),
        }),
      },
      suffix,
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ phase: "cleanup" });
    expect((error as PluginConformanceError).cause).toBeInstanceOf(
      AggregateError,
    );
    expect((error as PluginConformanceError).cleanupErrors).toHaveLength(1);
  },
);

test.each(["open/detection", "session/lifetime", "load/pre-aborted"])(
  "source invalidation in %s is still a fixture failure",
  async (suffix) => {
    const base = options();
    const error = await run(
      {
        ...base,
        async createFixture() {
          const fixture = await base.createFixture();
          let reads = 0;
          return {
            ...fixture,
            createSource: () => ({
              get name() {
                reads++;
                return reads <= 2 ? "before" : (1 as unknown as string);
              },
              mimeType: "text/plain",
              size: 0,
              read: async () => new Uint8Array(),
            }),
          };
        },
      },
      suffix,
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ phase: "fixture" });
  },
);

test("unsupported source invalidating during core admission retains its fixture boundary", async () => {
  await expect(
    run(
      {
        ...options(),
        unsupported: [
          {
            id: "unstable",
            createSource() {
              let reads = 0;
              return {
                get name() {
                  reads++;
                  return reads <= 2 ? "before" : (1 as unknown as string);
                },
                mimeType: "text/plain",
                size: 0,
                read: async () => new Uint8Array(),
              };
            },
          },
        ],
      },
      "unsupported/unstable",
    ),
  ).rejects.toMatchObject({ phase: "fixture" });
});

for (const cause of [null, new Error("source accessor")]) {
  test.each([
    "open/detection",
    "open/explicit",
    "session/lifetime",
    "load/pre-aborted",
    "unsupported/throwing",
  ])(
    "throwing source metadata in %s retains its original fixture cause",
    async (suffix) => {
      const base = options();
      function source() {
        let reads = 0;
        return {
          get name() {
            if (++reads > 2) throw cause;
            return "before";
          },
          mimeType: "text/plain",
          size: 0,
          read: async () => new Uint8Array(),
        };
      }
      const error = await run(
        {
          ...base,
          async createFixture() {
            return { ...(await base.createFixture()), createSource: source };
          },
          unsupported: [{ id: "throwing", createSource: source }],
        },
        suffix,
      ).catch((error: unknown) => error);
      expect((error as PluginConformanceError).phase).toBe("fixture");
      expect((error as PluginConformanceError).cause).toBe(cause);
    },
  );
}

function options(): PluginTestSuiteOptions<PluginTestFixture> {
  return {
    id: "failure.viewer",
    editing: false,
    createFixture: () => ({
      plugin: definePlugin({
        id: "failure/viewer",
        apiVersion: 1,
        supports: () => true,
        open: () => ({}),
      }),
      createSource: () => createSource(new Blob()),
    }),
    verifyDocument() {},
    fingerprint: () => "",
  };
}
function run(
  config: PluginTestSuiteOptions<PluginTestFixture>,
  suffix = "open/detection",
): Promise<void> {
  const check = createPluginTestSuite(config).cases.find((entry) =>
    entry.id.endsWith(`/${suffix}`),
  );
  if (!check) throw new Error("Missing case");
  return check.run();
}

test.each([null, undefined, new Error("original")])(
  "preserves primary %j across all cleanup failures",
  async (cause) => {
    const order: string[] = [];
    const base = options();
    const result = await run({
      ...base,
      createFixture() {
        const fixture = base.createFixture();
        // This local factory is synchronous; the public factory remains MaybePromise.
        if ("then" in fixture) throw new Error("Unexpected fixture promise");
        return {
          ...fixture,
          dispose() {
            order.push("environment");
            throw new Error("environment failed");
          },
        };
      },
      verifyDocument() {
        throw cause;
      },
      verifyDisposed() {
        order.push("resources");
        throw new Error("resources failed");
      },
    }).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(PluginConformanceError);
    const error = result as PluginConformanceError;
    expect(error.cause).toBe(cause);
    expect(error.phase).toBe("check");
    expect(error.cleanupErrors).toHaveLength(2);
    expect(order).toEqual(["resources", "environment"]);
    expect(Object.isFrozen(error.cleanupErrors)).toBe(true);
    expect(Object.isFrozen(error.diagnostics)).toBe(true);
  },
);

test("failed source creation still disposes the fixture and keeps fixture phase", async () => {
  let cleaned = 0;
  const base = options();
  const cause = new Error("source");
  const error: unknown = await run({
    ...base,
    createFixture: () => ({
      plugin: definePlugin({
        id: "failure/source",
        apiVersion: 1,
        supports: () => true,
        open: () => ({}),
      }),
      createSource() {
        throw cause;
      },
      dispose() {
        cleaned++;
      },
    }),
  }).catch((error: unknown) => error);
  expect((error as PluginConformanceError).cause).toBe(cause);
  expect((error as PluginConformanceError).phase).toBe("fixture");
  expect(cleaned).toBe(1);
});

test("fixture validation captures cleanup before a later accessor fails", async () => {
  let cleaned = 0;
  const cause = new Error("plugin access");
  const error: unknown = await run({
    ...options(),
    createFixture: () => ({
      get plugin(): never {
        throw cause;
      },
      createSource: () => createSource(new Blob()),
      dispose() {
        cleaned++;
      },
    }),
  }).catch((error: unknown) => error);
  expect((error as PluginConformanceError).cause).toBe(cause);
  expect(cleaned).toBe(1);
});

test("cleanup-only failure is aggregated without fabricating an assertion primary", async () => {
  const cause = new Error("environment cleanup");
  const error: unknown = await run({
    ...options(),
    verifyDisposed() {
      throw cause;
    },
  }).catch((error: unknown) => error);
  expect((error as PluginConformanceError).phase).toBe("cleanup");
  expect(
    ((error as PluginConformanceError).cause as AggregateError).errors,
  ).toEqual([cause]);
});

test("non-undefined verification data cannot become a passing case", async () => {
  const error: unknown = await run({
    ...options(),
    verifyDocument: (() =>
      false) as unknown as PluginTestSuiteOptions<PluginTestFixture>["verifyDocument"],
  }).catch((error: unknown) => error);
  expect(error).toMatchObject({ phase: "fixture" });
});

test("observer diagnostics during disposal fail an otherwise successful check", async () => {
  const cause = new Error("observer during disposal");
  const result = await run({
    ...options(),
    verifyDocument({ session }) {
      session.subscribe(() => {
        throw cause;
      });
    },
  }).catch((error: unknown) => error);
  const error = result as PluginConformanceError;
  expect(error.phase).toBe("check");
  expect(error.diagnostics).toHaveLength(1);
  expect(error.diagnostics[0]?.cause).toBe(cause);
});

test.each(["callback", "default", "throwing"] as const)(
  "late cleanup uses the %s diagnostic sink with the originating ID",
  async (mode) => {
    let register!: (cleanup: () => void) => () => void;
    const late = deferred<PluginConformanceError>();
    const seen = deferred<void>();
    const sink = spyOn(console, "error").mockImplementation(
      (error: unknown) => {
        if (error instanceof PluginConformanceError) late.resolve(error);
        seen.resolve();
      },
    );
    try {
      await run({
        ...options(),
        createFixture: () => ({
          plugin: definePlugin({
            id: "late/viewer",
            apiVersion: 1,
            supports: () => true,
            open({ onDispose }) {
              register = onDispose;
              return {};
            },
          }),
          createSource: () => createSource(new Blob()),
        }),
        ...(mode === "default"
          ? {}
          : {
              onLateError(error: PluginConformanceError) {
                late.resolve(error);
                if (mode === "throwing") throw new Error("bad sink");
              },
            }),
      });
      const cause = new Error("detached cleanup");
      register(() => {
        throw cause;
      });
      const error = await late.promise;
      expect(error.caseId).toBe("failure.viewer/open/detection");
      expect(error.diagnostics[0]?.code).toBe("CLEANUP_FAILED");
      if (mode !== "callback") await seen.promise;
    } finally {
      sink.mockRestore();
    }
  },
);

test.each([
  null,
  { plugin: null, createSource() {} },
  { dispose: 1 },
  { createSource: 1 },
])("rejects invalid returned fixture %j", async (fixture) => {
  const error = await run({
    ...options(),
    createFixture: () => fixture as unknown as PluginTestFixture,
  }).catch((error: unknown) => error);
  expect(error).toMatchObject({ phase: "fixture" });
});
