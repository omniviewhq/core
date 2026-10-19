import { expect, test } from "bun:test";
import {
  createOmniview,
  createSource,
  type SerializationResult,
} from "../src/index.ts";
import { editingState, editor, textPlugin } from "./support/editing-fixture.ts";
import { deferred } from "./support/fixtures.ts";

test("a revision observer can acknowledge its earlier exact output without changing writer ownership", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  await editor(session).replace("first");
  const first = await session.serialize();
  let acked = false;
  const remove = session.subscribe(() => {
    if (!acked && editingState(session).revision === "2") {
      acked = true;
      session.markPersisted(first);
    }
  });
  await editor(session).replace("second");
  expect(acked).toBe(true);
  expect(editingState(session)).toMatchObject({
    revision: "2",
    persistedRevision: "1",
    dirty: true,
    busy: false,
  });
  remove();
  await core.dispose();
});

test("accepts only exact same-session receipts without changing model or redundant state", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const otherCore = createOmniview({ plugins: [textPlugin()] });
  const source = createSource(new Blob(["a"]));
  const session = await core.open(source, { readOnly: false });
  const other = await otherCore.open(source);
  await editor(session).replace("b");
  const result = await session.serialize();
  const before = session.getSnapshot();
  const foreign = await other.serialize();
  for (const invalid of [
    foreign,
    { ...result },
    JSON.parse(JSON.stringify(result)),
    {},
    null,
    "1",
    1,
  ]) {
    expect(() =>
      session.markPersisted(invalid as SerializationResult),
    ).toThrow();
    try {
      session.markPersisted(invalid as SerializationResult);
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_PERSISTENCE" });
    }
    expect(session.getSnapshot()).toBe(before);
  }
  session.setReadOnly(true);
  session.markPersisted(result);
  expect(editingState(session)).toMatchObject({
    revision: "1",
    persistedRevision: "1",
    dirty: false,
    readOnly: true,
  });
  const clean = session.getSnapshot();
  session.markPersisted(result);
  expect(session.getSnapshot()).toBe(clean);
  expect(editor(session).read()).toBe("b");
  await core.dispose();
  await otherCore.dispose();
});

test("encoding and failed host writes leave dirty state; old acknowledgement stays exact", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  await editor(session).replace("first");
  const first = await session.serialize();
  await expect(Promise.reject(new Error("host write failed"))).rejects.toThrow(
    "host write failed",
  );
  expect(editingState(session)).toMatchObject({
    persistedRevision: "0",
    dirty: true,
  });
  await editor(session).replace("second");
  session.markPersisted(first);
  expect(editingState(session)).toMatchObject({
    revision: "2",
    persistedRevision: "1",
    dirty: true,
  });
  await core.dispose();
});

test("acknowledgements preserve guards and cannot restore a disposed session", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = core.createSession(createSource(new Blob(["a"])));
  const fabricated = { revision: "0", source: createSource(new Blob()) };
  try {
    session.markPersisted(fabricated);
  } catch (error) {
    expect(error).toMatchObject({ code: "SESSION_NOT_READY" });
  }
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SESSION_NOT_READY",
  });
  await session.load();
  const result = await session.serialize();
  session.setReadOnly(false);
  let denied: unknown;
  await editor(session).run(({ commit }) =>
    commit(() => {
      try {
        session.markPersisted(result);
      } catch (error) {
        denied = error;
      }
      return { changed: true, value: undefined };
    }),
  );
  expect(denied).toMatchObject({ code: "EDIT_BUSY" });
  session.subscribe(() => {
    const state = session.getSnapshot();
    if (
      state.status === "ready" &&
      state.editing.supported &&
      !state.editing.dirty
    )
      void session.dispose();
  });
  const current = await session.serialize();
  session.markPersisted(current);
  expect(session.getSnapshot().status).toBe("disposed");
  try {
    session.markPersisted(result);
  } catch (error) {
    expect(error).toMatchObject({ code: "SESSION_CLOSED" });
  }
  await expect(session.serialize()).rejects.toMatchObject({
    code: "SESSION_CLOSED",
  });
  await core.dispose();
});

test("an older write finishing last makes the newer document dirty again", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  await editor(session).replace("first");
  const first = await session.serialize();
  await editor(session).replace("second");
  const second = await session.serialize();
  const oldGate = deferred<void>();
  const newGate = deferred<void>();
  let stored = "a";
  async function persist(
    result: SerializationResult,
    gate: Promise<void>,
  ): Promise<void> {
    const bytes = await result.source.read();
    await gate;
    stored = new TextDecoder().decode(bytes);
    session.markPersisted(result);
  }
  const oldWrite = persist(first, oldGate.promise);
  const newWrite = persist(second, newGate.promise);
  newGate.resolve();
  await newWrite;
  expect(stored).toBe("second");
  expect(editingState(session)).toMatchObject({
    persistedRevision: "2",
    dirty: false,
  });
  oldGate.resolve();
  await oldWrite;
  expect(stored).toBe("first");
  expect(editor(session).read()).toBe("second");
  expect(editingState(session)).toMatchObject({
    revision: "2",
    persistedRevision: "1",
    dirty: true,
  });
  await core.dispose();
});
