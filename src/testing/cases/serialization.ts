import { check, observe, rejects } from "../assertions.ts";
import type { RunContext, Scenario } from "../context.ts";
import type { PluginEditingChecks, PluginTestFixture } from "../types.ts";
import { editingState } from "./editing.ts";

/** Output verification uses captured semantic content rather than the live model. */
export function serializationCases<T extends PluginTestFixture>(
  profile: PluginEditingChecks<T>,
): Scenario<T>[] {
  return [
    {
      suffix: "serialization/initial",
      name: "exports initial content without changing read-only state",
      async run(context: RunContext<T>) {
        const source = await context.source();
        const original = {
          name: source.name,
          mimeType: source.mimeType,
          size: source.size,
        };
        const session = await context.open(context.core(), undefined, source);
        await context.verify(session);
        const before = editingState(session);
        const expectedFingerprint = await context.fingerprint(session);
        const output = await session.serialize();
        const metadata = session.getSnapshot().source;
        check(
          source.name === original.name &&
            source.mimeType === original.mimeType &&
            source.size === original.size &&
            metadata.name === original.name &&
            metadata.mimeType === original.mimeType &&
            metadata.size === original.size,
          "Serialization changed original source metadata",
        );
        check(
          Object.isFrozen(output) && Object.isFrozen(output.source),
          "Serialized output must be immutable",
        );
        check(
          output.revision === before.revision &&
            editingState(session) === before,
          "Encoding changed document or persistence state",
        );
        await context.verification(() =>
          profile.verifyOutput(
            Object.freeze({
              fixture: context.fixture,
              output,
              expectedFingerprint,
            }),
          ),
        );
      },
    },
    {
      suffix: "serialization/pre-aborted",
      name: "cancels pre-aborted export without changing document state",
      async run(context) {
        const session = await context.open(context.core());
        const before = editingState(session);
        const content = await context.fingerprint(session);
        const controller = new AbortController();
        const reason = new Error("Conformance serialization abort");
        controller.abort(reason);
        const error = await rejects(
          () => session.serialize({ signal: controller.signal }),
          "CANCELLED",
        );
        check(error.cause === reason, "Serialization lost cancellation reason");
        check(
          editingState(session) === before &&
            (await context.fingerprint(session)) === content,
          "Cancelled export changed content",
        );
      },
    },
    {
      suffix: "serialization/capture",
      name: "binds output to the revision captured before later edits",
      async run(context) {
        const session = await context.open(context.core(false));
        await context.verify(session);
        const initial = editingState(session);
        const original = await context.fingerprint(session);
        const encoding = observe(session.serialize());
        await profile.change(
          Object.freeze({ fixture: context.fixture, session }),
          {},
        );
        await context.verification(() =>
          profile.verifyChanged(
            Object.freeze({ fixture: context.fixture, session }),
          ),
        );
        const first = await encoding;
        if (!first.ok) throw first.cause;
        check(
          first.value.revision === initial.revision,
          "Capture revision moved to a later edit",
        );
        await context.verification(() =>
          profile.verifyOutput(
            Object.freeze({
              fixture: context.fixture,
              output: first.value,
              expectedFingerprint: original,
            }),
          ),
        );
        const expectedFingerprint = await context.fingerprint(session);
        const output = await session.serialize();
        check(
          output.revision === editingState(session).revision,
          "Later capture has wrong revision",
        );
        await context.verification(() =>
          profile.verifyOutput(
            Object.freeze({
              fixture: context.fixture,
              output,
              expectedFingerprint,
            }),
          ),
        );
      },
    },
    {
      suffix: "serialization/concurrent",
      name: "keeps concurrent captures independent from later edits",
      async run(context) {
        const session = await context.open(context.core(false));
        const original = await context.fingerprint(session);
        const initial = editingState(session);
        const one = observe(session.serialize());
        const two = observe(session.serialize());
        await profile.change(
          Object.freeze({ fixture: context.fixture, session }),
          {},
        );
        const first = await one;
        const second = await two;
        if (!first.ok) throw first.cause;
        if (!second.ok) throw second.cause;
        check(
          first.value !== second.value &&
            first.value.revision === initial.revision &&
            second.value.revision === initial.revision,
          "Concurrent capture identities or revisions differ",
        );
        for (const output of [first.value, second.value])
          await context.verification(() =>
            profile.verifyOutput(
              Object.freeze({
                fixture: context.fixture,
                output,
                expectedFingerprint: original,
              }),
            ),
          );
        const output = await session.serialize();
        const expectedFingerprint = await context.fingerprint(session);
        check(
          output.revision === editingState(session).revision,
          "Changed output revision differs",
        );
        await context.verification(() =>
          profile.verifyOutput(
            Object.freeze({
              fixture: context.fixture,
              output,
              expectedFingerprint,
            }),
          ),
        );
      },
    },
    {
      suffix: "serialization/ownership",
      name: "preserves independent output buffers after session disposal",
      async run(context) {
        const session = await context.open(context.core());
        const expectedFingerprint = await context.fingerprint(session);
        const output = await session.serialize();
        const first = await output.source.read();
        const expected = first.slice();
        const second = await output.source.read();
        check(first !== second, "Output read buffers are shared");
        first.fill(0);
        const latest = await output.source.read();
        check(
          latest.length === expected.length &&
            latest.every((byte, index) => byte === expected[index]),
          "Mutating output bytes corrupted subsequent reads",
        );
        await context.dispose(session);
        await context.verification(() =>
          profile.verifyOutput(
            Object.freeze({
              fixture: context.fixture,
              output,
              expectedFingerprint,
            }),
          ),
        );
      },
    },
  ];
}
