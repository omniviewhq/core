import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { editingState, editor, textPlugin } from "./support/editing-fixture.ts";
import { deferred } from "./support/fixtures.ts";

test("capture holds exclusive model access while permitting reads", async () => {
  let session!: import("../src/index.ts").DocumentSession;
  let work!: import("./support/editing-fixture.ts").TextWork;
  const failures: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture(text) {
          for (const action of [
            () => work.replace("illegal"),
            () => session.setReadOnly(true),
            () =>
              session.markPersisted({
                revision: "0",
                source: createSource(new Blob()),
              }),
          ]) {
            try {
              action();
            } catch (error) {
              failures.push(error);
            }
          }
          pending.push(session.serialize().catch((error: unknown) => error));
          pending.push(
            editor(session)
              .run(() => {
                throw new Error("must not run");
              })
              .catch((error: unknown) => error),
          );
          expect(editor(session).read()).toBe(text);
          return { serialize: () => ({ data: new Blob([text]) }) };
        },
      }),
    ],
  });
  session = await core.open(createSource(new Blob(["a"])), { readOnly: false });
  await editor(session).run(async (context) => {
    work = context;
    await session.serialize();
  });
  expect(failures).toHaveLength(3);
  expect(
    failures.every((error) => (error as { code: string }).code === "EDIT_BUSY"),
  ).toBe(true);
  for (const error of await Promise.all(pending))
    expect(error).toMatchObject({ code: "EDIT_BUSY" });
  await core.dispose();
});

test("copies output before cleanup and keeps metadata and repeated reads independent", async () => {
  const bytes = new Uint8Array([65, 66]);
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture: () => ({
          serialize: () => ({
            data: bytes,
            name: "export.txt",
            mimeType: "text/custom",
          }),
          dispose() {
            bytes.fill(0);
          },
        }),
      }),
    ],
  });
  const session = await core.open(
    createSource(new Blob(["original"]), { name: "original.txt" }),
  );
  const before = session.getSnapshot();
  const output = await session.serialize();
  expect(Object.isFrozen(output)).toBe(true);
  expect(output.source).toMatchObject({
    name: "export.txt",
    mimeType: "text/custom",
    size: 2,
  });
  const read = await output.source.read();
  read.fill(0);
  expect(Array.from(await output.source.read())).toEqual([65, 66]);
  expect(Array.from(bytes)).toEqual([0, 0]);
  expect(session.getSnapshot()).toBe(before);
  expect(before.source.name).toBe("original.txt");
  await core.dispose();
});

test("allows independent captures while a writer awaits and policy changes", async () => {
  const gate = deferred<void>();
  const started = deferred<void>();
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const work = editor(session)
    .run(async ({ replace }) => {
      replace("first");
      started.resolve();
      await gate.promise;
    })
    .catch((error: unknown) => error);
  await started.promise;
  const first = session.serialize();
  session.setReadOnly(true);
  const second = session.serialize();
  expect(await work).toMatchObject({ code: "CANCELLED" });
  const outputs = await Promise.all([first, second]);
  expect(outputs.map(({ revision }) => revision)).toEqual(["1", "1"]);
  expect(outputs[0]).not.toBe(outputs[1]);
  gate.resolve();
  await core.dispose();
});

test("snapshots protocol methods and fields once with their original receivers", async () => {
  let reads = 0;
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture(text, captureContext) {
          expect(Object.isFrozen(captureContext)).toBe(true);
          const snapshot = {
            marker: "capture",
            get serialize() {
              reads++;
              return function (
                this: { marker: string },
                context: { revision: string },
              ) {
                expect(this.marker).toBe("capture");
                expect(context.revision).toBe("0");
                return {
                  get data() {
                    reads++;
                    return new Blob([text]);
                  },
                  get name() {
                    reads++;
                    return "out.txt";
                  },
                  get mimeType() {
                    reads++;
                    return "text/plain";
                  },
                };
              };
            },
            get dispose() {
              reads++;
              return function (this: { marker: string }) {
                expect(this.marker).toBe("capture");
              };
            },
          };
          return snapshot;
        },
      }),
    ],
  });
  const session = await core.open(createSource(new Blob(["a"])));
  await session.serialize();
  expect(reads).toBe(5);
  await core.dispose();
});

test("captures accepted revisions from synchronous observers and blocks applying reentry", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  let exportFromObserver:
    | Promise<import("../src/index.ts").SerializationResult>
    | undefined;
  const remove = session.subscribe(() => {
    if (editingState(session).revision === "1" && !exportFromObserver)
      exportFromObserver = session.serialize();
  });
  let denied!: Promise<unknown>;
  await editor(session).run(({ commit }) =>
    commit(() => {
      denied = session.serialize().catch((error: unknown) => error);
      expect(() => session.setReadOnly(true)).toThrow();
      return { changed: true, value: undefined };
    }),
  );
  expect(await denied).toMatchObject({ code: "EDIT_BUSY" });
  expect((await exportFromObserver)?.revision).toBe("1");
  remove();
  await core.dispose();
});

test("serializes captured A while later edits reach B", async () => {
  const gate = deferred<void>();
  const captured: string[] = [];
  let cleaned = 0;
  const core = createOmniview({
    plugins: [
      textPlugin({
        capture(text, context) {
          captured.push(`${context.revision}:${text}`);
          return {
            async serialize() {
              await gate.promise;
              return { data: new TextEncoder().encode(text) };
            },
            dispose() {
              cleaned++;
            },
          };
        },
      }),
    ],
  });
  const session = await core.open(
    createSource(new Blob(["a"], { type: "text/plain" }), {
      name: "notes.txt",
    }),
    { readOnly: false },
  );
  await editor(session).replace("A");
  const serializing = session.serialize();
  expect(captured).toEqual(["1:A"]); // capture happens at call time
  await editor(session).replace("B");
  gate.resolve();
  const output = await serializing;
  expect(output.revision).toBe("1");
  expect(new TextDecoder().decode(await output.source.read())).toBe("A");
  expect(output.source.name).toBe("notes.txt");
  expect(cleaned).toBe(1);
  expect(editingState(session)).toMatchObject({
    revision: "2",
    persistedRevision: "0",
    dirty: true,
  });
  await core.dispose();
  expect(new TextDecoder().decode(await output.source.read())).toBe("A");
  expect(cleaned).toBe(1);
});
