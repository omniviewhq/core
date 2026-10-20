# Plugin authoring

Use `@omniview/core/sdk` for authoring helpers and contracts; applications use
`@omniview/core`; plugin tests explicitly use `@omniview/core/testing`. These
three portable entry points share one package and version on
npm and JSR. No private imports, framework, renderer, or runtime-specific APIs
are needed. Format plugins belong in separate repositories. The fixture below
only demonstrates integration; core does not ship a text parser or renderer.

## A read-only TypeScript fixture

Keep author options in a factory closure and document state inside `open` so
each session remains independent:

```ts
import {
  defineCapability,
  definePlugin,
  provideCapability,
  type CapabilityKey,
  type PluginDefinition,
} from "@omniview/core/sdk";

interface TextContent { getText(): string }
interface TextOptions { readonly encoding?: string }

export const textContent: CapabilityKey<TextContent> =
  defineCapability<TextContent>("example.text:content");

export function textFixture(options: TextOptions = {}): PluginDefinition {
  return definePlugin({
    id: "example/text-fixture",
    apiVersion: 1,
    supports: ({ source }) => source.mimeType.split(";")[0] === "text/plain",
    async open({ source, signal, onDispose }) {
      let text = "";
      // Register acquired resources before the next operation can fail.
      onDispose(() => { text = ""; });
      text = new TextDecoder(options.encoding ?? "utf-8").decode(
        await source.read({ signal }),
      );
      return {
        capabilities: [provideCapability(textContent, { getText: () => text })],
      };
    },
  });
}
```

The host imports the fixture's public exports from its own module:

```ts
import { createOmniview, createSource } from "@omniview/core";
import { textContent, textFixture } from "./text-fixture.js";

const core = createOmniview({
  plugins: [textFixture()],
  onError: (error) => console.error(error.code, error.context, error.cause),
});
const source = createSource(new Blob(["hello"], { type: "text/plain" }), {
  name: "hello.txt",
});
const session = core.createSession(source);
const unsubscribe = session.subscribe(() => {
  console.log(session.getSnapshot());
});
try {
  await session.load();
  const content = session.getCapability(textContent); // TextContent | undefined
  console.log(content?.getText());
} finally {
  unsubscribe();
  await core.dispose();
}
```

The [README](../README.md) includes a plain JavaScript equivalent. JavaScript
authors can also supply JSDoc types from `/sdk`. `definePlugin` preserves the
definition's inferred type and extra author metadata; registration performs
runtime validation. `provideCapability` checks the value against the key's
type in TypeScript; it does not validate a capability's methods at runtime.

## Source contract

`createSource(input, options)` accepts a `Blob`, `File`, or `Uint8Array`. Name
precedence is `options.name`, the File's name, then `document`; names must not be
blank. MIME precedence is `options.mimeType`, the Blob/File type, then
`application/octet-stream` for bytes. Size is measured in bytes. Metadata is
fixed and the source object is frozen.

Byte input is copied at construction, and every read returns an independent
`Uint8Array`. Mutating input or a read result cannot mutate later reads.
`source.read()` reads all bytes; `source.read({ start: 0, end: 4, signal })`
reads `[0, 4)`. Bounds default to zero and source size. Both must be safe
integers satisfying `0 <= start <= end <= size`; empty ranges are valid and
out-of-bounds ranges reject `INVALID_RANGE` rather than being clamped.
Aborted reads reject `CANCELLED`, preserving the signal reason as cause.

A host may implement `ReadableSource` for remote/custom storage. It owns
credentials, transport, metadata consistency, range behavior, and cancellation
in that adapter. Core never fetches a URL or reads a filesystem path implicitly.

## Registration and detection

Every definition needs a unique nonblank `id`, exactly `apiVersion: 1`, and
callable `supports` and `open` methods. Core snapshots the registration list.
`supports({ source, signal })` returns a boolean or thenable boolean. Probes
are awaited sequentially in registration order; the first true result wins.
False permits the next probe; a throw, rejection, or nonboolean result fails
loading with `PLUGIN_FAILED`, preserving the original cause. There is no
fallback after a failure. All-false detection rejects `UNSUPPORTED_SOURCE`.

