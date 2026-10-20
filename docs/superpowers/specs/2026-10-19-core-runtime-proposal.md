# Core runtime and plugin SDK architecture

Status: the managed runtime, authoring SDK, optional editing protocol, and portable
plugin test kit are implemented. UI, formats, and adapters remain roadmap items.
The [phase 1 plan](../plans/2026-10-19-core-runtime-phase-1.md) records the
contract and acceptance scenarios. See [plugin authoring](../../plugin-authoring.md)
and [migration](../../migration-managed-sessions.md) for current usage.

## Product constraints

- One package and repository: `@omniview/core` in `omniviewhq/core`. Every format
  plugin and framework adapter has a separate repository and package.
- Portable public code uses standard Web APIs without Bun, Node, DOM, framework,
  or CSS requirements. Development remains Bun-first with no runtime dependencies.
- npm ESM/declarations and JSR TypeScript sources expose the same root, SDK, and testing APIs.
- Core stays headless. Optional editing coordinates plugin-owned models alongside
  the existing customization and style-isolation contract.
- Plugin authors use public tools and contracts instead of internal paths or
  their own competing lifecycle infrastructure.

## Architecture decision

Runtime and SDK share one package with separate public entry points. This keeps
protocol versioning aligned while letting hosts and authors import only the
supported boundary they need. Separate SDK packages would require unnecessary
release coordination at this stage. Including renderers and format parsers in
core would broaden dependencies and weaken isolation.

| Entry point | Audience | Implemented contents |
| --- | --- | --- |
| `@omniview/core` | Hosts and renderer authors | Core/session handles, editing snapshots, serialized output receipts, sources, errors |
| `@omniview/core/sdk` | Plugin authors | Definitions, edit/capture/encoder contexts, typed capability helpers, errors |
| `@omniview/core/testing` | Plugin tests | Named async conformance cases, fixture/adapter contracts, explicit omissions, conformance errors |

Both registries expose all three entry points at the same package version. npm
builds them together with shared ESM chunks and declarations; JSR exports the
source graph. Root and SDK imports do not load testing, frameworks, UI, styles,
or test runners. Testing may load the headless runtime it exercises.

## Session model

One core snapshots an ordered plugin registry and tracks independent document
sessions. Each session owns one source and one plugin result. A reusable plugin
definition keeps per-document mutable state inside `open`, never in one shared
model. Two sessions using one plugin and two independent cores remain isolated.

`createSession(source)` returns a `created` handle for subscription before work
starts. `load()` publishes `loading` followed by `ready`, `error`, or `cancelled`.
`open(source)` is the convenience path that awaits readiness. Snapshots and
source metadata are frozen, and snapshot identity stays stable between changes.
Subscriptions read the snapshot inside their callbacks. Observer failures do
not fail the document operation or interrupt the remaining observers.

Repeated loads share the first promise. Error/cancelled loads are terminal;
retry requires a new session. Disposal is terminal from any state and clears
subscriptions and capabilities. A failed convenience open disposes its temporary
session, while an explicitly created failed session remains inspectable and
tracked until disposed. Source identity never changes within a session.

Ready snapshots include a frozen optional-editing state. Supported sessions
expose read-only policy, writer busy state, current and persisted revisions,
and dirty equality. Revision/dirty changes and accepted policy changes publish
through the same observable store. Tabs, active documents, pane selection, and
layout belong to hosts/renderers.

## Responsibilities and module direction

| Layer | Owns | Does not own |
| --- | --- | --- |
| Core | Registry composition, sessions, membership, core disposal | DOM, tabs, format models |
| Sources | Fixed metadata, readable bytes, ranges | Credentials, network/filesystem policy |
| Plugins | Definitions, validation, deterministic selection | Mutable document state shared across sessions |
| Lifecycle | Abort races, resource scopes, safe diagnostics | Session state or core composition |
| Sessions | State, subscriptions, capabilities, terminal lifetime | Format-specific AST or markup |
| Editing | Host policy, writer lifetime, guarded commits, revision/dirty state | Plugin model, rollback, universal history |
| Serialization | Capture ownership, encoding lifetime, output copies, exact receipts | Storage, write scheduling, destination selection |
| Capabilities | Typed optional protocols and discovery | One mandatory document model |
| SDK | Supported authoring helpers and contracts | A second runtime, parsers, UI |
| Testing | Public runtime scenarios, fixture ownership, explicit omissions, diagnostics | Runner scheduling/timeouts, format truth, universal leak detection |

Dependencies flow from core composition to sessions, then sources, plugins,
capabilities, and lifecycle primitives. Shared cancellation, resources, and
reporting live below session orchestration, so sources/plugins never import
sessions. Sessions compose editing and serialization controllers; serialization
uses a narrow private editing interface without accessing a plugin model.
Lower layers never import core or public barrels. SDK barrels expose supported
contracts without runtime code depending on the SDK entry point.

