import type { DocumentSession, SourceMetadata } from "../../index.ts";
import { defineCapability } from "../../sdk/index.ts";
import { BoundaryFailure, check, observe, rejects } from "../assertions.ts";
import type { Configuration } from "../config.ts";
import type { RunContext, Scenario } from "../context.ts";
import type { PluginTestFixture } from "../types.ts";

const unavailable = defineCapability<object>("omniview.testing:unavailable");

function metadata(session: DocumentSession, source: SourceMetadata): void {
  const actual = session.getSnapshot().source;
  check(actual.name === source.name, "Original source name differs");
  check(
    actual.mimeType === source.mimeType,
    "Original source MIME type differs",
  );
  check(actual.size === source.size, "Original source size differs");
}

function sameBytes(actual: Uint8Array, expected: Uint8Array): boolean {
  return (
    actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index])
  );
}

async function ready<T extends PluginTestFixture>(
  context: RunContext<T>,
  session: DocumentSession,
): Promise<void> {
  const state = session.getSnapshot();
  check(state.status === "ready", "Expected ready document");
  check(
    state.pluginId === context.fixture.plugin.id,
    "Expected fixture plugin",
  );
  check(
    state.editing.supported === (context.options.editing !== false),
    "Declared editing support differs",
  );
  await context.verify(session);
}

