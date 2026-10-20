import type { DocumentSession, EditingSnapshot } from "../../index.ts";
import { check, rejects } from "../assertions.ts";
import type { RunContext, Scenario } from "../context.ts";
import type { PluginEditingChecks, PluginTestFixture } from "../types.ts";

/** Read the public supported arm without accessing private revision state. */
export function editingState(
  session: DocumentSession,
): Extract<EditingSnapshot, { supported: true }> {
  const state = session.getSnapshot();
  check(
    state.status === "ready" && state.editing.supported,
    "Expected ready editable document",
  );
  return state.editing;
}

function contextFor<T extends PluginTestFixture>(
  context: RunContext<T>,
  session: DocumentSession,
): Readonly<{ fixture: T; session: DocumentSession }> {
  return Object.freeze({ fixture: context.fixture, session });
}

/** Cases exercise author adapters through actual public plugin capabilities. */
export function editingCases<T extends PluginTestFixture>(
  profile: PluginEditingChecks<T>,
): Scenario<T>[] {
  const scenarios: Scenario<T>[] = [
    {
      suffix: "editing/default-readonly",
      name: "denies real edits under the default read-only policy",
      async run(context) {
        const session = await context.open(context.core());
        await context.verify(session);
        const before = editingState(session);
        const content = await context.fingerprint(session);
        check(before.readOnly, "Editing must default to read-only");
        await rejects(
          () => profile.change(contextFor(context, session), {}),
          "READ_ONLY",
        );
        check(
          editingState(session) === before &&
            (await context.fingerprint(session)) === content,
          "Denied edit changed document state",
        );
      },
    },
    {
      suffix: "editing/policy",
      name: "enforces core, session and dynamic permission",
      async run(context) {
        const writable = await context.open(context.core(false));
        const override = await context.open(context.core(true), {
          readOnly: false,
        });
        const denied = await context.open(context.core(false), {
          readOnly: true,
        });
        check(
          !editingState(writable).readOnly &&
            !editingState(override).readOnly &&
            editingState(denied).readOnly,
          "Permission precedence differs",
        );
        for (const session of [writable, override]) {
          await profile.change(contextFor(context, session), {});
          await context.verification(() =>
            profile.verifyChanged(contextFor(context, session)),
          );
        }
        const original = await context.fingerprint(denied);
        await rejects(
          () => profile.change(contextFor(context, denied), {}),
          "READ_ONLY",
        );
        check(
          (await context.fingerprint(denied)) === original,
          "Denied change mutated content",
        );
        denied.setReadOnly(false);
        await profile.change(contextFor(context, denied), {});
        await context.verification(() =>
          profile.verifyChanged(contextFor(context, denied)),
        );
        denied.setReadOnly(true);
        const state = editingState(denied);
        const changedContent = await context.fingerprint(denied);
        await rejects(
          () => profile.change(contextFor(context, denied), {}),
          "READ_ONLY",
        );
        check(editingState(denied) === state, "Revoked edit changed state");
        check(
          (await context.fingerprint(denied)) === changedContent,
          "Revoked edit changed content",
        );
        denied.setReadOnly(false);
        await profile.change(contextFor(context, denied), {});
        await context.verification(() =>
          profile.verifyChanged(contextFor(context, denied)),
        );
      },
    },
    {
      suffix: "editing/change",
      name: "accepts actual content changes with a new dirty revision",
      async run(context) {
        const session = await context.open(context.core(), { readOnly: false });
        await context.verify(session);
        const before = editingState(session);
        const original = await context.fingerprint(session);
        await profile.change(contextFor(context, session), {});
        await context.verification(() =>
          profile.verifyChanged(contextFor(context, session)),
        );
        const after = editingState(session);
        check(
          (await context.fingerprint(session)) !== original,
          "Change did not change semantic content",
        );
        check(
          after.revision !== before.revision &&
            after.dirty &&
            !after.busy &&
            after.persistedRevision === before.persistedRevision,
          "Accepted change must advance a dirty revision without persistence",
        );
      },
    },
    {
      suffix: "editing/independence",
      name: "isolates changes and policy across documents and cores",
      async run(context) {
        const core = context.core(false);
        const first = await context.open(core);
        const second = await context.open(core);
        const other = await context.open(context.core(false));
        const states = [editingState(second), editingState(other)];
        const content = [
          await context.fingerprint(second),
          await context.fingerprint(other),
        ];
        await profile.change(contextFor(context, first), {});
        await context.verification(() =>
          profile.verifyChanged(contextFor(context, first)),
        );
        first.setReadOnly(true);
        await context.dispose(first);
        for (const [index, session] of [second, other].entries()) {
          check(
            editingState(session) === states[index],
            "Another document's editing state changed",
          );
          check(
            (await context.fingerprint(session)) === content[index],
            "Another document's content changed",
          );
          await context.verify(session);
        }
      },
    },
    {
      suffix: "editing/closed",
      name: "denies real capability changes after session disposal",
      async run(context) {
        const session = await context.open(context.core(false));
        await context.dispose(session);
        await rejects(
          () => profile.change(contextFor(context, session), {}),
          "SESSION_CLOSED",
        );
        check(
          session.getSnapshot().status === "disposed",
          "Closed edit restored a usable session",
        );
      },
    },
  ];
  const noChange = profile.noChange;
  if (noChange)
    scenarios.push({
      suffix: "editing/noop",
      name: "preserves revisions and content on a real no-op",
      async run(context) {
        const session = await context.open(context.core(false));
        const before = editingState(session);
        const original = await context.fingerprint(session);
        await noChange(contextFor(context, session), {});
        const after = editingState(session);
        check(
          after.revision === before.revision &&
            after.persistedRevision === before.persistedRevision &&
            after.dirty === before.dirty &&
            !after.busy,
          "No-op accepted an unexpected revision",
        );
        check(
          (await context.fingerprint(session)) === original,
          "No-op changed semantic content",
        );
      },
    });
  return scenarios;
}
