import { expect, spyOn, test } from "bun:test";
import {
  createOmniview,
  createSource,
  type OmniviewError,
} from "../src/index.ts";
import { fixturePlugin } from "./support/fixtures.ts";

const source = createSource(new Blob(["a"]));

test("reentrant load shares its promise and independent subscriptions can be removed", async () => {
  let opened = 0;
  const core = createOmniview({
    plugins: [
      fixturePlugin({
        open() {
          opened++;
          return {};
        },
      }),
    ],
  });
  const session = core.createSession(source);
  let repeated: Promise<void> | undefined;
  let calls = 0;
  const listener = () => {
    calls++;
  };
  const remove = session.subscribe(listener);
  session.subscribe(listener);
  session.subscribe(() => {
    if (session.getSnapshot().status === "loading") repeated = session.load();
  });
  const loading = session.load();
  expect(repeated).toBe(loading);
  remove();
  remove();
  await loading;
  expect(session.load()).toBe(loading);
  expect(opened).toBe(1);
  expect(calls).toBe(3);
  await session.dispose();
  expect(calls).toBe(4);
  await core.dispose();
});

test("skips observers removed before their turn", async () => {
  const core = createOmniview({ plugins: [fixturePlugin()] });
  const session = core.createSession(source);
  let calls = 0;
  session.subscribe(() => remove());
  const remove = session.subscribe(() => {
    calls++;
  });
  await session.load();
  expect(calls).toBe(0);
  await core.dispose();
});

test("isolates observer errors and continues notifying", async () => {
  const errors: OmniviewError[] = [];
  const core = createOmniview({
    plugins: [fixturePlugin()],
    onError: (error) => errors.push(error),
  });
  const session = core.createSession(source);
  const cause = new Error("observer");
  session.subscribe(() => {
    throw cause;
  });
  const states: string[] = [];
  session.subscribe(() => states.push(session.getSnapshot().status));
  await session.load();
  await core.dispose();
  expect(states).toEqual(["loading", "ready", "disposed"]);
  expect(errors).toHaveLength(3);
  expect(errors[0]).toMatchObject({
    code: "OBSERVER_FAILED",
    cause,
    context: { sessionId: session.id },
  });
});

test.each([false, true])(
  "reports diagnostic failures safely (throwing handler=%j)",
  async (throwing) => {
    const output = spyOn(console, "error").mockImplementation(() => {});
    try {
      const core = createOmniview({
        plugins: [],
        ...(throwing
          ? {
              onError() {
                throw new Error("sink");
              },
            }
          : {}),
      });
      const session = core.createSession(source);
      session.subscribe(() => {
        throw new Error("observer");
      });
      await core.dispose();
      expect(output).toHaveBeenCalledTimes(1);
      expect(output.mock.calls[0]?.[0]).toMatchObject({
        code: "OBSERVER_FAILED",
      });
    } finally {
      output.mockRestore();
    }
  },
);