/** Baseline integration checks through public managed sessions and sources. */
export function baselineCases<T extends PluginTestFixture>(
  config: Configuration<T>,
): Scenario<T>[] {
  return [
    {
      suffix: "open/detection",
      name: "opens the expected document through detection",
      async run(context) {
        const core = context.core();
        const source = await context.source();
        const session = await context.open(core, undefined, source);
        metadata(session, source);
        await ready(context, session);
      },
    },
    {
      suffix: "open/explicit",
      name: "opens the expected document through explicit selection",
      async run(context) {
        const session = await context.open(context.core(), {
          pluginId: context.fixture.plugin.id,
        });
        await ready(context, session);
      },
    },
    {
      suffix: "session/lifetime",
      name: "preserves managed lifetime guards and immutable snapshots",
      async run(context) {
        const core = context.core();
        const session = context.createSession(core, await context.source());
        const created = session.getSnapshot();
        check(created.status === "created", "Expected created document");
        check(
          Object.isFrozen(created) && Object.isFrozen(created.source),
          "Expected frozen created snapshot",
        );
        check(
          session.getSnapshot() === created,
          "Created snapshot must remain stable",
        );
        check(
          Object.isFrozen(core.getSessions()) &&
            core.getSessions().includes(session),
          "Expected tracked session",
        );
        await rejects(
          () => session.getCapability(unavailable),
          "SESSION_NOT_READY",
        );
        await rejects(() => session.serialize(), "SESSION_NOT_READY");
        await rejects(() => session.setReadOnly(false), "SESSION_NOT_READY");
        const loading = session.load();
        check(
          session.load() === loading,
          "Repeated loading must share its promise",
        );
        const pending = session.getSnapshot();
        check(
          pending.status === "loading" && Object.isFrozen(pending),
          "Expected immutable loading snapshot",
        );
        await loading;
        check(
          session.load() === loading,
          "Completed loading must retain its promise",
        );
        await ready(context, session);
        const loaded = session.getSnapshot();
        check(
          loaded.status === "ready" &&
            Object.isFrozen(loaded) &&
            Object.isFrozen(loaded.editing),
          "Expected frozen ready snapshot",
        );
        check(
          session.getSnapshot() === loaded,
          "Ready snapshot must remain stable",
        );
        check(
          created.status === "created" && pending.status === "loading",
          "Earlier snapshots must retain their states",
        );
        const disposal = session.dispose();
        check(
          session.dispose() === disposal,
          "Repeated disposal must share its promise",
        );
        await context.dispose(session);
        const closed = session.getSnapshot();
        check(
          closed.status === "disposed" && Object.isFrozen(closed),
          "Expected immutable disposed snapshot",
        );
        check(
          session.getSnapshot() === closed && loaded.status === "ready",
          "Disposal must preserve earlier snapshots",
        );
        check(
          !core.getSessions().includes(session),
          "Disposed session must leave core membership",
        );
        await rejects(
          () => session.getCapability(unavailable),
          "SESSION_CLOSED",
        );
        await rejects(() => session.load(), "SESSION_CLOSED");
        await rejects(() => session.serialize(), "SESSION_CLOSED");
        await rejects(() => session.setReadOnly(false), "SESSION_CLOSED");
      },
    },
    {
      suffix: "session/independence",
      name: "keeps documents independent across sessions and cores",
      async run(context) {
        const firstCore = context.core();
        const otherCore = context.core();
        const first = await context.open(firstCore);
        const second = await context.open(firstCore);
        const other = await context.open(otherCore);
        check(
          first.id !== second.id,
          "Session IDs must be distinct within a core",
        );
        for (const session of [first, second, other])
          await ready(context, session);
        const secondContent = await context.fingerprint(second);
        const otherContent = await context.fingerprint(other);
        await context.dispose(first);
        for (const session of [second, other]) await ready(context, session);
        check(
          (await context.fingerprint(second)) === secondContent,
          "Closing one document changed another",
        );
        check(
          (await context.fingerprint(other)) === otherContent,
          "Closing one document changed another core",
        );
        await context.dispose(firstCore);
        await ready(context, other);
        check(
          (await context.fingerprint(other)) === otherContent,
          "Closing one core changed another core",
        );
      },
    },
    {
      suffix: "load/pre-aborted",
      name: "retains an already aborted load reason",
      async run(context) {
        const core = context.core();
        const session = context.createSession(core, await context.source());
        const controller = new AbortController();
        const reason = new Error("Conformance pre-aborted load");
        controller.abort(reason);
        const error = await rejects(
          () => session.load({ signal: controller.signal }),
          "CANCELLED",
        );
        check(
          error.cause === reason,
          "Cancellation must retain the caller reason",
        );
        check(
          error.context.sessionId === session.id,
          "Cancellation must retain session identity",
        );
        const state = session.getSnapshot();
        check(
          state.status === "cancelled" && state.error === error,
          "Expected cancelled state with original error",
        );
      },
    },
    {
      suffix: "load/queued-dispose",
      name: "cancels queued loading when disposed immediately",
      async run(context) {
        const core = context.core();
        const session = context.createSession(core, await context.source());
        const loading = observe(session.load());
        const disposal = session.dispose();
        check(
          session.dispose() === disposal,
          "Repeated disposal must share its promise",
        );
        const outcome = await loading;
        check(!outcome.ok, "Queued load must reject after disposal");
        await rejects(() => {
          throw outcome.cause;
        }, "CANCELLED");
        await context.dispose(session);
        check(
          session.getSnapshot().status === "disposed",
          "Queued load must not restore disposed state",
        );
        check(
          !core.getSessions().includes(session),
          "Disposed session must leave core membership",
        );
      },
    },
    {
      suffix: "source/ownership",
      name: "preserves original source bytes and independent reads",
      async run(context) {
        const core = context.core();
        const source = await context.source();
        const original = {
          name: source.name,
          mimeType: source.mimeType,
          size: source.size,
        };
        const firstRead = await source.read();
        const expected = firstRead.slice();
        const secondRead = await source.read();
        check(
          firstRead !== secondRead,
          "Source reads must own independent arrays",
        );
        check(
          sameBytes(secondRead, expected),
          "Source reads must have deterministic bytes",
        );
        if (firstRead.length) firstRead[0] = (firstRead[0] ?? 0) ^ 255;
        check(
          sameBytes(secondRead, expected),
          "Mutating one read changed another read",
        );
        check(
          sameBytes(await source.read(), expected),
          "Mutating a read changed source bytes",
        );
        const session = await context.open(core, undefined, source);
        await ready(context, session);
        metadata(session, original);
        await context.dispose(session);
        check(
          source.name === original.name &&
            source.mimeType === original.mimeType &&
            source.size === original.size,
          "Opening or closing changed source metadata",
        );
        check(
          sameBytes(await source.read(), expected),
          "Opening or closing changed source bytes",
        );
      },
    },
    ...config.unsupported.map(
      (entry): Scenario<T> => ({
        suffix: `unsupported/${entry.id}`,
        name: `rejects unsupported source ${entry.id}`,
        async run(context) {
          const core = context.core();
          const source = await context.source(() =>
            entry.createSource(context.fixture),
          );
          const outcome = await observe(context.open(core, undefined, source));
          if (!outcome.ok && outcome.cause instanceof BoundaryFailure) {
            throw outcome.cause;
          }
          check(!outcome.ok, "Unsupported source unexpectedly opened");
          await rejects(() => {
            throw outcome.cause;
          }, "UNSUPPORTED_SOURCE");
          check(
            core.getSessions().length === 0,
            "Failed opening must remove its temporary session",
          );
        },
      }),
    ),
    ...(config.verifyDisposed
      ? [
          {
            suffix: "cleanup/plugin",
            name: "verifies plugin resources after closing",
            async run(context: RunContext<T>) {
              const core = context.core();
              await ready(context, await context.open(core));
              await context.dispose(core);
            },
          },
        ]
      : []),
    ...(config.editing === false
      ? [
          {
            suffix: "editing/unsupported",
            name: "rejects editing-only APIs on a viewer document",
            async run(context: RunContext<T>) {
              const session = await context.open(context.core());
              const source = await context.source();
              await ready(context, session);
              await rejects(() => session.serialize(), "EDITING_UNSUPPORTED");
              await rejects(
                () => session.setReadOnly(false),
                "EDITING_UNSUPPORTED",
              );
              await rejects(
                () => session.markPersisted({ revision: "0", source }),
                "EDITING_UNSUPPORTED",
              );
            },
          },
        ]
      : []),
  ];
}
