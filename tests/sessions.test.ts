import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";

test("creates a managed session before opening its document", async () => {
  const core = createOmniview({
    plugins: [
      {
        id: "text",
        apiVersion: 1,
        supports: () => true,
        open: async () => ({}),
      },
    ],
  });
  const session = core.createSession(createSource(new Blob(["hello"])));
  expect(session.getSnapshot().status).toBe("created");
  expect(core.getSessions()).toEqual([session]);
  await session.load();
  expect(session.getSnapshot()).toMatchObject({
    status: "ready",
    pluginId: "text",
  });
  await core.dispose();
  expect(session.getSnapshot().status).toBe("disposed");
});

test("publishes immutable stable snapshots and releases subscriptions", async () => {
  const core = createOmniview({
    plugins: [
      { id: "text", apiVersion: 1, supports: () => true, open: () => ({}) },
    ],
  });
  const session = core.createSession(createSource(new Blob(["hello"])));
  const initial = session.getSnapshot();
  expect(session.getSnapshot()).toBe(initial);
  const states: string[] = [];
  session.subscribe(() => states.push(session.getSnapshot().status));
  await session.load();
  await session.dispose();
  expect(states).toEqual(["loading", "ready", "disposed"]);
  expect(Object.isFrozen(initial)).toBe(true);
  expect(Object.isFrozen(initial.source)).toBe(true);
  session.subscribe(() => {
    throw new Error("closed listener");
  })();
  await session.dispose();
  expect(states).toHaveLength(3);
  await core.dispose();
});