`core.createSession(source, { pluginId })` or
`core.open(source, { pluginId })` selects that registered plugin directly,
bypassing all probes, including its own. A missing ID rejects
`PLUGIN_NOT_FOUND`. The host is responsible for choosing an appropriate plugin.

`open({ source, signal, sessionId, onDispose, edit })` returns a `PluginDocument`
with optional capability entries, cleanup, and editing support. It does not return a
managed session. Core validates the result and capabilities before readiness.
Probe/open methods keep their definition's `this`; returned `dispose` keeps
its result object's `this`.

## Capabilities and lifetime

Capability IDs use `namespace:name` with lowercase segments matching
`[a-z][a-z0-9.-]*`. Keys are immutable and lookup uses their canonical ID; share
one exported typed key between plugin and consumer. Values must be non-null
objects. Duplicate IDs in one document reject `CAPABILITY_CONFLICT`; invalid
keys or entries reject `INVALID_CAPABILITY`.

`getCapability(key)` returns the typed value or `undefined` for a missing key
only while ready. Other live states throw `SESSION_NOT_READY`; disposed
sessions throw `SESSION_CLOSED`. Values belong to a single session and must
not be used after it closes. Core cannot revoke references retained by a host;
plugin methods should enforce their own resource validity where necessary.
Mutating methods must use `edit` even when called through a retained capability;
that boundary checks core policy and lifetime again.

## Optional editing

Return `editing: { capture() { ... } }` to enable the protocol. Existing
viewer-only definitions remain valid under `apiVersion: 1` and report
`editing: { supported: false }` in ready snapshots. Editing methods on such a
session fail with `EDITING_UNSUPPORTED`. Plugins published against this SDK
must declare an appropriate core package version; `apiVersion` alone does not
negotiate feature availability.

This TypeScript fixture lives in the plugin's own module, for example
`editable-text-fixture.ts`:

```ts
import {
  defineCapability, definePlugin, provideCapability,
  type EditOptions, type PluginDefinition,
} from "@omniview/core/sdk";

interface EditableText {
  getText(): string;
  replaceText(value: string, options?: EditOptions): Promise<void>;
  appendChunks(chunks: AsyncIterable<string>, options?: EditOptions): Promise<void>;
}

export const editableText =
  defineCapability<EditableText>("example.text:editable");

export function editableTextFixture(): PluginDefinition {
  return definePlugin({
    id: "example/editable-text-fixture",
    apiVersion: 1,
    supports: ({ source }) => source.mimeType.split(";")[0] === "text/plain",
    async open({ source, signal, onDispose, edit }) {
      // Initialization establishes revision "0" and is not an edit.
      let text = new TextDecoder().decode(await source.read({ signal }));
      onDispose(() => { text = ""; });
      return {
        capabilities: [provideCapability(editableText, {
          getText: () => text,
          replaceText: (next, options) => edit(async ({ signal, commit }) => {
            const prepared = await Promise.resolve(next);
            signal.throwIfAborted();
            commit(() => {
              const changed = text !== prepared;
              text = prepared;
              return { changed, value: undefined };
            });
          }, options),
          appendChunks: (chunks, options) => edit(async ({ signal, commit }) => {
            for await (const chunk of chunks) {
              signal.throwIfAborted();
              commit(() => {
                text += chunk;
                return { changed: chunk.length > 0, value: undefined };
              });
            }
          }, options),
        })],
        editing: {
          capture() {
            const capturedText = text;
            return {
              serialize: () => ({
                data: new TextEncoder().encode(capturedText),
                mimeType: "text/plain;charset=utf-8",
              }),
            };
          },
        },
      };
    },
  });
}
```

