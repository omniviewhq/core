import type { SerializationResult } from "../../index.ts";
import { check, rejects } from "../assertions.ts";
import type { Scenario } from "../context.ts";
import type { PluginEditingChecks, PluginTestFixture } from "../types.ts";
import { editingState } from "./editing.ts";

/** Simulate authoritative write order without choosing a host storage backend. */
export function persistenceCases<T extends PluginTestFixture>(
  profile: PluginEditingChecks<T>,
): Scenario<T>[] {
  return [
    {
      suffix: "persistence/receipts",
      name: "trusts only exact same-session persistence receipts",
      async run(context) {
        const core = context.core(false);
        const session = await context.open(core);
        const sameCore = await context.open(core);
        const otherCore = await context.open(context.core(false));
        for (const document of [session, sameCore, otherCore])
          await profile.change(
            Object.freeze({ fixture: context.fixture, session: document }),
            {},
          );
        const own = await session.serialize();
        const foreign = [
          await sameCore.serialize(),
          await otherCore.serialize(),
        ];
        const dirty = editingState(session);
        check(
          dirty.dirty,
          "Serialization must not mark changed content persisted",
        );
        for (const invalid of [
          ...foreign,
          { ...own },
          JSON.parse(JSON.stringify(own)),
          {},
          null,
          "revision",
        ]) {
          await rejects(
            () => session.markPersisted(invalid as SerializationResult),
            "INVALID_PERSISTENCE",
          );
          check(
            editingState(session) === dirty,
            "Invalid receipt changed document state",
          );
        }
        const content = await context.fingerprint(session);
        session.setReadOnly(true);
        session.markPersisted(own);
        const clean = editingState(session);
        check(
          !clean.dirty &&
            clean.persistedRevision === own.revision &&
            clean.revision === dirty.revision,
          "Exact acknowledgement did not clean its revision",
        );
        session.markPersisted(own);
        check(
          editingState(session) === clean,
          "Repeated acknowledgement must be a no-op",
        );
        check(
          (await context.fingerprint(session)) === content,
          "Acknowledgement changed the document model",
        );
      },
    },
    {
      suffix: "persistence/ordering",
      name: "keeps persistence aligned with actual acknowledged write order",
      async run(context) {
        const session = await context.open(context.core(false));
        const initial = await session.serialize();
        await profile.change(
          Object.freeze({ fixture: context.fixture, session }),
          {},
        );
        await context.verification(() =>
          profile.verifyChanged(
            Object.freeze({ fixture: context.fixture, session }),
          ),
        );
        const latest = await session.serialize();
        const content = await context.fingerprint(session);
        check(
          latest.revision !== initial.revision,
          "Change must produce a distinct revision",
        );
        session.markPersisted(latest);
        check(!editingState(session).dirty, "Latest write should be clean");
        session.markPersisted(initial);
        const overwritten = editingState(session);
        check(
          overwritten.revision === latest.revision &&
            overwritten.persistedRevision === initial.revision &&
            overwritten.dirty,
          "An older write finishing last must make current content dirty",
        );
        session.markPersisted(latest);
        check(
          !editingState(session).dirty &&
            (await context.fingerprint(session)) === content,
          "Rewriting latest output must restore clean without model mutation",
        );
      },
    },
  ];
}
