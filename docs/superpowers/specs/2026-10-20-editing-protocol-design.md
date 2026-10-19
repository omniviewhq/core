# Editing, revisions, and persistence protocol

Status: design approved by the user on 2026-10-20; the optional editing protocol
is implemented. Final acceptance and review are tracked in the linked plan.
The [implementation plan](../plans/2026-10-20-editing-protocol-phase-2.md)
records the execution sequence, extending the phase 1 managed runtime.
Async edit operations are a confirmed requirement.

Related documents: [runtime architecture](2026-10-19-core-runtime-proposal.md),
[customization](2026-10-19-customization-design.md),
[plugin authoring](../../plugin-authoring.md), and [language](../../../GLOSSARY.md).

## Goal and boundary

Give plugins a shared editing lifetime, enforce host read-only policy at every
accepted change, and let applications distinguish changed content from content
actually persisted. Preserve the plugin's own model, typed APIs, and serializer.
Every format plugin and renderer remains in its own repository/package.

This phase delivers async operations with multiple accepted changes, revision and
dirty state, permission changes, serialization of a captured revision, and explicit
host acknowledgement of persistence. Existing viewer-only plugins keep working.
All public code uses standard Web APIs with no new runtime dependencies.

This phase does not provide UI, a common document AST, a command registry,
format parsers, undo/redo, automatic rollback, collaborative editing, transport,
autosave scheduling, multiple persistence destinations, or a public test kit.
Those features are not prerequisites for the protocol described here. A plugin
may expose its own undo method as another edit operation.

## Alternatives and decision

| Approach | Benefit | Cost |
| --- | --- | --- |
| Core coordinates plugin-defined mutations through existing typed capabilities | Shared permission/revision/lifetime rules with format-specific APIs | Authors must use the editing context for every model change |
| Plugins own editing and notify core after changes | Minimal initial integration | Permission may be checked after mutation; dirty state can miss partial async work |
| Core owns a universal model and command language | One editor implementation | Forces unrelated file formats into one model and substantially expands core |

Choose the first approach. A capability method calls `PluginContext.edit()`;
its async work accepts individual changes through `EditContext.commit()`.
Renderers and application code call that same public capability method. No
toolbar or framework gets a separate mutation route.

`edit` is an async operation boundary. `commit` is a short synchronous change
boundary within that operation. A plugin can await network/worker/computation
results, accept a change, await again, and accept another change. A callback
cannot yield while its individual change is being applied.

The core cannot isolate arbitrary third-party JavaScript. A plugin that changes
its private model outside this protocol violates the authoring contract. Core
enforces the protocol's public paths; it does not sandbox a plugin or inspect
its model. Official plugins must route every document mutation through `commit`.

## Ownership and invariants

| Owner | Responsibility |
| --- | --- |
| Core | Read-only policy, active-operation identity, revisions, dirty state, receipt ownership, lifecycle and notifications |
| Plugin | Model, changed/no-change decision, valid individual changes, immutable captures, encoding/serialization and format-specific capabilities |
| Host | Calling capabilities, supplying cancellation, choosing storage, successful-write detection and persistence acknowledgements |
| Renderer/adapter | Presentation and input; uses the same capabilities and public session state as a custom interface |

Invariants:

1. A ready session has either unsupported editing or one editing definition.
2. Each session starts at revision `"0"` with persisted revision `"0"` and
   `dirty=false`. Revision `"0"` is the opened source baseline, not a claim that
   core performed I/O or that serialization is byte-identical to the input.
3. One session admits at most one active edit operation. Separate sessions and
   cores remain independent. The core does not silently queue a second writer.
4. Each successful `changed:true` commit advances revision exactly once. A
   `changed:false` commit does not advance it. Busy/policy/ack changes do not
   advance revision. `dirty = revision !== persistedRevision`.
5. An operation can accept multiple changes. Cancellation/failure preserves its
   already accepted changes and does not falsely mark them persisted.
6. A cancelled/finished operation's context cannot accept another change, even
   if its uncooperative async work later resumes.