`edit(work, { signal })` always returns a promise. The operation can await
preparation and accept several changes. `commit(change)` runs synchronously and
returns the callback's `value`; its result must contain a boolean `changed` and
a `value` property, including when that value is `undefined`. Do not pass an
async callback or return a thenable from `commit`. Every change affecting
serialized content must use this boundary. Initialization during `open`, caches,
selection, and viewport state do not advance document revisions.

Each `changed: true` commit advances one revision; `changed: false` preserves it.
Ready snapshots contain a frozen editing object with `supported`, `readOnly`,
`busy`, `revision`, `persistedRevision`, and `dirty`. Both revisions start at
`"0"`; the initial baseline does not imply that core wrote anything or that a
serializer reproduces the input bytes. Revisions are opaque session-local
strings: compare equality rather than converting them to numbers. Dirty state
is `revision !== persistedRevision`.

Policy precedence is the session's `readOnly`, then the core's `readOnly`, then
`true`. Hosts enable writes with `{ readOnly: false }` and can call
`session.setReadOnly(boolean)` after readiness. Core checks policy before work
and before every accepted change, including calls from a custom UI or retained
capability. Changing to read-only cancels an active writer with `CANCELLED` and
a `READ_ONLY` cause; later fresh edits reject `READ_ONLY`. Read-only does not
erase capabilities or revisions and permits serialization and acknowledgement.

One writer is allowed per session. A second request rejects `EDIT_BUSY` without
queuing work; other sessions and cores have independent writers. Caller abort,
permission revocation, and disposal promptly invalidate the operation even if
its async work ignores the signal. Pass the operation signal to cooperative
work. A cancelled or completed context can never commit again; a live stale
context fails with `CANCELLED`, and a disposed session with `SESSION_CLOSED`.
Do not retain contexts for a later operation.

Accepted changes survive later preparation failure, cancellation, or permission
revocation. In `appendChunks`, two nonempty chunks accepted before a third read
fails remain applied at revision `"2"`; they remain dirty until acknowledged.
Core supplies no rollback. A throwing or invalid commit conservatively advances
the revision once because its opaque callback may already have mutated the
model, then rejects the operation with `EDIT_FAILED`. Authors must leave their
model valid even on failure. Edit/serialization failures keep the session ready;
they do not become terminal load failures.

During a commit callback, nested changes, serialization, policy changes, and
acknowledgements fail `EDIT_BUSY`. Reads remain available. Once the accepted
revision is published, a subscriber may serialize it, change policy, or dispose;
nested commits still fail. Disposal always wins over later work.

## Immutable captures and output ownership

`session.serialize({ signal })` takes a synchronous capture of the current
revision at invocation, then encodes asynchronously. It is allowed while a
writer awaits preparation, in a committed revision subscriber, and in read-only
mode. Multiple encoders can run concurrently. It cannot run during a model
change or another capture. Capture also blocks edit starts, commits, policy
changes, and acknowledgements until validation and ownership are settled.

`capture({ revision })` must return a synchronous `SerializationSnapshot`.
Copy mutable data or retain immutable/copy-on-write data; the returned
`serialize({ revision, signal })` must read only that captured state. It must
never encode the later live model under an earlier revision. Core preserves
capture and serializer method receivers but cannot clone arbitrary plugin data.
Async/thenable captures are rejected with `SERIALIZATION_FAILED`; any eventual
returned snapshot is cleaned, and late rejections remain observed.

The encoder returns `{ data: Blob | Uint8Array, name?, mimeType? }`. It may await
worker or compression work and should honor its per-serialization signal.
Caller abort and session disposal cancel that serialization; changing read-only
policy does not. Output byte arrays are copied, output reads return independent
bytes, and output remains usable after session disposal. Metadata defaults to
the original source unless overridden. Neither output metadata nor persistence
changes the source metadata in session snapshots.

