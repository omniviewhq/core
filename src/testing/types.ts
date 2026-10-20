import type {
  DocumentSession,
  OmniviewError,
  ReadableSource,
  SerializationResult,
} from "../index.ts";
import type {
  Cleanup,
  EditOptions,
  MaybePromise,
  PluginDefinition,
} from "../sdk/index.ts";
import type { PluginConformanceError } from "./errors.ts";

export interface PluginTestFixture {
  readonly plugin: PluginDefinition;
  createSource(): MaybePromise<ReadableSource>;
  readonly dispose?: Cleanup;
}

export interface PluginTestContext<T extends PluginTestFixture> {
  readonly fixture: T;
  readonly session: DocumentSession;
}

export interface PluginOutputContext<T extends PluginTestFixture> {
  readonly fixture: T;
  readonly output: SerializationResult;
  readonly expectedFingerprint: string;
}

export interface UnsupportedSourceCase<T extends PluginTestFixture> {
  readonly id: string;
  createSource(fixture: T): MaybePromise<ReadableSource>;
}

export interface ControlledLoad {
  readonly entered: PromiseLike<void>;
  readonly drained: PromiseLike<void>;
  release(): MaybePromise<void>;
}

export interface ControlledEdit extends ControlledLoad {
  readonly result: PromiseLike<void>;
}

export interface PluginEditingChecks<T extends PluginTestFixture> {
  change(
    context: PluginTestContext<T>,
    options: EditOptions,
  ): MaybePromise<void>;
  verifyChanged(context: PluginTestContext<T>): MaybePromise<void>;
  verifyOutput(context: PluginOutputContext<T>): MaybePromise<void>;
  noChange?: (
    context: PluginTestContext<T>,
    options: EditOptions,
  ) => MaybePromise<void>;
  pending?: (
    context: PluginTestContext<T>,
    options: EditOptions,
  ) => ControlledEdit;
}

export interface PluginTestSuiteOptions<T extends PluginTestFixture> {
  readonly id: string;
  createFixture(): MaybePromise<T>;
  verifyDocument(context: PluginTestContext<T>): MaybePromise<void>;
  fingerprint(context: PluginTestContext<T>): MaybePromise<string>;
  readonly editing: false | PluginEditingChecks<T>;
  readonly unsupported?: readonly UnsupportedSourceCase<T>[];
  pauseLoad?: (fixture: T) => MaybePromise<ControlledLoad>;
  verifyDisposed?: (fixture: T) => MaybePromise<void>;
  onLateError?: (error: PluginConformanceError) => void;
}

export interface PluginConformanceCase {
  readonly id: string;
  readonly name: string;
  run(): Promise<void>;
}

export interface PluginConformanceOmission {
  readonly id: string;
  readonly reason: string;
}

export interface PluginTestSuite {
  readonly id: string;
  readonly cases: readonly PluginConformanceCase[];
  readonly omitted: readonly PluginConformanceOmission[];
}

export type PluginConformancePhase = "fixture" | "check" | "cleanup";

export interface PluginConformanceErrorOptions extends ErrorOptions {
  readonly caseId: string;
  readonly phase: PluginConformancePhase;
  readonly diagnostics?: readonly OmniviewError[];
  readonly cleanupErrors?: readonly unknown[];
}
