import { expect, test } from "bun:test";
import { createSource, OmniviewError } from "../src/index.ts";
import {
  defineCapability,
  definePlugin,
  type EditOptions,
  provideCapability,
} from "../src/sdk/index.ts";
import {
  createPluginTestSuite,
  type PluginTestFixture,
  type PluginTestSuiteOptions,
} from "../src/testing/index.ts";
import { editableSuiteOptions } from "./support/conformance-fixture.ts";
import { deferred } from "./support/fixtures.ts";

const mutantText = defineCapability<{
  read(): string;
  replace(value: string, options: EditOptions): Promise<void>;
}>("fixture.mutant:text");
function mutantOptions(
  mode: "unguarded" | "live" | "disabled" | "metadata",
): PluginTestSuiteOptions<PluginTestFixture> {
  return {
    id: "mutant",
    editing: {
      async change({ session }, options) {
        const api = session.getCapability(mutantText);
        if (!api) throw new Error("Missing text");
        await api.replace("after", options);
      },
      verifyChanged({ session }) {
        if (session.getCapability(mutantText)?.read() !== "after")
          throw new Error("Wrong changed text");
      },
      async verifyOutput({ output, expectedFingerprint }) {
        if (
          new TextDecoder().decode(await output.source.read()) !==
          expectedFingerprint
        )
          throw new Error("Live model leaked into snapshot");
      },
    },
    createFixture() {
      const encoded = deferred<void>();
      return {
        plugin: definePlugin({
          id: "fixture/mutant",
          apiVersion: 1,
          supports: () => true,
          async open({ source, edit }) {
            let text = new TextDecoder().decode(await source.read());
            let changedBefore = false;
            let disabled = false;
            return {
              capabilities: [
                provideCapability(mutantText, {
                  read: () => text,
                  async replace(next, options) {
                    if (disabled)
                      throw new Error("Permanently disabled after read-only");
                    if (mode === "unguarded") {
                      text = next;
                      return;
                    }
                    try {
                      await edit(
                        ({ commit }) =>
                          commit(() => {
                            const changed = text !== next;
                            text = next;
                            return { changed, value: undefined };
                          }),
                        options,
                      );
                    } catch (error) {
                      if (
                        mode === "disabled" &&
                        changedBefore &&
                        error instanceof OmniviewError &&
                        error.code === "READ_ONLY"
                      )
                        disabled = true;
                      throw error;
                    }
                    changedBefore = true;
                    encoded.resolve();
                  },
                }),
              ],
              editing: {
                capture() {
                  const captured = text;
                  return {
                    async serialize() {
                      if (mode === "metadata")
                        Object.assign(source, { name: "corrupted" });
                      if (mode === "live") await encoded.promise;
                      return {
                        data: new TextEncoder().encode(
                          mode === "live" ? text : captured,
                        ),
                      };
                    },
                  };
                },
              },
            };
          },
        }),
        createSource: () => ({ ...createSource(new Blob(["before"])) }),
      };
    },
    verifyDocument({ session }) {
      if (session.getCapability(mutantText)?.read() !== "before")
        throw new Error("Wrong initial text");
    },
    fingerprint({ session }) {
      const api = session.getCapability(mutantText);
      if (!api) throw new Error("Missing text");
      return api.read();
    },
  };
}

async function run<T extends PluginTestFixture>(
  options: PluginTestSuiteOptions<T>,
  suffix: string,
): Promise<void> {
  const entry = createPluginTestSuite(options).cases.find(
    (item) => item.id === `${options.id}/${suffix}`,
  );
  if (!entry) throw new Error(`Missing case ${suffix}`);
  await entry.run();
}

test("read-only checks call the real capability and leave content untouched", async () => {
  await run(editableSuiteOptions(), "editing/default-readonly");
});

test("detects a capability permanently disabled by a previous read-only rejection", async () => {
  await expect(
    run(mutantOptions("disabled"), "editing/policy"),
  ).rejects.toMatchObject({
    phase: "check",
    cause: new Error("Permanently disabled after read-only"),
  });
});

test("detects capture corrupting original input metadata while encoding correct bytes", async () => {
  await expect(
    run(mutantOptions("metadata"), "serialization/initial"),
  ).rejects.toMatchObject({
    phase: "check",
    cause: new Error("Serialization changed original source metadata"),
  });
});

test("permission checks admit actual changes and enforce overrides and revocation", async () => {
  await run(editableSuiteOptions(), "editing/policy");
});

test.each([
  "editing/change",
  "editing/noop",
  "editing/independence",
  "editing/closed",
])("executes real editable integration %s", async (suffix) => {
  await run(editableSuiteOptions(), suffix);
});

test("exports the read-only initial document without marking it persisted", async () => {
  await run(editableSuiteOptions(), "serialization/initial");
});

test.each([
  "serialization/pre-aborted",
  "serialization/capture",
  "serialization/concurrent",
  "serialization/ownership",
])("checks independent serialized output: %s", async (suffix) => {
  await run(editableSuiteOptions(), suffix);
});

test.each(["persistence/receipts", "persistence/ordering"])(
  "checks exact persistence acknowledgements: %s",
  async (suffix) => {
    await run(editableSuiteOptions(), suffix);
  },
);

test("detects actual unguarded plugin mutation", async () => {
  await expect(
    run(mutantOptions("unguarded"), "editing/default-readonly"),
  ).rejects.toMatchObject({ phase: "check" });
});

test("detects delayed live-model encoding through the real output verifier", async () => {
  await expect(
    run(mutantOptions("live"), "serialization/capture"),
  ).rejects.toMatchObject({
    phase: "check",
    cause: new Error("Live model leaked into snapshot"),
  });
});