A snapshot may include `dispose()` for capture resources. Core owns that cleanup
once across completion, failure, cancellation, and session disposal; do not also
register it with `onDispose`. Successful serialization waits for its cleanup
before issuing a result. If encoding succeeds but cleanup fails, serialization
rejects `CLEANUP_FAILED` and issues no receipt. If encoding fails and cleanup also
fails, the encoding error remains primary and cleanup is reported through
`onError`. Session-owned cleanup failures reject explicit disposal without a
duplicate diagnostic from the serialization wrapper. Malformed captures still
release any valid cleanup that core obtained.

Cleanup may initiate disposal without awaiting it. It must never return or await
the disposal promise of an owner whose cleanup includes that same callback:
that creates a self-dependency. This rule applies to capture and document cleanup.

## Host persistence and autosave building block

Only the host chooses storage, detects successful writes, and calls
`session.markPersisted(output)`. The exact successful `SerializationResult`
object is the receipt; a spread/JSON copy, fabricated value, or receipt from a
different session/core fails `INVALID_PERSISTENCE`. Serialization itself does
not change persisted state. A receipt remains readable after disposal, but a
closed session cannot acknowledge it.

This host example imports the public fixture module above. `persistBytes` and
the optional signal belong to the host; neither is supplied by core:

```ts
import { createOmniview, createSource } from "@omniview/core";
import { editableText, editableTextFixture } from "./editable-text-fixture.js";

export async function editAndPersist(
  persistBytes: (bytes: Uint8Array) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const core = createOmniview({ plugins: [editableTextFixture()] });
  try {
    const session = await core.open(
      createSource(new Blob(["before"], { type: "text/plain" })),
      { readOnly: false },
    );
    const text = session.getCapability(editableText);
    if (!text) throw new Error("Text API unavailable");
    await text.replaceText("after");
    const output = await session.serialize(signal ? { signal } : {});
    await persistBytes(await output.source.read());
    session.markPersisted(output);
  } finally {
    await core.dispose();
  }
}
```

A failed write must skip acknowledgement. Acknowledging revision A after an
edit to B keeps B dirty. If an older write actually overwrites newer stored
bytes, acknowledge the older receipt: persisted state moves back to A and B
becomes dirty again. Hosts must sequence conflicting writes or use storage
version checks and acknowledge authoritative storage commit order; HTTP response
arrival alone may not establish that order. One session tracks one authoritative
destination. An export/download copy need not be acknowledged. A receipt can be
reused when its bytes are actually written again. Acknowledgement is allowed in
read-only mode and while a writer awaits work; it changes no model or revision.

For autosave, observe revision changes and capture immediately in the subscriber.
The host receives a promise to schedule, write, acknowledge, and handle failures:

```ts
import type {
  DocumentSession, Revision, SerializationResult,
} from "@omniview/core";

export function observeCaptures(
  session: DocumentSession,
  scheduleWrite: (output: Promise<SerializationResult>) => void,
): () => void {
  let capturedRevision: Revision | undefined;
  return session.subscribe(() => {
    const state = session.getSnapshot();
    if (state.status !== "ready" || !state.editing.supported ||
        !state.editing.dirty || state.editing.revision === capturedRevision) return;
    capturedRevision = state.editing.revision;
    // Capture now; awaiting or delaying this call could capture a later revision.
    scheduleWrite(session.serialize());
  });
}
```

This is a capture hook, not an autosave service. The host owns scheduling,
coalescing, retries, cancellation signals, write ordering, and user feedback.
`scheduleWrite` must immediately observe promise rejection even if it defers
storage work; after a failed write it must explicitly choose whether to retry.
Install the subscriber before edits and unsubscribe when its host flow ends.

## State and cancellation

`createSession` exposes `created` so hosts can subscribe before loading.
`load()` publishes `loading`, then `ready`, `error`, or `cancelled`. Snapshots
and metadata are frozen and retain identity between changes. Subscriptions
receive no argument; read the current snapshot inside the callback. Each
registration has an idempotent unsubscribe function, and disposal clears all
subscriptions. Observer exceptions are reported without failing a successful
load or preventing other observers from running.

