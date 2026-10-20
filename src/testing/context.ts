import type {
  DocumentSession,
  Omniview,
  ReadableSource,
  SessionOptions,
} from "../index.ts";
import type { MaybePromise } from "../plugins/types.ts";
import type { Configuration } from "./config.ts";
import type { HeldEdit, HeldLoad } from "./control.ts";
import type {
  ControlledEdit,
  ControlledLoad,
  PluginTestFixture,
} from "./types.ts";

/** Private scenario seam using only public runtime operations. */
export interface RunContext<T extends PluginTestFixture> {
  readonly fixture: T;
  readonly options: Configuration<T>;
  core(readOnly?: boolean): Omniview;
  source(factory?: () => MaybePromise<ReadableSource>): Promise<ReadableSource>;
  open(
    core: Omniview,
    options?: SessionOptions,
    source?: ReadableSource,
  ): Promise<DocumentSession>;
  createSession(
    core: Omniview,
    source: ReadableSource,
    options?: SessionOptions,
  ): DocumentSession;
  dispose(target: Pick<DocumentSession, "dispose">): Promise<void>;
  verify(session: DocumentSession): Promise<void>;
  fingerprint(session: DocumentSession): Promise<string>;
  verification(start: () => MaybePromise<void>): Promise<void>;
  loadControl(start: () => MaybePromise<ControlledLoad>): Promise<HeldLoad>;
  editControl(start: () => ControlledEdit): HeldEdit;
}

/** One immutable case definition, prior to suite-specific naming. */
export interface Scenario<T extends PluginTestFixture> {
  readonly suffix: string;
  readonly name: string;
  run(context: RunContext<T>): MaybePromise<void>;
}
