import { expect, test } from "bun:test";
import {
  createOmniview,
  createSource,
  type OmniviewError,
} from "../src/index.ts";
import {
  defineCapability,
  type PluginContext,
  provideCapability,
} from "../src/sdk/index.ts";
import { editingState, editor, textPlugin } from "./support/editing-fixture.ts";
import { fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["a"]));

test("nested policy notifications preserve the revision commit guard", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(source, { readOnly: false });
  let retained!: import("./support/editing-fixture.ts").TextWork;
  let toggled = false;
  let denied: unknown;
  const remove = session.subscribe(() => {
    if (editingState(session).revision !== "1" || toggled) return;
    toggled = true;
    session.setReadOnly(true);
    session.setReadOnly(false);
    try {
      retained.replace("nested");
    } catch (error) {
      denied = error;
    }
  });
  const result = editor(session)
    .run((context) => {
      retained = context;
      context.replace("b");
    })
    .catch((error: unknown) => error);
  expect(await result).toMatchObject({ code: "CANCELLED" });
  expect(denied).toMatchObject({ code: "CANCELLED" });
  expect(editingState(session)).toMatchObject({
    revision: "1",
    readOnly: false,
    busy: false,
  });
  remove();
  await core.dispose();
});

test("denies nested commits during revision publication", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(source, { readOnly: false });
  const attempts: unknown[] = [];
  await editor(session).run((work) => {
    const remove = session.subscribe(() => {
      if (editingState(session).revision === "1") {
        try {
          work.commit(() => ({ changed: true, value: undefined }));
        } catch (error) {
          attempts.push(error);
        }
      }
    });
    try {
      work.replace("b");
    } finally {
      remove();
    }
  });
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ code: "EDIT_BUSY" });
  expect(editingState(session).revision).toBe("1");
  await core.dispose();
});

test.each(["revoke", "dispose"] as const)(
  "a busy observer can %s before queued work",
  async (action) => {
    const core = createOmniview({ plugins: [textPlugin()] });
    const session = await core.open(source, { readOnly: false });
    const api = editor(session);
    let invoked = false;
    session.subscribe(() => {
      const state = session.getSnapshot();
      if (
        state.status === "ready" &&
        state.editing.supported &&
        state.editing.busy
      ) {
        if (action === "revoke") session.setReadOnly(true);
        else void session.dispose();
      }
    });
    await expect(
      api.run(() => {
        invoked = true;
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(invoked).toBe(false);
    await core.dispose();
  },
);

test("observer failures cannot fail accepted edits or change their revisions", async () => {
  const errors: OmniviewError[] = [];
  const core = createOmniview({
    plugins: [textPlugin()],
    onError: (error) => errors.push(error),
  });
  const session = await core.open(source, { readOnly: false });
  const states: string[] = [];
  const remove = session.subscribe(() => {
    throw new Error("observer");
  });
  session.subscribe(() => {
    states.push(editingState(session).revision);
  });
  await editor(session).replace("b");
  expect(states).toEqual(["0", "1", "1"]);
  expect(errors).toHaveLength(3);
  expect(errors.every((error) => error.code === "OBSERVER_FAILED")).toBe(true);
  expect(
    JSON.parse(JSON.stringify(session.getSnapshot())).editing.revision,
  ).toBe("1");
  remove();
  await core.dispose();
});

test("initialization and viewer-only operations respect the managed lifetime", async () => {
  const key = defineCapability<{ run: PluginContext["edit"] }>("fixture:run");
  let early!: Promise<unknown>;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open({ edit }) {
          early = edit(() => {}).catch((error: unknown) => error);
          return { capabilities: [provideCapability(key, { run: edit })] };
        },
      }),
    ],
  });
  const session = await core.open(source);
  expect(await early).toMatchObject({ code: "SESSION_NOT_READY" });
  const api = session.getCapability(key);
  if (!api) throw new Error("missing capability");
  await expect(api.run(() => {})).rejects.toMatchObject({
    code: "EDITING_UNSUPPORTED",
  });
  await core.dispose();
});

test("abort inside a change publishes only the accepted revision", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(source, { readOnly: false });
  const controller = new AbortController();
  const seen: string[] = [];
  const api = editor(session);
  const remove = session.subscribe(() => {
    seen.push(`${editingState(session).revision}:${api.read()}`);
  });
  const pending = api
    .run(
      ({ commit, replace }) => {
        commit(() => {
          // Cancellation must not publish while the mutation result is undecided.
          controller.abort("during change");
          expect(() => replace("nested")).toThrow();
          return { changed: true, value: undefined };
        });
      },
      { signal: controller.signal },
    )
    .catch((error: unknown) => error);
  expect(await pending).toMatchObject({
    code: "CANCELLED",
    cause: "during change",
  });
  expect(seen).toEqual(["0:a", "1:a"]);
  expect(editingState(session)).toMatchObject({ revision: "1", busy: false });
  remove();
  await core.dispose();
});