Repeated load calls share the first load promise and do not reopen the plugin.
The first call's options apply. An errored or cancelled session cannot retry;
create a new session. Disposal from any state is terminal, clears capabilities,
and causes later loads to reject `SESSION_CLOSED`. `core.open()` is the
convenience path to readiness; a failed open disposes its temporary session.
An explicitly created failed session stays tracked for inspection until disposal.

Pass a host signal with `session.load({ signal })` or `core.open(source,
{ signal })`. Pre-aborted loads never probe; cancellation during probing or
opening rejects promptly with `CANCELLED`. The external signal is unlinked
after loading settles, so aborting it after readiness does not close the
session. The context signal remains session-owned; disposal aborts it even
after readiness. Plugins should pass it to reads and cooperative async work.
Uncooperative late results cannot publish ready state, and their cleanup is
still observed.

## Cleanup and errors

Register resources with `onDispose(cleanup)` as soon as they are acquired.
It returns an idempotent unregister function. Registrations are independent,
even if the same callback is registered twice. Cleanup may be asynchronous.
Known callbacks run sequentially in reverse registration order; the returned
document's `dispose` is registered last and therefore normally runs first.
All callbacks are attempted even when some fail. Session/core disposal is
idempotent and repeated calls share its promise. Await disposal to observe
completion and `CLEANUP_FAILED`, whose cause aggregates failures.

Core disposal prevents new sessions immediately and attempts every tracked
session's cleanup. Closed sessions are removed from membership regardless of
cleanup success. A plugin operation's primary failure remains the load
rejection even if cleanup also fails; the secondary cleanup failure reaches
`onError`. Late cleanup registrations/results are cleaned after closure;
disposal does not wait indefinitely for an uncooperative open promise.
Failures from those late cleanup callbacks also reach `onError`.

Use `OmniviewError.code`, `.context` (source, plugin, session where available),
and `.cause` for diagnosis. Returned operation failures reject their promises.
`onError` handles errors that cannot reject that operation, including
`OBSERVER_FAILED` and secondary/late `CLEANUP_FAILED`. Without a handler core
uses `console.error`; a throwing handler is reported through a console fallback.
Late plugin rejections remain observed and do not become unhandled rejections.

## Future protocols

The [editing protocol](superpowers/specs/2026-10-20-editing-protocol-design.md)
coordinates plugin-owned models without imposing an AST or command language.
UI, official format implementations, adapters, a common undo/redo engine,
collaboration, and autosave scheduling remain future work. Format plugins and framework
adapters belong in their own repositories and packages.

## Portable plugin conformance tests

`@omniview/core/testing` exports `createPluginTestSuite`, its fixture/callback
contracts, and `PluginConformanceError`. It runs your actual plugin through public
root/SDK operations. Neither the root nor `/sdk` imports testing code. The kit
has no runner, parser, shared document model, storage, filesystem/network I/O,
framework, Bun, or Node dependency. The same discovered cases work in ordinary
asynchronous JavaScript and native test runners.

Save the read-only fixture above as `text-fixture.ts`. This complete suite module,
`viewer-suite.ts`, supplies real content assertions and independent sources:

```ts
import { createSource } from "@omniview/core";
import { createPluginTestSuite } from "@omniview/core/testing";
import { textContent, textFixture } from "./text-fixture.js";

export const viewerSuite = createPluginTestSuite({
  id: "text.viewer",
  createFixture: () => ({
    plugin: textFixture(),
    createSource: () => createSource(new Blob(["before"], {
      type: "text/plain;charset=utf-8",
    }), { name: "notes.txt" }),
  }),
  verifyDocument({ session }) {
    const api = session.getCapability(textContent);
    if (!api || api.getText() !== "before") {
      throw new Error("Expected initial text capability and content");
    }
  },
  fingerprint({ session }) {
    const api = session.getCapability(textContent);
    if (!api) throw new Error("Missing text capability");
    return api.getText();
  },
  editing: false,
  unsupported: [{
    id: "json",
    createSource: () => createSource(new Blob(["{}"], {
      type: "application/json",
    }), { name: "data.json" }),
  }],
  onLateError(error) {
    console.error(error.caseId, error.phase, error);
  },
});
```