7. Serialization reads a captured revision. A later edit never changes the bytes
   associated with that capture or its receipt.
8. Serialization does not acknowledge persistence. Only the host can do so,
   using a receipt issued by that same live session.
9. Disposed remains terminal across edits, captures, callbacks, and late results.

## Public contracts

These declaration contracts describe the public protocol. Their types
use the existing `MaybePromise`, `Cleanup`, and `ReadableSource` contracts.
Public declarations need JSDoc and explicit return types during implementation.

```ts
// Shared root/SDK types, owned by src/editing/types.ts.
/** A session-local opaque revision identity, represented as a decimal string. */
export type Revision = string;

export interface EditOptions {
  readonly signal?: AbortSignal;
}

export interface MutationResult<T> {
  readonly changed: boolean;
  readonly value: T;
}

export interface EditContext {
  readonly signal: AbortSignal;
  commit<T>(change: () => MutationResult<T>): T;
}

export type EditingSnapshot =
  | { readonly supported: false }
  | {
      readonly supported: true;
      readonly readOnly: boolean;
      readonly busy: boolean;
      readonly revision: Revision;
      readonly persistedRevision: Revision;
      readonly dirty: boolean;
    };

// Shared root/SDK types, owned by src/serialization/types.ts.
export interface SerializeOptions {
  readonly signal?: AbortSignal;
}

export interface SerializeContext {
  readonly signal: AbortSignal;
  readonly revision: Revision;
}

export interface SerializedData {
  readonly data: Blob | Uint8Array;
  readonly name?: string;
  readonly mimeType?: string;
}

export interface SerializationSnapshot {
  serialize(context: SerializeContext): MaybePromise<SerializedData>;
  readonly dispose?: Cleanup;
}

export interface CaptureContext {
  readonly revision: Revision;
}

export interface EditingDefinition {
  capture(context: CaptureContext): SerializationSnapshot;
}

export interface SerializationResult {
  readonly revision: Revision;
  readonly source: ReadableSource;
}
```

Extend existing interfaces as follows; do not replace phase 1 lifecycle methods:

```ts
// src/plugins/types.ts
export interface PluginContext extends ProbeContext {
  readonly sessionId: string;
  onDispose(cleanup: Cleanup): () => void;
  edit<T>(
    work: (context: EditContext) => MaybePromise<T>,
    options?: EditOptions,
  ): Promise<T>;
}

export interface PluginDocument {
  readonly capabilities?: readonly CapabilityEntry[];
  readonly dispose?: Cleanup;
  readonly editing?: EditingDefinition;
}

// Added to src/core/types.ts CoreOptions and
// src/sessions/types.ts SessionOptions. OpenOptions inherits SessionOptions.
// readonly readOnly?: boolean;

// Added to src/sessions/types.ts DocumentSession.
// setReadOnly(readOnly: boolean): void;
// serialize(options?: SerializeOptions): Promise<SerializationResult>;
// markPersisted(result: SerializationResult): void;

// Replace only the ready arm of SessionSnapshot:
// { readonly status: "ready"; readonly pluginId: string;
//   readonly editing: EditingSnapshot }
```

Root exports `Revision`, `EditOptions`, `EditingSnapshot`, `SerializeOptions`,
`SerializationResult`, and the existing host contracts. SDK exports all new
types above, including plugin-facing operation, capture, and serializer types.
No additional package entry point is needed. `MutationResult<T>` infers its
value from a synchronous callback; `EditContext.commit` must reject an async
callback in strict TypeScript as well as invalid JavaScript returns at runtime.

The ready arm gets a frozen nested editing object. Other lifecycle arms retain
their phase 1 shape. Snapshot identity changes for observable transitions only;
unchanged policy, unchanged persistence revision, and `changed:false` do not
create redundant state publications. Edit start/end still publish busy changes.
Session source metadata always describes the original source, even after saving
output under a different name. No implicit source replacement occurs.

## Editing support and policy

`PluginDocument.editing` is optional. If absent, ready state contains
`editing: { supported:false }`. Such a plugin can still expose existing read-only
capabilities. `edit`, `serialize`, and `markPersisted` reject/throw
`EDITING_UNSUPPORTED`; `setReadOnly` also throws `EDITING_UNSUPPORTED`.

