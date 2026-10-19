import { expect, test } from "bun:test";
import { createOmniview, createSource, OmniviewError } from "../src/index.ts";
import type {
  SerializationSnapshot,
  SerializedData,
} from "../src/sdk/index.ts";
import { textPlugin } from "./support/editing-fixture.ts";
import { deferred } from "./support/fixtures.ts";

test.each(["invalid", "throw"] as const)(
  "observes async captures even when their cleanup field is %s",
  async (mode) => {
    let observed = false;
    let cleaned = 0;
    let finish!: (value: unknown) => void;
    const core = createOmniview({
      plugins: [
        textPlugin({
          capture: () =>
            ({
              get dispose() {
                if (mode === "throw") throw null;
                return 1;
              },
              // biome-ignore lint/suspicious/noThenProperty: deliberately malformed async capture.
              then(resolve: (value: unknown) => void) {
                observed = true;
                finish = resolve;
              },
            }) as unknown as SerializationSnapshot,
        }),
      ],
    });
    const session = await core.open(createSource(new Blob(["a"])));
    await expect(session.serialize()).rejects.toMatchObject({
      code: "SERIALIZATION_FAILED",
    });
    expect(observed).toBe(true);
    const done = deferred<void>();
    finish({
      dispose() {
        cleaned++;
        done.resolve();
      },
    });
    await done.promise;
    expect(cleaned).toBe(1);
    await core.dispose();
  },
);

test("normalizes failure to read caller serialization options", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])));
  await expect(
    session.serialize({
      get signal(): never {
        throw null;
      },
    }),
  ).rejects.toMatchObject({ code: "SERIALIZATION_FAILED", cause: null });
  await core.dispose();
});

test.each([null, [], {}, { serialize: 1 }, { serialize() {}, dispose: 1 }])(
  "rejects malformed capture %j",
  async (value) => {
    const core = createOmniview({
      plugins: [
        textPlugin({
          capture: () => value as unknown as SerializationSnapshot,
        }),
      ],
    });
    const session = await core.open(createSource(new Blob(["a"])));
    await expect(session.serialize()).rejects.toMatchObject({
      code: "SERIALIZATION_FAILED",
      context: {
        sessionId: session.id,
        pluginId: "fixture/editable-text",
        sourceName: "document",
      },
    });
    await core.dispose();
  },
);

test.each([
  null,
  [],
  {},
  { data: "bytes" },
  { data: new Uint8Array(), name: 2 },
  { data: new Uint8Array(), name: " " },
  { data: new Uint8Array(), mimeType: 1 },
])("rejects malformed encoded output %j", async (value) => {
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture: () => ({
          serialize: () => value as unknown as SerializedData,
          dispose() {
            cleaned++;
          },
        }),
      }),
    ],
  });
  const session = await core.open(createSource(new Blob(["a"])));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SERIALIZATION_FAILED",
  });
  expect(cleaned).toBe(1);
  await core.dispose();
});

test.each(["capture", "dispose", "serialize", "data"] as const)(
  "normalizes thrown null from %s and cleans acquired resources",
  async (field) => {
    let cleaned = 0;
    const core = createOmniview({
      plugins: [
        textPlugin({
          capture() {
            if (field === "capture") throw null;
            return {
              get dispose() {
                if (field === "dispose") throw null;
                return () => {
                  cleaned++;
                };
              },
              get serialize() {
                if (field === "serialize") throw null;
                return () => ({
                  get data(): Blob {
                    throw null;
                  },
                });
              },
            };
          },
        }),
      ],
    });
    const session = await core.open(createSource(new Blob(["a"])));
    await expect(session.serialize()).rejects.toMatchObject({
      code: "SERIALIZATION_FAILED",
      cause: null,
    });
    expect(cleaned).toBe(field === "capture" || field === "dispose" ? 0 : 1);
    await core.dispose();
  },
);

test.each([false, true])(
  "observes invalid async capture (reject=%s) and cleans late snapshots",
  async (reject) => {
    const gate = deferred<SerializationSnapshot>();
    const cleaned = deferred<void>();
    const errors: OmniviewError[] = [];
    const core = createOmniview({
      onError: (error) => errors.push(error),
      plugins: [
        textPlugin({
          capture: () => gate.promise as unknown as SerializationSnapshot,
        }),
      ],
    });
    const session = await core.open(createSource(new Blob(["a"])));
    await expect(session.serialize()).rejects.toMatchObject({
      code: "SERIALIZATION_FAILED",
    });
    if (reject) gate.reject(new Error("late rejected capture"));
    else {
      gate.resolve({
        serialize() {
          throw new Error("must never encode");
        },
        dispose() {
          cleaned.resolve();
        },
      });
      await cleaned.promise;
    }
    await core.dispose();
    expect(errors).toEqual([]);
  },
);

