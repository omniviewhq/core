import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import type { MutationResult } from "../src/sdk/index.ts";
import { editingState, editor, textPlugin } from "./support/editing-fixture.ts";

test.each([
  null,
  1,
  {},
  { changed: "yes", value: 1 },
  { changed: true },
  Promise.resolve({ changed: true, value: 1 }),
])("denies malformed change results %j conservatively", async (value) => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  await expect(
    editor(session).run(({ commit }) =>
      commit(() => value as unknown as MutationResult<unknown>),
    ),
  ).rejects.toMatchObject({ code: "EDIT_FAILED" });
  expect(editingState(session)).toMatchObject({
    revision: "1",
    dirty: true,
    busy: false,
  });
  await core.dispose();
});

test("captures result fields once and preserves a thrown null", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  let changedReads = 0;
  let valueReads = 0;
  expect(
    await editor(session).run(({ commit }) =>
      commit(() => ({
        get changed() {
          changedReads++;
          return true;
        },
        get value() {
          valueReads++;
          return "value";
        },
      })),
    ),
  ).toBe("value");
  expect([changedReads, valueReads]).toEqual([1, 1]);
  await expect(
    editor(session).run(({ commit }) =>
      commit(() => ({
        get changed(): never {
          throw null;
        },
        value: undefined,
      })),
    ),
  ).rejects.toMatchObject({ code: "EDIT_FAILED", cause: null });
  await core.dispose();
});

test("a caught failed commit still rejects the operation and stays dirty", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const cause = new Error("change failed");
  let retainedFailure: unknown;
  const operation = editor(session).run(({ commit }) => {
    try {
      commit(() => {
        throw cause;
      });
    } catch (error) {
      retainedFailure = error;
    }
    return "plugin caught the synchronous exception";
  });
  await expect(operation).rejects.toMatchObject({ code: "EDIT_FAILED", cause });
  expect(retainedFailure).toMatchObject({ code: "EDIT_FAILED", cause });
  expect(editingState(session)).toMatchObject({
    revision: "1",
    dirty: true,
    busy: false,
  });
  expect(session.getSnapshot().status).toBe("ready");
  await editor(session).replace("recovered");
  expect(editingState(session).revision).toBe("2");
  await core.dispose();
});

test("observes rejected async changes without allowing them to pass as commits", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  await expect(
    editor(session).run(({ commit }) =>
      commit(
        () =>
          Promise.reject(
            new Error("late change"),
          ) as unknown as MutationResult<void>,
      ),
    ),
  ).rejects.toMatchObject({ code: "EDIT_FAILED" });
  expect(editingState(session).revision).toBe("1");
  await core.dispose();
});