Discovery is synchronous and does not call any fixture, source, or plugin.
Suite/case descriptors and arrays are frozen; stable IDs combine the suite ID
with scenario suffixes. IDs use `[a-z0-9][a-z0-9._-]*`; choose unique suite IDs
when combining suites. Every `run()` acquires a fresh fixture, including repeats
or concurrent calls. Return a fresh plugin definition/environment and independent
readable sources; source reads must be deterministic and independently owned.
Keep per-document state in the plugin's `open`. The independence checks reuse
one fixture's definition across several sessions and cores deliberately.

For editing, save the existing editable fixture as `editable-text-fixture.ts`.
This complete `editable-suite.ts` adds real capability changes, a genuine no-op,
and an output adapter that reads serialized bytes independently of the model:

```ts
import { createSource } from "@omniview/core";
import { createPluginTestSuite } from "@omniview/core/testing";
import { editableText, editableTextFixture } from "./editable-text-fixture.js";

export const editableSuite = createPluginTestSuite({
  id: "text.editable",
  createFixture: () => ({
    plugin: editableTextFixture(),
    createSource: () => createSource(new Blob(["before"], {
      type: "text/plain;charset=utf-8",
    }), { name: "notes.txt" }),
  }),
  verifyDocument({ session }) {
    if (session.getCapability(editableText)?.getText() !== "before") {
      throw new Error("Expected initial text");
    }
  },
  fingerprint({ session }) {
    const api = session.getCapability(editableText);
    if (!api) throw new Error("Missing editable text capability");
    return api.getText();
  },
  editing: {
    async change({ session }, options) {
      const api = session.getCapability(editableText);
      if (!api) throw new Error("Missing editable text capability");
      await api.replaceText("after", options);
    },
    verifyChanged({ session }) {
      if (session.getCapability(editableText)?.getText() !== "after") {
        throw new Error("Expected changed text");
      }
    },
    async verifyOutput({ output, expectedFingerprint }) {
      const decoded = new TextDecoder().decode(await output.source.read());
      if (decoded !== expectedFingerprint) throw new Error("Output mismatch");
    },
    async noChange({ session }, options) {
      const api = session.getCapability(editableText);
      if (!api) throw new Error("Missing editable text capability");
      await api.replaceText(api.getText(), options);
    },
  },
  onLateError(error) {
    console.error(error.caseId, error.phase, error);
  },
});
```

Verification callbacks succeed by completing with `undefined`; throw an error
for an assertion failure. Returning `false` is invalid fixture data. Fingerprints
are deterministic semantic strings: exclude revisions, session IDs, busy state,
timestamps, caches, and view state. Equal strings mean equivalent content for
your scenario; a hash or universal AST is unnecessary. `change` must await the
real capability operation with the supplied options and produce a distinct
deterministic state. `verifyOutput` must decode `output.source` and compare it
with `expectedFingerprint`, rather than reading the live model or modifying an
expected value to match. These adapters determine the meaning of the checks.

`editing: false` intentionally expects viewer-only support and still checks its
unsupported editing guards. An editing profile requires real editable support,
even though permission defaults to read-only. Missing `editing` is invalid
configuration. `noChange` is optional for formats without a supported no-op.
The kit compares opaque revisions for equality and tests receipt identity and
acknowledgement order without claiming that it performed a durable storage write.

To execute in an ordinary JavaScript module after compiling the suite modules:

```js
import { viewerSuite } from "./viewer-suite.js";
import { editableSuite } from "./editable-suite.js";

for (const suite of [viewerSuite, editableSuite]) {
  for (const omission of suite.omitted) {
    console.info("Omitted", omission.id, omission.reason);
  }
  for (const check of suite.cases) {
    await check.run(); // Rejects on the first failed case in this host loop.
    console.info("Passed", check.id);
  }
}
```

