import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { editingState, editor, textPlugin } from "./support/editing-fixture.ts";
import { deferred } from "./support/fixtures.ts";

test("accepts several changes across one async edit", async () => {
  const gate = deferred<void>();
  const started = deferred<void>();
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const api = editor(session);
  const operation = api.run(async ({ replace }) => {
    replace("b");
    started.resolve();
    await gate.promise;
    replace("c");
    return "finished";
  });
  await started.promise;
  expect(api.read()).toBe("b");
  expect(editingState(session)).toMatchObject({
    busy: true,
    revision: "1",
    dirty: true,
  });
  gate.resolve();
  expect(await operation).toBe("finished");
  expect(api.read()).toBe("c");
  expect(editingState(session)).toMatchObject({
    busy: false,
    revision: "2",
    persistedRevision: "0",
    dirty: true,
  });
  await core.dispose();
});

test("returns typed values and does not revise no-op work", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  await editor(session).replace("a");
  expect(editingState(session)).toMatchObject({ revision: "0", dirty: false });
  expect(
    await editor(session).run(({ commit }) =>
      commit(() => ({ changed: false, value: 42 })),
    ),
  ).toBe(42);
  expect(await editor(session).run(async () => "no change")).toBe("no change");
  expect(editingState(session)).toMatchObject({ revision: "0", busy: false });
  await core.dispose();
});

test("denies policy and concurrent writers without invoking their work", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])));
  let invoked = 0;
  await expect(
    editor(session).run(() => {
      invoked++;
    }),
  ).rejects.toMatchObject({ code: "READ_ONLY" });
  session.setReadOnly(false);
  const started = deferred<void>();
  const gate = deferred<void>();
  const active = editor(session).run(async () => {
    started.resolve();
    await gate.promise;
  });
  await started.promise;
  await expect(
    editor(session).run(() => {
      invoked++;
    }),
  ).rejects.toMatchObject({ code: "EDIT_BUSY" });
  expect(invoked).toBe(0);
  gate.resolve();
  await active;
  await core.dispose();
});

test.each([false, true])(
  "keeps accepted progress after work failure (async=%j)",
  async (asyncFailure) => {
    const core = createOmniview({ plugins: [textPlugin()] });
    const session = await core.open(createSource(new Blob(["a"])), {
      readOnly: false,
    });
    const cause = new Error("work failed");
    await expect(
      editor(session).run(({ replace }) => {
        replace("b");
        if (asyncFailure) return Promise.reject(cause);
        throw cause;
      }),
    ).rejects.toMatchObject({ code: "EDIT_FAILED", cause });
    expect(editor(session).read()).toBe("b");
    expect(editingState(session)).toMatchObject({
      revision: "1",
      dirty: true,
      busy: false,
    });
    await core.dispose();
  },
);
