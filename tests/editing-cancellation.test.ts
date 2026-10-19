import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import type { TextWork } from "./support/editing-fixture.ts";
import { editingState, editor, textPlugin } from "./support/editing-fixture.ts";
import { deferred } from "./support/fixtures.ts";

test.each(["dispose", "revoke"] as const)(
  "rechecks admission after a signal getter can %s",
  async (action) => {
    const core = createOmniview({ plugins: [textPlugin()] });
    const session = await core.open(createSource(new Blob(["a"])), {
      readOnly: false,
    });
    const api = editor(session);
    let called = false;
    let reads = 0;
    const outcome = api
      .run(
        () => {
          called = true;
        },
        {
          get signal() {
            reads++;
            if (action === "dispose") void session.dispose();
            else session.setReadOnly(true);
            return new AbortController().signal;
          },
        },
      )
      .catch((error: unknown) => error);
    expect(await outcome).toMatchObject({
      code: action === "dispose" ? "SESSION_CLOSED" : "READ_ONLY",
    });
    expect(called).toBe(false);
    expect(reads).toBe(1);
    await core.dispose();
  },
);

test("a throwing signal getter rejects through the contextual promise contract", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const cause = new Error("option access");
  const operation = editor(session).run(() => {}, {
    get signal(): never {
      throw cause;
    },
  });
  await expect(operation).rejects.toMatchObject({
    code: "EDIT_FAILED",
    cause,
    context: { sessionId: session.id, pluginId: "fixture/editable-text" },
  });
  await core.dispose();
});

test.each(["before", "queued"] as const)(
  "cancels %s work without invoking it",
  async (stage) => {
    const core = createOmniview({ plugins: [textPlugin()] });
    const session = await core.open(createSource(new Blob(["a"])), {
      readOnly: false,
    });
    const controller = new AbortController();
    const reason = new Error("cancel");
    let called = false;
    if (stage === "before") controller.abort(reason);
    const outcome = editor(session)
      .run(
        () => {
          called = true;
        },
        { signal: controller.signal },
      )
      .catch((error: unknown) => error);
    controller.abort(reason);
    expect(await outcome).toMatchObject({ code: "CANCELLED", cause: reason });
    expect(called).toBe(false);
    expect(editingState(session)).toMatchObject({ revision: "0", busy: false });
    await core.dispose();
  },
);

test("revokes permission after progress and denies retained contexts after re-enable", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const started = deferred<void>();
  const ignored = deferred<void>();
  let retained!: TextWork;
  const result = editor(session)
    .run(async (work) => {
      retained = work;
      work.replace("b");
      started.resolve();
      await ignored.promise;
    })
    .catch((error: unknown) => error);
  await started.promise;
  session.setReadOnly(true);
  expect(await result).toMatchObject({
    code: "CANCELLED",
    cause: { code: "READ_ONLY" },
  });
  expect(editor(session).read()).toBe("b");
  expect(editingState(session)).toMatchObject({
    revision: "1",
    dirty: true,
    busy: false,
    readOnly: true,
  });
  session.setReadOnly(false);
  expect(() => retained.replace("stale")).toThrow(
    expect.objectContaining({ code: "CANCELLED" }),
  );
  ignored.resolve();
  await editor(session).replace("c");
  await core.dispose();
});

test("completed contexts cannot commit and their caller signals are unlinked", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const external = new AbortController();
  let retained!: TextWork;
  await editor(session).run(
    (work) => {
      retained = work;
      work.replace("b");
    },
    { signal: external.signal },
  );
  external.abort("after success");
  expect(retained.signal.aborted).toBe(false);
  expect(() => retained.replace("later")).toThrow(
    expect.objectContaining({ code: "CANCELLED" }),
  );
  const api = editor(session);
  await session.dispose();
  await expect(api.replace("closed")).rejects.toMatchObject({
    code: "SESSION_CLOSED",
  });
  expect(() => retained.replace("closed")).toThrow(
    expect.objectContaining({ code: "SESSION_CLOSED" }),
  );
  await core.dispose();
});

test("disposal aborts active work without waiting for its promise", async () => {
  const started = deferred<void>();
  const ignored = deferred<void>();
  let retained!: AbortSignal;
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const result = editor(session)
    .run(async ({ signal }) => {
      retained = signal;
      started.resolve();
      await ignored.promise;
    })
    .catch((error: unknown) => error);
  await started.promise;
  await session.dispose();
  expect(retained.aborted).toBe(true);
  expect(await result).toMatchObject({
    code: "CANCELLED",
    cause: { code: "SESSION_CLOSED" },
  });
  ignored.reject(new Error("late work rejection"));
  await core.dispose();
});

test("a cancelled old writer cannot change a newer operation", async () => {
  const started = deferred<void>();
  const releaseOld = deferred<void>();
  const stale = deferred<unknown>();
  const controller = new AbortController();
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const api = editor(session);
  const old = api.run(
    async ({ replace }) => {
      replace("first");
      started.resolve();
      await releaseOld.promise;
      try {
        replace("stale");
      } catch (error) {
        stale.resolve(error);
      }
    },
    { signal: controller.signal },
  );
  const rejected = old.catch((error: unknown) => error);
  await started.promise;
  const reason = new Error("cancel first writer");
  controller.abort(reason);
  expect(await rejected).toMatchObject({ code: "CANCELLED", cause: reason });
  const nextStarted = deferred<void>();
  const releaseNext = deferred<void>();
  const next = api.run(async ({ replace }) => {
    nextStarted.resolve();
    await releaseNext.promise;
    replace("newer");
  });
  await nextStarted.promise;
  releaseOld.resolve();
  expect(await stale.promise).toMatchObject({ code: "CANCELLED" });
  expect(editingState(session).busy).toBe(true);
  releaseNext.resolve();
  await next;
  expect(api.read()).toBe("newer");
  expect(editingState(session)).toMatchObject({
    revision: "2",
    dirty: true,
    busy: false,
  });
  await core.dispose();
});