test("a late malformed capture cleanup reports its failure once", async () => {
  const gate = deferred<SerializationSnapshot>();
  const reported = deferred<OmniviewError>();
  const core = createOmniview({
    onError: reported.resolve,
    plugins: [
      textPlugin({
        capture: () => gate.promise as unknown as SerializationSnapshot,
      }),
    ],
  });
  const session = await core.open(createSource(new Blob(["a"])));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SERIALIZATION_FAILED",
  });
  gate.resolve({
    serialize: () => ({ data: new Blob() }),
    get dispose(): never {
      throw null;
    },
  });
  expect(await reported.promise).toMatchObject({
    code: "CLEANUP_FAILED",
    cause: null,
  });
  await core.dispose();
});

test("late plugin-owned errors are wrapped as contextual cleanup diagnostics", async () => {
  const gate = deferred<SerializationSnapshot>();
  const reported = deferred<OmniviewError>();
  const cause = new OmniviewError("INVALID_SOURCE", "plugin-owned accessor");
  const core = createOmniview({
    onError: reported.resolve,
    plugins: [
      textPlugin({
        capture: () => gate.promise as unknown as SerializationSnapshot,
      }),
    ],
  });
  const session = await core.open(createSource(new Blob()));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SERIALIZATION_FAILED",
  });
  gate.resolve({
    serialize: () => ({ data: new Blob() }),
    get dispose(): never {
      throw cause;
    },
  });
  const error = await reported.promise;
  expect(error.cause).toBe(cause);
  expect(error.code).toBe("CLEANUP_FAILED");
  expect(error.context).toMatchObject({
    sessionId: session.id,
    pluginId: "fixture/editable-text",
  });
  await core.dispose();
});

test("a capture then getter failure preserves acquired cleanup and its original cause", async () => {
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture: () =>
          ({
            dispose() {
              cleaned++;
            },
            // biome-ignore lint/suspicious/noThenProperty: intentionally throwing protocol getter.
            get then(): never {
              throw null;
            },
          }) as unknown as SerializationSnapshot,
      }),
    ],
  });
  const session = await core.open(createSource(new Blob()));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SERIALIZATION_FAILED",
    cause: null,
  });
  expect(cleaned).toBe(1);
  await core.dispose();
});

test("late capture cleanup failures have a single diagnostic owner", async () => {
  const gate = deferred<SerializationSnapshot>();
  const reported = deferred<OmniviewError>();
  const errors: OmniviewError[] = [];
  const core = createOmniview({
    onError(error) {
      errors.push(error);
      reported.resolve(error);
    },
    plugins: [
      textPlugin({
        capture: () => gate.promise as unknown as SerializationSnapshot,
      }),
    ],
  });
  const session = await core.open(createSource(new Blob(["a"])));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SERIALIZATION_FAILED",
  });
  await session.dispose();
  const cause = new Error("late cleanup");
  gate.resolve({
    serialize: () => ({ data: new Blob() }),
    dispose() {
      throw cause;
    },
  });
  expect(await reported.promise).toMatchObject({ code: "CLEANUP_FAILED" });
  expect(errors).toHaveLength(1);
  await core.dispose();
});

test("a custom asynchronous thenable is rejected without assimilating capture fields", async () => {
  const cleaned = deferred<void>();
  let thenReads = 0;
  let calls = 0;
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture: () =>
          ({
            // biome-ignore lint/suspicious/noThenProperty: intentionally malformed thenable capture.
            get then() {
              thenReads++;
              return (resolve: (value: unknown) => void) => {
                calls++;
                resolve({
                  dispose() {
                    cleaned.resolve();
                  },
                });
              };
            },
          }) as unknown as SerializationSnapshot,
      }),
    ],
  });
  const session = await core.open(createSource(new Blob(["a"])));
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SERIALIZATION_FAILED",
  });
  await cleaned.promise;
  expect([thenReads, calls]).toEqual([1, 1]);
  await core.dispose();
});

test.each(["success", "failure"] as const)(
  "handles cleanup failure after encoding %s",
  async (mode) => {
    const errors: OmniviewError[] = [];
    const cause = new Error("encode failed");
    let cleaned = 0;
    const core = createOmniview({
      onError: (error) => errors.push(error),
      plugins: [
        textPlugin({
          capture: () => ({
            serialize() {
              if (mode === "failure") throw cause;
              return { data: new Blob(["ok"]) };
            },
            dispose() {
              cleaned++;
              throw new Error("cleanup failed");
            },
          }),
        }),
      ],
    });
    const session = await core.open(createSource(new Blob(["a"])));
    const error: unknown = await session
      .serialize()
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: mode === "failure" ? "SERIALIZATION_FAILED" : "CLEANUP_FAILED",
    });
    if (mode === "failure") {
      expect((error as OmniviewError).cause).toBe(cause);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("CLEANUP_FAILED");
    } else expect(errors).toEqual([]);
    expect(cleaned).toBe(1);
    await core.dispose();
    expect(cleaned).toBe(1);
  },
);