```text
src/
  index.ts                     host-facing public exports
  errors.ts                    public error codes, context, causes
  core/
    create-core.ts             composition, membership, disposal
    types.ts                   configuration and public core handle
  sources/
    types.ts                   metadata and readable source contract
    blob-source.ts             Blob/File/byte-backed source factory
  plugins/
    types.ts                   definition, contexts, plugin result
    define-plugin.ts           inference-preserving SDK helper
    registry.ts                immutable registration validation
    resolve-plugin.ts          explicit or sequential async selection
  lifecycle/
    cancellation.ts            abort races and late-result observation
    resources.ts               asynchronous scoped cleanup
    reporting.ts               safe observer/cleanup diagnostics
  sessions/
    types.ts                   managed handle and snapshots
    create-session.ts          document lifetime orchestration
    state.ts                   stable snapshots and subscriptions
  editing/
    types.ts                   operation, mutation, revision and state contracts
    state.ts                   cached editing state and consistency guards
    create-editing.ts          policy, async writer and synchronous commits
  serialization/
    types.ts                   capture, encoder, output and receipt contracts
    capture.ts                 synchronous capture validation and late cleanup
    create-serialization.ts    encoding lifetime, capture ownership and receipts
  capabilities/
    types.ts                   typed keys and entries
    define-capability.ts       SDK key/entry helpers
    registry.ts                document capability validation
  sdk/
    index.ts                   plugin-author public exports
  testing/
    index.ts                   explicit plugin-testing public exports
    types.ts                   fixture, control, callback and case contracts
    create-suite.ts            immutable discovery without fixture execution
    config.ts                  configuration snapshots and validation
    run.ts                     per-run ownership and ordered cleanup
    cases/                     baseline, editing, serialization, receipt, pending cases
```

Testing composes public root/SDK operations and contracts; it does not inspect
private controllers or introduce reverse imports from lower runtime layers.
Create future modules only when their behavior exists. There are no generic
utilities/services buckets.

## Sources and plugin selection

`createSource` accepts Blob, File, or Uint8Array. Metadata is fixed; byte input
is copied at construction and each read returns fresh bytes. Reads use safe
integer half-open bounds `[start, end)` within source size, without clamping.
Hosts may supply a `ReadableSource` for remote/custom storage. Core performs no
implicit fetch, filesystem access, authentication, or persistence.

Plugins declare unique nonblank IDs, exactly `apiVersion: 1`, and callable
`supports`/`open`. Detection may inspect bytes asynchronously. Core awaits each
probe sequentially in registration order and selects the first true result.
An explicit `pluginId` bypasses every probe. Detection/open failures preserve
cause and contextual identity instead of silently falling back to another
plugin. Nonboolean probes and malformed results fail validation.

`open` receives source, session ID, abort signal, `onDispose`, and `edit`; it
returns optional capability entries, cleanup, and `editing.capture`. The editing
definition is an optional apiVersion 1 extension. It does not return the managed handle.
Author-specific configuration uses a typed factory closure. `definePlugin`
preserves inference/author metadata; `defineCapability` and `provideCapability`
connect namespaced keys to typed values without prescribing a universal AST.

Capability IDs are validated and unique per result. Lookup is keyed by canonical
ID and available only while ready; missing capabilities return undefined.
Capability references belong to their session and must not be used after it
closes. Core cannot revoke a host's retained object references.

## Loading, cancellation, and cleanup

Host signals apply to the first load. Pre-aborted loads do not probe, and abort
during detection/open rejects promptly with `CANCELLED`. The external signal
is unlinked once load settles: aborting it after readiness does not close the
session. The plugin context signal is session-owned and aborts on disposal,
including after readiness. Plugins pass it to source reads and cooperative work.
Late results cannot restore usable state; late rejections remain observed.

`onDispose` registers independent cleanup callbacks and returns an idempotent
unregister function. Known callbacks run sequentially in reverse registration
order, including result cleanup registered last. Every callback is attempted,
with failures aggregated as contextual `CLEANUP_FAILED`. Disposal promises are
cached. Disposing the core prevents new sessions immediately and attempts every
tracked session even if some cleanup fails. Session membership is removed on
closure regardless of cleanup success.

A primary plugin/load failure remains the returned rejection; a secondary
cleanup failure reaches `onError`. Late cleanup registrations and late plugin
results are cleaned after closure and cannot delay disposal indefinitely.
Their cleanup failures also reach `onError`. Observer failures are reported as
`OBSERVER_FAILED`. The default sink is console.error, with a console fallback
if a host handler throws. Structured errors expose code, context, and cause.

## Rendering and customization direction

A future renderer consumes platform-independent plugin capabilities rather
than private core state. A plugin repository may publish explicit optional UI
entry points; importing its headless definition must not load UI, styles, or
frameworks. Vanilla renderers and adapters compose those entry points outside
core. Public snapshots already support framework-independent observation;
shared renderer commands and domain events remain future protocols.

UI must support optional themes, replaceable regions, and fully custom rendering
through public state, commands, and events. Default CSS stays optional,
instance-scoped, and namespaced, including portal roots. Follow the
[customization contract](2026-10-19-customization-design.md).

## Editing and saving