If present, `editing` must be a non-null non-array object with a callable
`capture`. Snapshot it at load; retain the original method receiver. A malformed
definition yields `INVALID_EDITING`, follows phase 1 failed-load cleanup, and
never publishes ready. A throwing definition/accessor is a contextual
`PLUGIN_FAILED`. Capture/protocol fields are read once when taking ownership;
unknown JavaScript exceptions must never escape normalization.

Policy precedence is per-session `readOnly`, then core `readOnly`, then `true`.
Both inputs are optional booleans; supplied nonboolean JavaScript values fail
with `INVALID_OPTIONS`, rather than coercion. Core defaults are snapshotted at
construction and session overrides at creation. Explicit `undefined` behaves
as absence at runtime; strict types retain exact optional properties.

Use `setReadOnly(boolean)` to change an editable ready session's host policy.
Other live lifecycle states throw `SESSION_NOT_READY`; disposed throws
`SESSION_CLOSED`. Repeating the current value is a no-op. Read-only does not
erase editing support, remove capabilities, reset revisions, clear dirty state,
or prevent serialization and acknowledgement of an existing revision.

On every `edit()` and every `commit()`, verify readiness, editing support,
operation identity, current policy, and cancellation. UI disabling is a hint;
the same checks apply to a host's custom controls and retained capability APIs.

## Async edit operations

### Start, concurrency, and completion

`PluginContext.edit(work, options)` always returns a promise. Guard failures
reject it rather than throwing synchronously. Calling during `open` is
`SESSION_NOT_READY`: initialization establishes revision `"0"` directly in the
plugin before returning its document; initialization is not an edit.

Starting an operation checks lifecycle, support, policy, then busy state. If
otherwise eligible but its signal is already aborted, reject `CANCELLED` with
the original reason without publishing busy or calling work. A second active
operation rejects `EDIT_BUSY` immediately; no callback runs and no queue grows.
An initial `READ_ONLY` failure does not inspect or start plugin work.

Allocate the operation token and cancellation handling before synchronously
publishing `busy:true`. Schedule work only after this state is established;
reentrant observers must not admit another writer or start cancelled work.
The work receives one operation-owned signal and may return a value/thenable.
It can asynchronously prepare data, and call `commit` zero or more times.

On successful completion, invalidate that operation's token, unlink its host
signal, publish `busy:false`, and fulfill with the work's value. Successful
completion does not manufacture an abort; token validity, rather than a signal's
aborted flag alone, determines whether a context can still commit. A finished
context cannot commit later. A returning thenable is fully observed. A late
finalizer must never clear a newer operation's token or busy state.

### Accepting a change

`commit(change)` is synchronous. Check the operation's live identity and policy
immediately before invoking the callback. Its return must be a non-null,
non-thenable object with a boolean `changed` and a `value` property (the value
may be undefined). Capture these fields once. Reject malformed returns and
async/thenable callbacks with `EDIT_FAILED`, retaining a TypeError cause.

If changed is true, advance the revision, recompute dirty state, and publish the
new ready snapshot before returning the supplied value. If false, return the
value without changing revision/dirty state. The plugin is responsible for a
truthful changed result. The core does not deep-compare a format's model.
Selection, viewport, and caches are not content changes and do not need edits;
every change that affects the document's serialized content does.

An individual change cannot reenter another commit. While applying a callback,
also reject capture, policy changes, and persistence acknowledgement with
`EDIT_BUSY`. Reads remain available. Do not invoke application observers until
the model change and revision bookkeeping agree.

During the resulting revision notification, nested commits still fail
`EDIT_BUSY`, but serialization and policy changes are allowed: autosave may
capture the newly committed revision from a subscriber. Keep separate internal
apply/notification guards so observation cannot see a half-applied model.
A read-only/dispose callback during that notification wins before any next
change. No notification pass may revive a disposed session.

