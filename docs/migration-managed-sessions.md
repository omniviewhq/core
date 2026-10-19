# Migration to managed sessions

The experimental foundation contract has been replaced by a managed runtime.
This is a breaking API change, not an alias layer. Release versioning must be
checked against actual publication history before publishing.

| Foundation | Managed runtime |
| --- | --- |
| `{ name, data: Blob }` | `createSource(blob, { name })`, or a host `ReadableSource` |
| `OmniviewPlugin` | `PluginDefinition` with `apiVersion: 1` |
| `supports(source)` | `supports({ source, signal })`, sync or async boolean |
| `open(source)` returns a plugin session | `open(context)` returns `PluginDocument`; core owns `DocumentSession` |
| `ViewSession` / `EditSession`, `session.mode` | `getSnapshot().status` plus typed capabilities |
| Synchronous `session.dispose()` | Await `session.dispose()` or `core.dispose()` |
| Editable session `save()` | `serialize()`, host write, then exact-receipt `markPersisted()` |

Applications import factories and session/source contracts from
`@omniview/core`. Plugin authors import `definePlugin`, `defineCapability`,
`provideCapability`, and authoring types from `@omniview/core/sdk`. npm and
JSR expose both entry points; private source imports are unsupported.

```js
import { createOmniview, createSource } from "@omniview/core";
import { myPlugin } from "./my-plugin.js";

const core = createOmniview({ plugins: [myPlugin] });
try {
  const session = await core.open(createSource(
    new Blob(["hello"], { type: "text/plain" }),
    { name: "notes.txt" },
  ));
  console.log(session.getSnapshot().status); // ready
  // Consume capabilities exported by myPlugin while this session is ready.
} finally {
  await core.dispose();
}
```

Use `createSession()` then subscribe and `load()` when the host needs to see
loading or failure state. A failed `core.open()` disposes its temporary session;
an explicitly created session remains inspectable until the host disposes it.
Error/cancelled loads are terminal and repeated loads share the first promise.
Retry by creating a new session. Each document gets independent state and
resources even when it uses the same plugin definition.

Plugin detection remains ordered, now awaiting each probe sequentially. An
explicit `{ pluginId }` bypasses detection. Throws/rejections become structured
`OmniviewError` failures preserving the cause, rather than triggering fallback.
Pass the context signal to `source.read({ signal })` and register resource
cleanup through `onDispose`; cleanup is awaited in reverse registration order.
Cancellation settles promptly, and late results are disposed without restoring
ready state. See [plugin authoring](plugin-authoring.md) for complete rules and
a typed read-only fixture and an optional editable fixture.

## Optional editing extension

There is still no `mode` or `save()` method. Viewer-only `apiVersion: 1`
plugins remain valid. Their ready snapshots report `editing.supported: false`;
editing-related methods fail `EDITING_UNSUPPORTED`. An editable plugin returns
`editing.capture()` and routes every content mutation through the `edit`
function supplied to `open`. The optional extension retains `apiVersion: 1`;
plugins using it must declare a suitable core package version.

Host policy defaults to `readOnly: true`. Per-session configuration overrides
the core default, so enable edits explicitly with `core.open(source,
{ readOnly: false })`. Change policy after readiness with
`session.setReadOnly(boolean)`. Disabling controls alone does not enforce policy;
the same core guards apply when custom controls call retained capabilities.
Read-only permits export and persistence acknowledgement.

Replace direct capability mutations with `edit(async ({ signal, commit }) =>
{ ... })`. Async preparation belongs outside `commit`; each short synchronous
commit returns `{ changed, value }`. An operation may accept several changes,
each advancing one opaque string revision when `changed` is true. One writer
runs per session; a second writer rejects `EDIT_BUSY` without queuing. There is
no automatic rollback. Accepted changes remain after a later failure or abort,
and cancelled/completed contexts cannot commit again. Initialization during
`open` sets the baseline directly; caches and view state are not document edits.

Ready editable snapshots expose `readOnly`, `busy`, `revision`,
`persistedRevision`, and `dirty`. Revisions start at `"0"`, remain session-local,
and should only be compared for equality. Dirty means current revision differs
from persisted revision. Edit and serialization failures leave lifecycle ready;
load failures remain terminal.

## Separate serialization from storage

`session.serialize()` synchronously captures a fixed revision and may encode it
asynchronously. Plugins must copy mutable state or retain immutable data so later
edits cannot change the captured output. Async captures are rejected; async
encoding is allowed. Capture resources have one cleanup owner across encoding
and disposal. Cleanup must never await/return an owner disposal promise that
includes the same cleanup callback.

Hosts own storage, cancellation signals, and successful-write detection. The
following function is an application helper; `persistBytes` is supplied by the
host, not by core:

```ts
import type { DocumentSession } from "@omniview/core";

export async function persistDocument(
  session: DocumentSession,
  persistBytes: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const output = await session.serialize();
  await persistBytes(await output.source.read());
  session.markPersisted(output);
}
```

Only the exact returned result from the same live session is a trusted receipt.
Cloning/JSON serialization loses ownership; an invented revision or another
session's result fails `INVALID_PERSISTENCE`. Serialization alone does not mark
clean, and a failed write must skip acknowledgement. Acknowledging an older
revision after newer edits leaves them dirty. If an older write overwrites newer
stored bytes, acknowledging it makes the newer document dirty again. Sequence
conflicting writes or acknowledge actual authoritative storage commit order;
do not assume HTTP response order proves it. An export copy need not be
acknowledged. One session tracks one authoritative destination.

Output bytes remain readable after disposal, but acknowledgement requires a
live ready editable session. Output name/MIME overrides and acknowledgements do
not replace original session source metadata. Core supplies no storage adapter,
autosave scheduler, undo/redo engine, collaboration, renderer, or parser. See
[plugin authoring](plugin-authoring.md#host-persistence-and-autosave-building-block)
for a complete host lifecycle and a revision observer capture hook. Plugins and
framework adapters continue to belong in separate repositories.
