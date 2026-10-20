import { OmniviewError } from "../../index.ts";
import {
  BoundaryFailure,
  check,
  type Outcome,
  observe,
  rejects,
} from "../assertions.ts";
import type { Configuration } from "../config.ts";
import type { Scenario } from "../context.ts";
import type { PluginTestFixture } from "../types.ts";
import { editingState } from "./editing.ts";

async function entered(
  ready: Promise<Outcome<void>>,
  result: Promise<Outcome<void>>,
): Promise<void> {
  const first = await Promise.race([
    ready.then((outcome) => ({ kind: "entered" as const, outcome })),
    result.then((outcome) => ({ kind: "result" as const, outcome })),
  ]);
  if (first.kind === "result")
    throw new BoundaryFailure(
      "fixture",
      new Error("Operation completed before its entered milestone"),
    );
  if (!first.outcome.ok)
    throw new BoundaryFailure("fixture", first.outcome.cause);
}

/** Optional controlled work exercises a real dependency gate, never a sleep. */
export function pendingCases<T extends PluginTestFixture>(
  options: Configuration<T>,
): Scenario<T>[] {
  const scenarios: Scenario<T>[] = [];
  const pauseLoad = options.pauseLoad;
  if (pauseLoad)
    for (const action of ["cancel", "dispose"] as const)
      scenarios.push({
        suffix: `load/pending-${action}`,
        name: `${action === "cancel" ? "cancels" : "disposes"} pending loading before releasing its real dependency`,
        async run(context) {
          const control = await context.loadControl(() =>
            pauseLoad(context.fixture),
          );
          const core = context.core();
          const source = await context.source();
          const session = context.createSession(core, source);
          const controller = new AbortController();
          const result = observe(session.load({ signal: controller.signal }));
          await entered(control.entered, result);
          check(
            session.getSnapshot().status === "loading",
            "Expected pending loading",
          );
          const reason = new Error("Conformance pending-load abort");
          if (action === "cancel") controller.abort(reason);
          else await context.dispose(session);
          const outcome = await result;
          const error = await rejects(() => {
            if (outcome.ok) return;
            throw outcome.cause;
          }, "CANCELLED");
          if (action === "cancel")
            check(
              error.cause === reason,
              "Pending cancellation lost caller reason",
            );
          else
            check(
              error.cause instanceof OmniviewError &&
                error.cause.code === "SESSION_CLOSED",
              "Pending disposal lost closed cause",
            );
          check(
            error.context.sessionId === session.id &&
              error.context.sourceName === source.name &&
              error.context.pluginId === context.fixture.plugin.id,
            "Pending cancellation lost its identity",
          );
          if (!(await control.release()).ok) return;
          const drained = await control.drained;
          if (!drained.ok) return;
          check(
            session.getSnapshot().status ===
              (action === "cancel" ? "cancelled" : "disposed"),
            "Late load resurrected a cancelled document",
          );
        },
      });
  const profile = options.editing;
  const pending = profile !== false ? profile.pending : undefined;
  if (profile !== false && pending)
    for (const action of ["cancel", "revoke", "dispose", "writer"] as const)
      scenarios.push({
        suffix: `editing/pending-${action}`,
        name: `coordinates ${action} while real editing work is held`,
        async run(context) {
          const session = await context.open(context.core(false));
          await context.verify(session);
          const original = await context.fingerprint(session);
          const before = editingState(session);
          const controller = new AbortController();
          const adapterContext = Object.freeze({
            fixture: context.fixture,
            session,
          });
          const control = context.editControl(() =>
            pending(adapterContext, { signal: controller.signal }),
          );
          await entered(control.entered, control.result);
          const held = editingState(session);
          if (
            !held.busy ||
            held.revision !== before.revision ||
            (await context.fingerprint(session)) !== original
          )
            throw new BoundaryFailure(
              "fixture",
              new Error(
                "Controlled edit must remain busy before its first change",
              ),
            );
          if (action === "writer") {
            await rejects(
              () => profile.change(adapterContext, {}),
              "EDIT_BUSY",
            );
            if (!(await control.release()).ok) return;
            const result = await control.result;
            if (!result.ok) throw result.cause;
            await context.verification(() =>
              profile.verifyChanged(adapterContext),
            );
            check(
              !editingState(session).busy &&
                editingState(session).revision !== before.revision,
              "Released edit did not accept a new revision",
            );
            return;
          }
          const reason = new Error("Conformance pending-edit abort");
          if (action === "cancel") controller.abort(reason);
          else if (action === "revoke") session.setReadOnly(true);
          else await context.dispose(session);
          const result = await control.result;
          const error = await rejects(() => {
            if (result.ok) return;
            throw result.cause;
          }, "CANCELLED");
          if (action === "cancel")
            check(
              error.cause === reason,
              "Edit cancellation lost caller reason",
            );
          else
            check(
              error.cause instanceof OmniviewError &&
                error.cause.code ===
                  (action === "revoke" ? "READ_ONLY" : "SESSION_CLOSED"),
              "Edit cancellation lost policy or lifetime cause",
            );
          check(
            error.context.sessionId === session.id &&
              error.context.pluginId === context.fixture.plugin.id &&
              error.context.sourceName === session.getSnapshot().source.name,
            "Edit cancellation lost contextual identity",
          );
          if (!(await control.release()).ok) return;
          const drained = await control.drained;
          if (!drained.ok) return;
          if (action === "dispose")
            check(
              session.getSnapshot().status === "disposed",
              "Late edit resurrected a closed document",
            );
          else {
            const after = editingState(session);
            check(
              after.revision === before.revision &&
                !after.busy &&
                (await context.fingerprint(session)) === original,
              "Cancelled continuation accepted a late change",
            );
          }
        },
      });
  return scenarios;
}
