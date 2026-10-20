import { expect, test } from "bun:test";
import {
  createPluginTestSuite,
  PluginConformanceError,
  type PluginTestFixture,
  type PluginTestSuiteOptions,
} from "../src/testing/index.ts";
import {
  editableSuiteOptions,
  viewerSuiteOptions,
} from "./support/conformance-fixture.ts";

async function run<T extends PluginTestFixture>(
  options: PluginTestSuiteOptions<T>,
  suffix: string,
): Promise<void> {
  const item = createPluginTestSuite(options).cases.find(
    (entry) => entry.id === `${options.id}/${suffix}`,
  );
  if (!item) throw new Error(`Missing case ${suffix}`);
  await item.run();
}

test("detection checks actual viewer content and declared editing support", async () => {
  await run(viewerSuiteOptions(), "open/detection");
  await run(editableSuiteOptions(), "open/detection");
  await expect(
    run(viewerSuiteOptions({ wrongContent: true }), "open/detection"),
  ).rejects.toMatchObject({
    phase: "check",
    cause: new Error("Expected initial viewer text"),
  });
  await expect(
    run(viewerSuiteOptions({ detects: false }), "open/detection"),
  ).rejects.toBeInstanceOf(PluginConformanceError);
});

test("explicit opening bypasses detection and still verifies content", async () => {
  await run(viewerSuiteOptions({ detects: false }), "open/explicit");
  await expect(
    run(viewerSuiteOptions({ wrongContent: true }), "open/explicit"),
  ).rejects.toMatchObject({ phase: "check" });
});

test("lifetime checks guards, immutable snapshots and core membership", async () => {
  await run(viewerSuiteOptions(), "session/lifetime");
  await run(editableSuiteOptions(), "session/lifetime");
});

test("independence detects shared content state after another document closes", async () => {
  await run(viewerSuiteOptions(), "session/independence");
  await run(editableSuiteOptions(), "session/independence");
  await expect(
    run(viewerSuiteOptions({ sharedState: true }), "session/independence"),
  ).rejects.toMatchObject({
    phase: "check",
    cause: new Error("Expected initial viewer text"),
  });
});

test("pre-aborted loads retain their cancellation reason", async () => {
  await run(viewerSuiteOptions(), "load/pre-aborted");
});

test("immediate disposal cancels a queued load and stays terminal", async () => {
  await run(viewerSuiteOptions(), "load/queued-dispose");
});

test("source ownership checks actual bytes and independent read buffers", async () => {
  await run(viewerSuiteOptions(), "source/ownership");
  const options = viewerSuiteOptions();
  await expect(
    run(
      {
        ...options,
        async createFixture() {
          const fixture = await options.createFixture();
          const bytes = new TextEncoder().encode("before");
          return {
            ...fixture,
            createSource: () => ({
              name: "document.txt",
              mimeType: "text/plain",
              size: bytes.length,
              read: async () => bytes,
            }),
          };
        },
      },
      "source/ownership",
    ),
  ).rejects.toMatchObject({ phase: "check" });
});

test("unsupported sources reject detection and remove temporary sessions", async () => {
  await run(viewerSuiteOptions(), "unsupported/binary");
  const options = viewerSuiteOptions();
  await expect(
    run(
      {
        ...options,
        unsupported: [
          {
            id: "text",
            async createSource(fixture) {
              return fixture.createSource();
            },
          },
        ],
      },
      "unsupported/text",
    ),
  ).rejects.toMatchObject({ phase: "check" });
  const cause = new Error("Cannot obtain unsupported source");
  await expect(
    run(
      {
        ...options,
        unsupported: [
          {
            id: "failed",
            createSource() {
              throw cause;
            },
          },
        ],
      },
      "unsupported/failed",
    ),
  ).rejects.toMatchObject({ phase: "fixture", cause });
});

test("plugin cleanup checks resource assertions before environment cleanup", async () => {
  const options = viewerSuiteOptions();
  const order: string[] = [];
  await run(
    {
      ...options,
      async createFixture() {
        return {
          ...(await options.createFixture()),
          dispose() {
            order.push("environment");
          },
        };
      },
      verifyDisposed(fixture) {
        options.verifyDisposed?.(fixture);
        order.push("resources");
      },
    },
    "cleanup/plugin",
  );
  expect(order).toEqual(["resources", "environment"]);
  await expect(
    run(viewerSuiteOptions({ leak: true }), "cleanup/plugin"),
  ).rejects.toMatchObject({
    phase: "cleanup",
    cleanupErrors: [new Error("Plugin resource leak")],
  });
});