If a callback throws or returns an invalid result, core cannot determine whether
it already mutated the opaque model. Conservatively advance revision once,
recompute dirty state, reject the operation with `EDIT_FAILED`, and keep the
session ready. This may leave an unchanged model conservatively dirty; it must
never leave a potentially changed model falsely clean. The plugin must leave
its model valid on failure; rollback is not supplied by core. Do not publish
another ready snapshot if disposal won during the callback. Such a failed commit
also invalidates the operation and forces its promise to reject `EDIT_FAILED`,
even if plugin work catches the synchronous exception. Later calls through that
context cannot make further changes or replace the original operation failure.
When rejecting an async commit callback, observe its returned thenable's eventual
rejection; async model changes inside it remain a plugin contract violation.

Revisions are opaque session-local decimal strings. Keep a monotonically
increasing bigint counter privately and expose its decimal form; there is no
safe-number overflow, JSON BigInt requirement, revision setter, or numeric
ordering API. Applications compare identities for equality and must not perform
arithmetic on them. Do not wrap or reuse revisions. Equivalent-content edits
and plugin-provided undo create new revisions when they report changed.

### Cancellation, permission revocation, and partial work

Host abort, read-only revocation, and disposal invalidate the operation token
before any abort/observer callbacks can reenter. Reject without waiting for an
uncooperative work promise, and keep observing that underlying promise so late
rejection cannot become unhandled. Retained contexts can no longer commit.

Changing policy to read-only cancels an active operation with `CANCELLED`; its
cause is an `OmniviewError` with code `READ_ONLY`. Direct caller cancellation
retains the original supplied reason. Disposal cancellation retains a
`SESSION_CLOSED` cause and remains disposed. A later denied edit rejects
`READ_ONLY`; cancellation does not turn into a denied fresh operation.

Cancellation releases writer ownership promptly. A new operation can start
after policy permits it, even if older work ignores cancellation. Older work
must use its own invalid token and cannot commit into the new operation.
Remove linked listeners when the operation settles; aborting the old caller
signal after success cannot affect the document or a later edit.

Changes accepted before cancellation or work failure remain applied and dirty
as appropriate. An operation that stops before any commit leaves revision
unchanged. If outer async work throws after two successful commits, reject
`EDIT_FAILED` with that original cause, retain those two revisions, and release
busy state. An operation error is not a terminal load failure: loading remains
ready and later valid edits/serialization can proceed.

## Serialization and captures

`session.serialize(options)` checks ready/support and captures the current
revision and plugin state synchronously at invocation. Read-only is allowed.
The capture itself must be synchronous to bind content to one revision; actual
encoding, compression, or worker work in `snapshot.serialize` may be async.
Multiple serializations are allowed, including while an edit is awaiting work.
Capture cannot run during an individual model change.

The synchronous capture phase holds a model-consistency guard too. Reject
reentrant commits, edit starts, nested captures, policy changes, and persistence
acknowledgements with `EDIT_BUSY` until capture and ownership validation finish.
Reads remain available; disposal is always allowed and wins. Recheck closure
after invoking any plugin-owned capture/accessor before starting encoding.

`capture({ revision })` returns a `SerializationSnapshot` whose serializer reads
only state captured at that point. Copy mutable data, retain immutable data, or
use the plugin's copy-on-write representation. Do not read the live model later
and label its bytes with an older revision. Core does not clone arbitrary models.

Validate the captured object and callable serializer; capture and preserve its
optional cleanup method once. A valid cleanup must be owned and attempted even
if another field of that capture is malformed. Do not assimilate a thenable
capture: reject
`SERIALIZATION_FAILED` promptly. Observe a malformed async capture's eventual
rejection, and dispose any late resource-owning snapshot it returns; late
cleanup failures go to `onError`. Never mint a receipt from that rejected capture.

The serializer gets the captured revision and a per-serialization signal linked
to caller cancellation and session closure. Read-only revocation does not cancel
serialization. Pre-aborted serialization does not call capture/serialize.
Apply phase 1 cancellation semantics to async encoding: do not await an ignored
encoding promise on cancellation/disposal, but always observe its settlement.

