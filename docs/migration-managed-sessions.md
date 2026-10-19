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
| Editable session `save()` | No current replacement; editing/serialization is a future protocol |

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
a typed read-only fixture.

Remove assumptions that `mode`, `save()`, or an editing capability exists in
this phase. Optional editing remains a product requirement. The next
[editing protocol](superpowers/specs/2026-10-19-core-runtime-proposal.md#editing-and-saving)
will distinguish serialization from successful persistence and track revisions
and host permission. The host continues to own uploads, downloads, and storage;
core performs none implicitly.
