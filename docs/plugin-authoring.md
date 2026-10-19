# Plugin authoring

Use `@omniview/core/sdk` for authoring helpers and contracts; applications use
`@omniview/core`. These portable entry points share one package and version on
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

`open({ source, signal, sessionId, onDispose })` returns a `PluginDocument`
with optional capability entries and optional cleanup. It does not return a
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

Core currently offers lifecycle and author-defined capabilities. Shared editing,
read-only policy, revisions, dirty tracking, serialization, and persistence
acknowledgement need the next [editing phase](superpowers/specs/2026-10-19-core-runtime-proposal.md#editing-and-saving).
The host owns persistence. UI, official format implementations, adapters, and
`@omniview/core/testing` are future work; do not import an unimplemented subpath.