Each capture has its own once-only cleanup scope. Register it with session
ownership before invoking its serializer. Release it after successful encoding,
failure, cancellation, or session disposal, and unlink that registration after
completion so resources do not accumulate. Session disposal awaits all known
capture cleanup but does not await an unresolved serializer promise. A pending
known cleanup itself is still awaited, as in phase 1.

Cleanup may initiate owner closure without awaiting it. It must not return or
await that owner's disposal promise when the owner is waiting for this same
cleanup; such a self-dependency cannot complete. Reentrant closure tests must
distinguish initiating disposal from awaiting one's own cleanup cycle.

Normalize successful `SerializedData` using `createSource`: copy Uint8Array data,
retain immutable Blob bytes, and validate metadata. An explicit output name or
MIME type wins; otherwise use the session's captured original name and MIME type.
Every returned output read owns its bytes. Output is independent of the plugin
model and remains readable after the session is disposed.

Before fulfilling, await the capture's known cleanup and verify the session and
serialization ticket still permit success. If encoding succeeded but cleanup
failed, reject `CLEANUP_FAILED` and issue no receipt. If encoding/cancellation
already failed, retain that primary error and report cleanup failure once via
`onError`. Detached late cleanup reports through that same sink. Disposal and
the serializer wrapper must not report one known cleanup failure twice.

Ordinary capture/encoding failures reject contextual `SERIALIZATION_FAILED` with
their original cause; malformed data/metadata retain an explanatory cause.
The live session remains ready, retains its revisions, and permits retries.
Serialization cannot mutate the model. Successful serialization creates one
frozen `SerializationResult` only after all success checks; it does not change
`persistedRevision`, `dirty`, or the original source.

## Persistence acknowledgements

The returned `SerializationResult` is also an ownership receipt. Track its
identity privately per session using weak ownership so abandoned receipts do
not retain every serialized document. Accept the exact issued object; reject
a structural copy, invented revision, or another session's receipt with
`INVALID_PERSISTENCE`. Do not expose a public constructor for trusted receipts.

After an authoritative write succeeds, the host calls
`session.markPersisted(result)`. It is synchronous and is allowed in read-only
mode, while an edit is awaiting work, and from normal revision notifications.
It requires a ready editable session, an owned receipt, and no active atomic
change. Check closure first. It does not serialize or write anything.

Set persistedRevision to that receipt's revision; recompute dirty with equality.
Do not use `Math.max`: acknowledgements describe the actual authoritative
destination, whose contents can be overwritten by an older write finishing last.

| Current revision | Prior persisted | Newly acknowledged | Result |
| --- | --- | --- | --- |
| `"2"` | `"0"` | `"1"` | persisted=`"1"`, dirty=true |
| `"2"` | `"1"` | `"2"` | persisted=`"2"`, dirty=false |
| `"2"` | `"2"` | `"1"`, after an older write actually overwrites storage | persisted=`"1"`, dirty=true |
| `"2"` | `"1"` | `"1"` again | no observable state change |

A receipt is reusable if the same bytes are actually written again. The host
must acknowledge successful writes in their authoritative storage commit order;
core cannot infer remote last-writer order from arbitrary HTTP completion times.
If an older response did not replace the authoritative destination, do not
acknowledge it as the latest persisted state. Use host-side sequencing or storage
version checks where required. One session tracks one authoritative destination.
Exporting a copy/download need not acknowledge anything.

An upload failure leaves persistedRevision unchanged. Serializing revision A,
editing B, then acknowledging A leaves B dirty. Cancelling an upload is host
behavior and does not cancel unrelated edits. A receipt's source remains usable
after disposal, but acknowledging it on a disposed session is `SESSION_CLOSED`.

## Error contract and state precedence

These codes extend `ErrorCode`; existing codes and error causes are preserved:

