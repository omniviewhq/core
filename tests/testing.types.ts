import * as host from "../src/index.ts";
import { createSource, type DocumentSession } from "../src/index.ts";
import * as sdk from "../src/sdk/index.ts";
import { definePlugin, type EditOptions } from "../src/sdk/index.ts";
import {
  type ControlledEdit,
  createPluginTestSuite,
  type PluginConformanceCase,
  type PluginConformanceError,
  type PluginTestFixture,
  type PluginTestSuite,
  type PluginTestSuiteOptions,
} from "../src/testing/index.ts";

export function checkInference(): void {
  const suite = createPluginTestSuite({
    id: "typed.viewer",
    createFixture: async () => ({
      marker: 42,
      plugin: definePlugin({
        id: "typed/viewer",
        apiVersion: 1,
        supports: () => true,
        open: () => ({}),
      }),
      createSource: () => createSource(new Blob()),
    }),
    verifyDocument({ fixture, session }) {
      const number: number = fixture.marker;
      const document: DocumentSession = session;
      void [number, document];
    },
    fingerprint: ({ fixture }) => String(fixture.marker),
    editing: false,
  });
  const readonlySuite: PluginTestSuite = suite;
  // @ts-expect-error Root does not load or re-export testing.
  host.createPluginTestSuite;
  // @ts-expect-error SDK does not load or re-export testing.
  sdk.PluginConformanceError;
  void readonlySuite;
}

export function checkReadonly(
  suite: PluginTestSuite,
  entry: PluginConformanceCase,
  error: PluginConformanceError,
): void {
  const running: Promise<void> = entry.run();
  // @ts-expect-error Cases are immutable.
  suite.cases.push(entry);
  // @ts-expect-error Omission reporting is immutable.
  suite.omitted.push({ id: "fake", reason: "fake" });
  // @ts-expect-error Case identity cannot be changed.
  entry.id = "changed";
  // @ts-expect-error Diagnostic snapshots cannot be changed.
  error.diagnostics.push(new host.OmniviewError("CANCELLED", "changed"));
  // @ts-expect-error Error phase is readonly.
  error.phase = "fixture";
  void running;
}

export function checkProfiles(
  base: PluginTestSuiteOptions<PluginTestFixture>,
): void {
  const editable: PluginTestSuiteOptions<PluginTestFixture> = {
    ...base,
    editing: {
      change({ session }, options) {
        const permission: EditOptions = options;
        void [session, permission];
      },
      verifyChanged() {},
      verifyOutput({ output, expectedFingerprint }) {
        const fingerprint: string = expectedFingerprint;
        const revision: string = output.revision;
        void [fingerprint, revision];
      },
      // @ts-expect-error Pending operations are synchronous control boxes.
      pending: async (): Promise<ControlledEdit> => ({
        result: Promise.resolve(),
        entered: Promise.resolve(),
        drained: Promise.resolve(),
        release() {},
      }),
    },
  };
  const incomplete = {
    id: "missing",
    createFixture: base.createFixture,
    verifyDocument: base.verifyDocument,
    fingerprint: base.fingerprint,
  };
  // @ts-expect-error Declare viewer-only or editable support explicitly.
  createPluginTestSuite(incomplete);
  const invalid: PluginTestSuiteOptions<PluginTestFixture> = {
    ...base,
    // @ts-expect-error Editable profiles require their actual output adapter.
    editing: { change() {}, verifyChanged() {} },
  };
  void [editable, invalid];
}