The [phase 2 design](2026-10-20-editing-protocol-design.md) defines async edit
operations, guarded changes, revisions, immutable captures, and persistence
receipts. The [implementation plan](../plans/2026-10-20-editing-protocol-phase-2.md)
records its implementation and acceptance sequence. There is no `mode` or `save()` API.

Plugin support and host permission are independent. Viewer-only definitions
remain valid and ready with `editing.supported: false`. Editable sessions default
to read-only; a session option overrides the snapshotted core default.
`setReadOnly` changes ready-session permission. Capability mutations call
`PluginContext.edit`; core checks policy at operation start and every `commit`,
including retained/custom UI calls. Revoking permission promptly cancels the
active writer without cancelling encoders.

Each session admits one async writer and rejects a second with `EDIT_BUSY`.
Work may await preparation and make several synchronous `commit` calls.
`changed: true` advances one opaque string revision; `changed: false` does not.
Initialization establishes revision `"0"` directly. Failure or cancellation
preserves accepted changes, and stale contexts cannot commit again. Throwing or
invalid commit results conservatively advance once because core cannot inspect
the opaque model. The plugin must maintain model validity; core supplies no rollback.

Serialization captures the revision and immutable plugin state synchronously,
then allows async encoding and concurrent later edits. Captures/atomic changes
use consistency guards; a committed revision subscriber may capture for autosave.
An async capture is invalid. Each capture cleanup has one owner across encoding,
cancellation, and disposal; cleanup must not await an owner disposal promise
that includes itself. Output owns its bytes and remains readable after disposal.
Original session source metadata never changes because output is renamed or saved.

Serialization alone does not change persistence. After successfully writing the
authoritative destination, the host passes the exact same-session result to
`markPersisted`. Copies, invented values, and foreign receipts are rejected.
Dirty is revision inequality, not numeric revision ordering. Acknowledging A
after editing B keeps B dirty; if A actually overwrites newer stored bytes,
acknowledging A makes B dirty again. Hosts must sequence conflicting writes or
acknowledge authoritative storage commit order. Failed writes skip acknowledgement.
Read-only permits serialization/acknowledgement; closed sessions reject both.

Plugins own models, immutable captures, encoding, and format-specific APIs.
Hosts own storage, autosave scheduling, write ordering, and unsaved-change UI.
Core never opens confirmation dialogs or chooses storage. UI, a common editable
AST, undo/redo, automatic rollback, and collaboration remain outside this phase.

## Portable plugin test kit

The implemented [phase 3 contract](2026-10-20-portable-plugin-test-kit-design.md)
provides `createPluginTestSuite` through `/testing`. Discovery is synchronous;
every named async case acquires a fresh fixture and uses real public sessions.
Root and SDK imports do not pull in testing. All three APIs use portable standard
Web APIs, without Bun, Node, DOM, or runner dependencies.

Cases check detection, opening, capability assertions, lifetime, cancellation,
independence, optional editing, immutable output, and exact persistence receipts.
Authors supply deterministic semantic fingerprints and independent serialized
output assertions. `editing: false` intentionally selects a viewer fixture;
optional controlled load/edit profiles and plugin resource assertions have
explicit omission descriptors when absent. No omitted check counts as passed.

Cleanup releases/drains controlled work, closes cores, verifies plugin resources,
then disposes the fixture environment. Errors preserve primary causes and attach
cleanup failures/diagnostics; diagnostics after settlement use `onLateError`.
The caller registers/executes cases, presents omissions, and enforces finite time
limits. A timeout cannot establish completed cleanup. Content correctness and
resource assertions remain the author's responsibility; the generic kit does
not certify parsers/renderers or prove absence of arbitrary leaks. See
[plugin authoring](../../plugin-authoring.md#portable-plugin-conformance-tests).

## Development sequence and review scenarios

1. Protocol/source boundaries and managed runtime: implemented in phase 1,
   including the minimal SDK, cancellation, cleanup, and observable state.
2. Editing protocol: implemented optional permission, guarded async operations,
   revisions, dirty tracking, captures, and exact persistence receipts.
3. Portable test kit: implemented public `/testing` cases, author adapters,
   explicit omissions, optional controls, and per-run cleanup ownership.
4. External integration proof (next): a real text plugin in its own package,
   viewer-only integration, and a plain JavaScript host before stabilization.
5. Release validation: actual packed npm consumers, matching JSR source exports,
   portability, isolated sessions, and full-source line/function coverage.

Lifecycle acceptance exercises two documents using one plugin, two cores,
terminal load failure/retry behavior, abort/dispose races, reentrant observers,
late results, cleanup failure precedence, and independent membership. Editing
acceptance includes denied read-only mutations, partial async failure, stale
contexts, capture cleanup races, and persistence A leaving newer revision B dirty.

## Compatibility and exclusions

The API remains experimental. Managed sessions replaced the old view/edit union;
the migration guide records the break without redefining save(). Determine
release versioning against actual publication history before release.

No default UI, CSS system, format parser, framework adapter, marketplace,
arbitrary dependency graph, collaboration engine, universal document AST,
or format-independent undo engine is implemented in this phase.
Registry publication and git push remain separate authorized actions.