| Code | Meaning |
| --- | --- |
| `INVALID_OPTIONS` | Nonboolean supplied read-only configuration |
| `INVALID_EDITING` | Invalid optional editing definition at load |
| `EDITING_UNSUPPORTED` | The selected document provides no editing protocol |
| `READ_ONLY` | A fresh editing request/change is denied by current host policy |
| `EDIT_BUSY` | An operation is already active or an atomic change forbids reentry |
| `EDIT_FAILED` | Work/change failed or returned an invalid result |
| `SERIALIZATION_FAILED` | Capture, encoding, or output validation failed |
| `INVALID_PERSISTENCE` | Acknowledgement does not carry an owned successful receipt |

Use `CANCELLED`, `SESSION_NOT_READY`, `SESSION_CLOSED`, `CLEANUP_FAILED`, and
`OBSERVER_FAILED` according to their existing meanings. Context carries
sessionId, pluginId, and original sourceName where available. Observer failures
cannot change an accepted revision, cause successful encoding to fail, or stop
other observers. A throwing diagnostic handler keeps the phase 1 console fallback.

Guard precedence for ready operations is closure, lifecycle, protocol support,
reentry/policy eligibility, cancellation. For `edit`, check read-only before
ordinary busy state. For `commit`, an invalidated context yields `CANCELLED`
while its session is live, even if policy is subsequently re-enabled; disposed
yields `SESSION_CLOSED`. A completed but otherwise live operation's retained
context also yields `CANCELLED`. Operation promise cancellation remains
`CANCELLED` when disposal caused its token to become invalid.

Read-only/configuration methods throw synchronously; `edit` and `serialize`
reject promises. Partial edits and serialization errors do not change lifecycle
status from ready to error. Observer-triggered closure always wins over a later
attempt to publish editing state, an output receipt, or a cleanup notification.

## Example of plugin integration

This fixture demonstrates the public API; format implementations ship outside core:

```ts
import {
  defineCapability, definePlugin, provideCapability,
  type EditOptions, type PluginDefinition,
} from "@omniview/core/sdk";

interface TextApi {
  getText(): string;
  replaceText(value: string, options?: EditOptions): Promise<void>;
}

export const textContent = defineCapability<TextApi>("example.text:content");

export function textFixture(): PluginDefinition {
  return definePlugin({
    id: "example/text-fixture",
    apiVersion: 1,
    supports: ({ source }) => source.mimeType.split(";")[0] === "text/plain",
    async open({ source, signal, onDispose, edit }) {
      let text = new TextDecoder().decode(await source.read({ signal }));
      onDispose(() => { text = ""; });
      return {
        capabilities: [provideCapability(textContent, {
          getText: () => text,
          replaceText: (next, options) => edit(async ({ signal, commit }) => {
            // Async preparation may be parsing, a worker, or validation.
            const prepared = await Promise.resolve(next);
            signal.throwIfAborted();
            commit(() => {
              const changed = text !== prepared;
              text = prepared;
              return { changed, value: undefined };
            });
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

The host composes its own UI and storage. `persistBytes` below is a host-supplied
function, not an export from core:

```ts
import { createOmniview, createSource } from "@omniview/core";
import { textContent, textFixture } from "./text-fixture.js";

