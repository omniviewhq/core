import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { editingState, editor, textPlugin } from "./support/editing-fixture.ts";
import { deferred, fixturePlugin } from "./support/fixtures.ts";

test("models, writer signals, receipts and membership are isolated across sessions and cores", async () => {
  const plugin = textPlugin();
  const firstCore = createOmniview({ plugins: [plugin] });
  const secondCore = createOmniview({ plugins: [plugin] });
  const source = createSource(new Blob(["original"]), { name: "input.txt" });
  const first = await firstCore.open(source, { readOnly: false });
  const second = await firstCore.open(source, { readOnly: false });
  const third = await secondCore.open(source, { readOnly: false });
  const gate = deferred<void>();
  const started = deferred<void>();
  let signal!: AbortSignal;
  const pending = editor(first)
    .run(async (context) => {
      signal = context.signal;
      context.replace("first");
      started.resolve();
      await gate.promise;
    })
    .catch((error: unknown) => error);
  await started.promise;
  const secondGate = deferred<void>();
  const secondStarted = deferred<void>();
  let otherSignal!: AbortSignal;
  const otherPending = editor(second).run(async (context) => {
    otherSignal = context.signal;
    context.replace("second");
    secondStarted.resolve();
    await secondGate.promise;
  });
  await secondStarted.promise;
  await editor(third).replace("third");
  const outputs = await Promise.all([
    first.serialize(),
    second.serialize(),
    third.serialize(),
  ]);
  const [firstResult, secondResult, thirdResult] = outputs;
  if (!firstResult || !secondResult || !thirdResult)
    throw new Error("Missing output");
  expect(outputs.map((output) => output.revision)).toEqual(["1", "1", "1"]);
  expect(() => second.markPersisted(firstResult)).toThrow();
  expect(() => second.markPersisted(thirdResult)).toThrow();
  first.setReadOnly(true);
  expect(await pending).toMatchObject({ code: "CANCELLED" });
  expect(signal.aborted).toBe(true);
  expect(otherSignal.aborted).toBe(false);
  expect(editingState(second)).toMatchObject({
    busy: true,
    readOnly: false,
    dirty: true,
  });
  await first.dispose();
  gate.resolve();
  expect(firstCore.getSessions()).toEqual([second]);
  expect(secondCore.getSessions()).toEqual([third]);
  second.markPersisted(secondResult);
  third.markPersisted(thirdResult);
  secondGate.resolve();
  await otherPending;
  expect(editor(second).read()).toBe("second");
  expect(editor(third).read()).toBe("third");
  expect(editingState(second)).toMatchObject({ busy: false, dirty: false });
  expect(new TextDecoder().decode(await firstResult.source.read())).toBe(
    "first",
  );
  expect(new TextDecoder().decode(await source.read())).toBe("original");
  await firstCore.dispose();
  expect(otherSignal.aborted).toBe(false);
  expect(third.getSnapshot().status).toBe("ready");
  await secondCore.dispose();
});

test("editing transitions preserve the initial load promise and viewer-only guards", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = core.createSession(createSource(new Blob(["a"])), {
    readOnly: false,
  });
  const loading = session.load();
  await loading;
  await editor(session).replace("b");
  const result = await session.serialize();
  session.markPersisted(result);
  session.setReadOnly(true);
  expect(session.load()).toBe(loading);
  const viewerCore = createOmniview({ plugins: [fixturePlugin()] });
  const viewer = await viewerCore.open(createSource(new Blob()));
  await expect(viewer.serialize()).rejects.toMatchObject({
    code: "EDITING_UNSUPPORTED",
  });
  expect(() => viewer.markPersisted(result)).toThrow();
  try {
    viewer.markPersisted(result);
  } catch (error) {
    expect(error).toMatchObject({ code: "EDITING_UNSUPPORTED" });
  }
  await core.dispose();
  await viewerCore.dispose();
});
