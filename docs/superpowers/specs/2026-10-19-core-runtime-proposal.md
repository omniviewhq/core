# Core runtime and plugin SDK architecture

Status: the phase 1 managed runtime and minimal authoring SDK are implemented.
Editing, UI, formats, adapters, and the public test kit remain roadmap items.
The [phase 1 plan](../plans/2026-10-19-core-runtime-phase-1.md) records the
contract and acceptance scenarios. See [plugin authoring](../../plugin-authoring.md)
and [migration](../../migration-managed-sessions.md) for current usage.

## Product constraints

- One package and repository: `@omniview/core` in `omniviewhq/core`. Every format
  plugin and framework adapter has a separate repository and package.
- Portable public code uses standard Web APIs without Bun, Node, DOM, framework,
  or CSS requirements. Development remains Bun-first with no runtime dependencies.
- npm ESM/declarations and JSR TypeScript sources expose the same root and SDK API.
- Core stays headless. Optional editing is a product requirement for a future
  protocol, alongside the existing customization and style-isolation contract.
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
| `@omniview/core` | Hosts and renderer authors | Core/session handles, snapshots, sources, errors, consumer contracts |
| `@omniview/core/sdk` | Plugin authors | Definition/context contracts, typed capability helpers, errors |

Both registries expose both entry points at the same package version. npm builds
both together with shared ESM chunks and declarations; JSR exports the source
graph. Root imports do not load frameworks, UI, styles, or test runners.
`@omniview/core/testing` is intentionally not exported before it is implemented.

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

Tabs, active documents, pane selection, and layout belong to hosts/renderers.
Revisions and dirty state are not part of the current session model.

## Responsibilities and module direction

| Layer | Owns | Does not own |
| --- | --- | --- |
| Core | Registry composition, sessions, membership, core disposal | DOM, tabs, format models |
| Sources | Fixed metadata, readable bytes, ranges | Credentials, network/filesystem policy |
| Plugins | Definitions, validation, deterministic selection | Mutable document state shared across sessions |
| Lifecycle | Abort races, resource scopes, safe diagnostics | Session state or core composition |
| Sessions | State, subscriptions, capabilities, terminal lifetime | Format-specific AST or markup |
| Capabilities | Typed optional protocols and discovery | One mandatory document model |
| SDK | Supported authoring helpers and contracts | A second runtime, parsers, UI |

Dependencies flow from core composition to sessions, then sources, plugins,
capabilities, and lifecycle primitives. Shared cancellation, resources, and
reporting live below session orchestration, so sources/plugins never import
sessions. Lower layers never import core or public barrels. SDK barrels expose
supported contracts without runtime code depending on the SDK entry point.

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
  capabilities/
    types.ts                   typed keys and entries
    define-capability.ts       SDK key/entry helpers
    registry.ts                document capability validation
  sdk/
    index.ts                   plugin-author public exports
```

Create future modules only when their behavior exists. There are no empty
editing or testing placeholders and no generic utilities/services buckets.

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

`open` receives source, session ID, abort signal, and `onDispose`; it returns
optional capability entries and cleanup. It does not return the managed handle.
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

The approved [phase 2 design](2026-10-20-editing-protocol-design.md) specifies
async operations, guarded changes, revisions, captures, and persistence receipts.
Its [implementation plan](../plans/2026-10-20-editing-protocol-phase-2.md) is ready;
this is not an implemented API.

Future protocol: no editing policy, mode/save, revision, dirty state,
serialization, or persistence acknowledgement is implemented in this phase.
Optional editing remains a product requirement.

Distinguish plugin editing support from host permission for this session.
Read-only policy must be enforced through capability/command checks even when
a host uses a custom toolbar. Each edit advances a revision and dirty state.
Serialization captures bytes for a revision; successful serialization alone
must not mark persistence successful. The host persists the bytes and then
acknowledges that revision. Failed uploads leave it dirty, and edits made while
an older save is in flight remain dirty after that older revision is persisted.

Plugins own format snapshots and serialization; no common editable AST or
universal history engine is assumed. Hosts own persistence and unsaved-change
UI. Core never opens confirmation dialogs or chooses storage on their behalf.

## Portable test kit direction

Future `@omniview/core/testing` should exercise public plugin behavior with
supplied source fixtures and a session factory. It must not import bun:test,
Node, DOM, or a particular test runner. The minimal SDK is already implemented
independently of this test kit.

Shared checks should cover registration, detection, opening, capabilities,
cancellation, cleanup, and independent concurrent sessions. Editing checks are
opt-in once that protocol exists. Format content correctness remains the plugin
author's responsibility; generic checks cannot validate every parser/renderer.

## Development sequence and review scenarios

1. Protocol/source boundaries and managed runtime: implemented in phase 1,
   including the minimal SDK, cancellation, cleanup, and observable state.
2. Editing protocol: permission, revisions, dirty tracking, serialization, and
   persistence acknowledgement with failed/in-flight-save tests.
3. Portable test kit: real public conformance helpers through a future subpath.
4. External integration proof: a real format plugin in its own package, a
   viewer-only fixture, and a plain JavaScript host before protocol stabilization.
5. Release validation: actual packed npm consumers, matching JSR source exports,
   portability, isolated sessions, and full-source line/function coverage.

Lifecycle acceptance exercises two documents using one plugin, two cores,
terminal load failure/retry behavior, abort/dispose races, reentrant observers,
late results, cleanup failure precedence, and independent membership. Future
editing acceptance must prove that read-only commands cannot edit and that
persisting revision A cannot mark newer revision B clean.

## Compatibility and exclusions

The API remains experimental. Managed sessions replaced the old view/edit union;
the migration guide records the break without redefining save(). Determine
release versioning against actual publication history before release.

No default UI, CSS system, format parser, framework adapter, marketplace,
arbitrary dependency graph, collaboration engine, universal document AST,
format-independent undo engine, or public test kit is implemented in this phase.
Registry publication and git push remain separate authorized actions.