The supervising host must enforce a finite execution limit for this program.
Alternatively, register each case natively with Bun in `conformance.test.ts`:

```ts
import { test } from "bun:test";
import { viewerSuite } from "./viewer-suite.js";
import { editableSuite } from "./editable-suite.js";

for (const suite of [viewerSuite, editableSuite]) {
  for (const omission of suite.omitted) {
    console.info("Omitted", omission.id, omission.reason);
  }
  for (const check of suite.cases) {
    test(check.name, () => check.run(), 10_000);
  }
}
```

Choose runner limits appropriate to actual fixture work. The kit installs no
global hooks, scheduler, retry, sleep, guessed microtask flush, or internal
timeout. A broken fixture or noncooperative plugin can stay pending. A runner
timeout does not cancel arbitrary code or prove cleanup completed. Parallel
case execution requires isolated fixture resources.

Inspect `suite.omitted` in reporting or enforce your own coverage policy. An
omission never counts as a passing case. The viewer example omits the editing
family, controlled loading, and plugin resource verification. The editable
example omits controlled editing/loading, unsupported-source fixtures, and
plugin resource verification. These examples establish lifecycle integration
of illustrative fixtures; they are not production parsers or correctness
certification. Add real format regression tests and author resource assertions.

Optional profiles extend the cases through actual controllable plugin work:

- `pauseLoad(fixture)` arms a source/parser/dependency gate before real loading.
  Return `entered`, `drained`, and `release()`: entered marks actual pending
  work, release permits it to proceed, and drained includes late-result resource
  cleanup after cancellation. Drained must not wait for normal disposal of a
  live document; core disposal follows it.
- `editing.pending(context, options)` starts a real capability edit and returns
  a synchronous control box with those three members plus `result`, its actual
  public operation promise. The gate precedes the first accepted change;
  entered means initial content/revision with busy true. Drained tracks underlying
  termination even when the public result cancelled earlier. It fulfills for
  expected cancellation and rejects unexpected fixture failures. This adds
  cancellation, policy revocation, disposal, and second-writer checks.
- `verifyDisposed(fixture)` checks author-instrumented resources after controls
  drain and all cores close, before environment teardown. It runs in every
  case's cleanup, including partial setup and pre-aborted loading; account for
  resources actually acquired. Its dedicated case also covers normal open/close.

Use controlled dependencies or existing public capabilities; do not add a
production test-only command or expose private contexts. A delay around a
completed operation does not test pending plugin work. Milestones and release
must be deterministic and cooperative. A callback returning a promise of a
control box cannot replace the synchronous `editing.pending` result.

Cleanup attempts control release exactly once, drains controlled work, disposes
all owned cores, calls `verifyDisposed`, then calls fixture `dispose`. Later
cleanup is attempted even after a failure. A failed release is recorded without
blocking later cleanup on its unreleased gate. Fixture cleanup owns external
setup, not plugin resource repair: running it first could hide a leak. If the
fixture factory fails before returning, it must clean its own acquired resources.

`PluginConformanceError` reports `caseId`, `phase` (`fixture`, `check`, or
`cleanup`), original `cause`, and frozen `diagnostics`/`cleanupErrors` snapshots.
The first failure remains primary while secondary failures are attached. Core
diagnostics before settlement fail an otherwise successful case. Diagnostics
after settlement go to `onLateError`, whose default is `console.error`; a
throwing sink falls back to the console. A settled case cannot fail retroactively.
The examples log late errors; connect the sink to your runner's diagnostics for
stricter accounting and supply real drain/resource verification. Generic cleanup
checks cannot discover arbitrary resource leaks without author instrumentation.

See the [full test-kit contract](superpowers/specs/2026-10-20-portable-plugin-test-kit-design.md)
for case suffixes, controlled milestone rules, and failure ownership. The next
external integration proof remains a real text plugin in its own repository
and a plain JavaScript demo host.