export async function editAndPersist(
  persistBytes: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const core = createOmniview({ plugins: [textFixture()] });
  try {
    const session = await core.open(
      createSource(new Blob(["before"], { type: "text/plain" })),
      { readOnly: false },
    );
    const text = session.getCapability(textContent);
    if (!text) throw new Error("Text API unavailable");
    await text.replaceText("after");
    const output = await session.serialize();
    await persistBytes(await output.source.read());
    session.markPersisted(output);
  } finally {
    await core.dispose();
  }
}
```

For progressive work the same operation can `commit` once per accepted chunk,
await more data, and commit again. An optional plugin-specific undo method
would use `edit` too and create a new revision rather than decrement revision.

## Implementation boundaries

| Module | Responsibility |
| --- | --- |
| `src/editing/types.ts` | Operation, policy, mutation result and public editing state types |
| `src/editing/create-editing.ts` | Writer token, commit guards, permission changes, revision/dirty transitions |
| `src/serialization/types.ts` | Capture, serializer, byte output and host receipt contracts |
| `src/serialization/create-serialization.ts` | Capture consistency, cancellable jobs, output ownership and receipts |
| `src/sessions/create-session.ts` | Compose controllers with load, public handles, snapshots and disposal |
| `src/sessions/state.ts` | Reuse/revise the existing stable observable store without a second listener system |
| `src/lifecycle/*` | Reuse safe cancellation, once-only resources and diagnostic ownership |
| Existing type/core/export files | Thread options and expose the public contracts consistently |

Editing and serialization do not import core composition or public barrels.
Prefer an explicit small private coordination interface between controllers:
current revision/policy, apply guard, lifecycle check, and one state-publication
hook. Do not expose the plugin model through that interface. Split additional
private resource/receipt helpers only when their own behavior warrants it.
Keep session orchestration focused rather than appending all logic to its load
function. Source reading and deterministic plugin selection stay phase 1 rules.

The linked implementation plan defines the private coordination contract and
ordered integration slices, including how active capture cleanup is claimed once
by disposal versus serialization. This design does not authorize placeholder
exports or an incomplete editing controller.

## Acceptance scenarios

Tests use only root/SDK public boundaries, real sources, and controlled promises.
Use real format fixtures with independent per-open state; no private helper
imports or timers. Attach a plain rejection observer before triggering a race.

| Area | Required observable outcomes |
| --- | --- |
| Compatibility | A phase 1 plugin still loads with supported=false; old lifecycle/cancellation tests remain green |
| Policy | Defaults/override precedence, malformed JS inputs, dynamic revocation, re-enable, custom capability calls all honor policy |
| Changes | True advances once; false does not; returned values retain types; partial work is dirty; invalid/throwing callbacks conservatively advance once |
| Async edits | Multiple awaits/commits, zero commits, failure after progress, cancellation before/during work, retained stale context and late rejection |
| Concurrency | One writer per session, second writer rejected, independent documents/cores, no queue, old completion cannot clear a newer writer |
| Reentry | Busy/revision/policy subscribers may dispose; nested commits blocked; autosave capture allowed after committed revision; no ready resurrection |
| Capture | Immutable revision A survives edits to B, multiple captures, allowed while writer awaits, no capture during applying, preserved callback receivers |
| Output | Byte copies, metadata defaults/overrides, malformed output/getters/thenables, output usable after disposal |
| Resources | Once-only capture cleanup on every exit, explicit cleanup errors, primary error retention, no duplicate diagnostics, late async capture cleanup |
| Persistence | Serialization alone stays dirty; only exact same-session receipt accepted; failed upload unchanged; old revision ack leaves newer edits dirty; out-of-order authoritative overwrite restores dirty |
| Lifecycle | Before-ready/unsupported/disposed guards, host signal unlink, retained methods/contexts, core close during edit/serialize, stable frozen nested snapshots |
| Types/package | Sync commit rejects async callbacks; capability generics survive; root/SDK declarations and actual packed consumers expose matching API; JSR dry-run passes |

Revision metadata in snapshots and receipts must be JSON-safe without exposing
bigint values. Serializing a receipt does not preserve its private ownership or
its source methods; a parsed copy cannot acknowledge persistence. A bounded
sequence of edits tests
identity advancement and dirty comparisons; no revision setter, production test
hook, private imports, or impractically long overflow test is needed.

Keep 100% executable source line/function coverage across all production files;
do not weaken preload/coverage exclusions. Runtime and declarations must remain
usable from plain JavaScript, TypeScript DOM consumers, and independent Node
consumers. No Bun/Node/framework/DOM-renderer imports or CSS enter public code.

## Review and release boundary

The approved design includes async partial-progress semantics, default
read-only policy, and storage acknowledgement ordering. Follow the linked
implementation plan before changing runtime code. This phase keeps the package
version unchanged;
determine release versioning against actual published history before releasing.
The optional editing result extends apiVersion 1; existing definitions remain
valid. A plugin using this new SDK must declare an appropriate core package
version when published; apiVersion alone is not feature negotiation.

Approval of this design did not itself implement the protocol. Implementation
evidence belongs in the linked plan. Format repositories, registry publication,
UI, and a public test-kit export remain outside this phase.
