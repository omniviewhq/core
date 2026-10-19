# Core runtime and plugin SDK proposal

Status: architecture and development roadmap. The first runtime slice has a
[detailed implementation plan](../plans/2026-10-19-core-runtime-phase-1.md)
with concrete contracts, lifecycle rules, tests, and delivery steps. This
document describes the wider direction; editing and the public test kit are
follow-up slices. Runtime source has not yet been changed to this architecture.

## Current foundation and missing responsibilities

The three current source files implement ordered plugin selection, registration
validation, and a minimal view/edit session union. They do not provide managed
document lifetimes, cancellation, observable state, capability discovery, dirty
tracking, or a plugin authoring/testing SDK. Those are substantive architecture
gaps; the number of files itself is not a quality measure.

The current 14 tests cover the foundation. Their 100% line/function coverage is
not evidence that the proposed runtime and SDK already exist or are tested.

## Product constraints

- One core repository and package: `@omniview/core`; every format plugin and
  framework adapter has its own repository and package.
- Framework-independent public code using standard Web APIs, without Bun,
  Node, DOM, or framework runtime requirements. Development remains Bun-first.
- npm ESM/declarations and JSR TypeScript sources expose the same public API.
- A small headless runtime, optional editing, and the existing customization
  and style-isolation contract apply to every official integration.
- Plugin authors receive useful public tools and contracts without importing
  internal source paths or rebuilding lifecycle infrastructure.

## Architectural alternatives

| Approach | Advantages | Costs |
| --- | --- | --- |
| Runtime and SDK in one package with separate entry points | Shared protocol/version, simple installation, independently importable tooling | Public export boundaries must be maintained carefully |
| Runtime and SDK as separate packages/repositories | Independent publishing and release cycles | Compatibility coordination before there is a mature protocol |
| One broad core including renderers and format helpers | Initially convenient imports | Larger dependency surface, weaker isolation, difficult customization |

Recommend the first approach. Keep UI and format implementations in their own
repositories, and expose SDK/test utilities as optional core subpath exports.

## Session model

One session owns one document. A core instance can manage multiple independent
sessions, including two documents using the same plugin. A format plugin's
reusable definition must not hold one global mutable document model.

Sessions have separate loading state, capabilities, revisions, subscriptions,
operation cancellation, and resource ownership. The core instance owns the
registry and tracks its sessions; disposing the core disposes those sessions.

Tabs, the active document, selection between panes, and split-view layout belong
to renderers or host applications. The basic one-document integration remains
short; multi-document UI does not require another document lifecycle model.

Provide an explicit session-creation path for subscribing before loading starts,
plus a convenience path for opening and awaiting readiness. A session's source
identity stays fixed; replacing a document means opening a different session.
The exact method signatures are part of the first implementation plan.

## Responsibility boundaries

| Module | Owns | Does not own |
| --- | --- | --- |
| Core | Registry composition, session creation/tracking, core disposal | DOM, tabs, format models |
| Sources | File metadata, readable bytes, range access, source adapters | Application credentials, filesystem/network policy |
| Plugins | Definitions, registration validation, deterministic resolution | Active document state shared across sessions |
| Sessions | State transitions, operation lifetimes, notifications, disposal | Format-specific AST or UI markup |
| Capabilities | Typed protocols for optional operations and discovery | One interface requiring every format to implement every feature |
| SDK | Plugin authoring helpers, typed context, resource ownership tools | A second competing runtime implementation |
| Testing | Portable plugin contract checks and test fixtures | A production dependency on bun:test or a particular test framework |

Dependencies flow from the core orchestrator toward sessions, plugin protocols,
and sources. Public SDK entry points re-export supported authoring tools; the
runtime does not depend on SDK barrels. Testing depends on public contracts,
and neither the runtime nor root entry point imports the test kit.

## Proposed source layout

```text
src/
  index.ts                     application-facing exports
  core/
    create-core.ts             composition and core factory
    types.ts                   core configuration/public handle
  sources/
    types.ts                   readable source contract
    blob-source.ts             Blob/File/byte-backed adapters
  plugins/
    types.ts                   public plugin definition/context contracts
    define-plugin.ts           inference-preserving authoring helper
    registry.ts                registration and compatibility validation
    resolve-plugin.ts          deterministic format selection
  lifecycle/
    cancellation.ts            abort races and late results
    resources.ts               scoped resource cleanup
    reporting.ts               safe callback/cleanup diagnostics
  sessions/
    types.ts                   public session state and handle
    create-session.ts          document lifetime orchestration
    state.ts                   snapshots and subscriptions
  capabilities/
    types.ts                   typed capability keys and discovery
    editing.ts                 editing/serialization/revision protocol
  sdk/
    index.ts                   plugin-author public entry point
  testing/
    index.ts                   optional portable test-kit entry point
    plugin-contract.ts         lifecycle/capability conformance checks
    sources.ts                 in-memory test sources
  errors.ts                    stable public error codes and causes
```

Create modules as their behavior is implemented, without empty placeholder
directories or generic utils/services buckets. Keep feature types next to their
behavior instead of rebuilding one global `types.ts` collection.

## Public entry points

| Entry point | Audience | Contents |
| --- | --- | --- |
| `@omniview/core` | Application and renderer authors | Core/session APIs, public state, source and capability consumer types |
| `@omniview/core/sdk` | Plugin authors | Plugin definitions, authoring helpers, context, resource and capability tools |
| `@omniview/core/testing` | Plugin maintainers | Portable contract runner, fixtures, deterministic async-operation controls |

All three belong to this single package and share its version. Both registries
must expose them; npm builds each runtime entry point with declarations.
The root import must not load the SDK test kit, a framework, or styles.

## Plugin authoring contract

The SDK supplies a typed definition helper that preserves inference for plugin
configuration, its document model, and its capabilities. It must work for both
TypeScript authors and JavaScript authors using declarations/JSDoc.

A plugin declares a unique identity, protocol compatibility, and supported
format metadata. Detection may inspect bytes asynchronously. Default selection
remains deterministic by registration order; the host can explicitly request a
plugin. A decoding or detection failure is reported with its cause rather than
silently hidden by trying another plugin after failure.

Each session receives its own context: source reader, configuration, abort
signal, capability publication, state notifications, and cleanup registration.
Plugin code owns its format model. Text, spreadsheets, PDFs, and video must not
be forced into one common editable AST.

Capabilities expose common protocols while keeping format-specific data typed.
The initial shared editing protocol does not imply support for search, zoom,
pagination, annotations, or history. Add shared protocols only when real format
implementations can validate them. Plugin-specific capabilities can extend the
contract through namespaced typed keys without changing the core's union types.

SDK support includes structured errors, cleanup scopes, source-reading helpers,
and capability/command types. It must not grow into an unrelated utility library
or supply parsers for every document format.

## Rendering boundary for plugin authors

A plugin can expose a platform-independent view model and document operations
through its own typed capability. Its renderer consumes that public capability
rather than accessing private runtime state. The shared core does not prescribe
one visual representation or one document model for every format.

A format plugin repository may publish optional browser/rendering entry points
alongside its headless definition. Those imports are explicit: importing the
definition never loads its UI, styles, or framework dependencies. A vanilla
renderer or framework adapter composes those presentation implementations
outside the core. This keeps one repository per plugin while allowing both
fully custom host UI and a convenient default presentation.

## State, commands, and events

Expose stable immutable snapshots and subscriptions that work with plain JS,
React, Vue, or other consumers. Changes notify observers; unsubscription and
session disposal stop future callbacks. State belongs to each session.

Commands address a specific session and validate its lifecycle and capabilities.
Default controls, custom host controls, and framework adapters use those same
commands. Optional capabilities must be discoverable before UI invokes them.
Domain events report document lifecycle and operation outcomes; events do not
replace the current-state snapshot or expose internal mutable objects.

Plugins can define typed namespaced operations. Generic session actions such as
loading, serialization, and disposal remain consistent across formats. Public
error codes distinguish unsupported sources/capabilities, invalid plugin
registration, cancellation, disposed sessions, and plugin execution failures.

## Loading and resource safety

Source adapters initially cover Blob, File, and byte-backed data with named
metadata and range reads. Hosts can provide a reader for remote or custom
storage. The core does not fetch URLs or read local paths implicitly; access,
authentication, and transport policy belong to the host's source adapter.

Loading can be cancelled. Disposing a session aborts its work and makes the
session terminal. A late plugin result cannot make a disposed session ready;
resources returned by late results must also be cleaned up.

Resource scopes cover subscriptions, workers, object URLs, and parser resources
through registered cleanup callbacks without importing DOM APIs into core.
Cleanup is idempotent, attempts all registered disposals, and reports failures
without leaving the session usable. One session's failure cannot corrupt another.

## Editing and saving

Distinguish plugin support for editing from the host's permission to edit this
session. A host can open an editable format in read-only mode. Capability and
command checks honor that policy; the UI is not the enforcement boundary.

Document changes advance a revision and update dirty state. Serialization
produces bytes for an identified revision; it does not itself mark persistence
successful. The host persists those bytes, then acknowledges the saved revision.
A failed upload leaves the document dirty. Edits made while serialization or
persistence is running remain dirty after an older revision is acknowledged.

The format plugin owns how a snapshot is captured and serialized. A common
history/undo implementation is not assumed because format models differ.
The core must expose enough state for the host to implement unsaved-change
guards; it never opens a confirmation dialog on the application's behalf.

## Plugin test kit

The optional test kit exercises public plugin behavior using supplied source
fixtures and a session factory. It does not import bun:test, Node, or the DOM;
plugin maintainers can call it from their chosen test runner.

Shared checks cover registration, supported/unsupported input, opening,
capability declarations, serialization where available, cancellation, cleanup,
and two concurrent sessions with isolated state. Opt-in checks apply only to
capabilities a plugin implements. Format-specific content correctness remains
the plugin author's responsibility; generic tests do not claim to validate a
spreadsheet parser or PDF renderer.

## Development sequence

1. **Protocol and source boundaries.** Finalize typed source, plugin, session,
   error, and capability contracts. Add compile-time consumer/author examples
   and source adapters. Preserve deterministic registration/resolution tests.
2. **Managed session runtime.** Implement observable lifecycle, independent
   sessions, abort propagation, resource scopes, and deterministic cleanup.
   Cover races and stale results before exposing more public operations.
3. **Editing protocol.** Add read-only policy, revisions, dirty state,
   serialization, and persistence acknowledgement. Test failed saves and
   editing while a save is in flight.
4. **Authoring SDK and test kit.** Export helpers and reusable conformance checks
   through explicit subpaths. Keep the optional test kit out of runtime imports.
5. **External integration proof.** Exercise a real text-plugin consumer in its
   own repository/package, plus a viewer-only fixture and a minimal plain-JS
   host. Validate authoring and custom controls before freezing the protocol.
6. **Release validation.** Verify all public subpaths from a packed npm artifact,
   matching JSR exports, no Bun/Node/DOM assumptions, isolated concurrent
   sessions, and 100% source line/function coverage with meaningful tests.

Each stage gets its own detailed red/green implementation plan and semantic
commits. The source tree is introduced by those stages, not by a cosmetic
all-at-once file shuffle.

## First implementation slice

The first implementation plan should cover stages 1 and 2: public source/plugin
contracts, deterministic resolution, managed sessions, subscriptions, abort,
and cleanup. It produces a useful runtime for viewer-only plugins and establishes
the boundaries needed by the editing protocol. Editing semantics and the full
test kit then receive focused follow-up plans rather than one oversized plan.

## Review scenarios

- Open two files with the same plugin; editing or disposing one does not change
  the other's model, subscriptions, or resources.
- Cancel loading; a plugin that finishes late cannot publish usable state and
  its resources are disposed.
- Load a broken file; the original plugin error and source/session context are
  available to the host, without silently switching to another decoder.
- Open an editable format under a read-only policy; editing commands cannot
  execute through a custom toolbar or a framework adapter.
- Start saving revision A, edit to revision B, then persist A; B remains dirty.
- Build a plugin in a separate package using only sdk/testing public imports;
  it does not rely on internal source paths or the core's private test fixtures.

## Compatibility and exclusions

The foundation API is explicitly experimental. This proposal requires changes
to its session ownership and richer contracts; the implementation plan must
document those changes instead of layering incompatible meanings onto save().

No format implementation, default UI, CSS system, framework adapter, plugin
marketplace, arbitrary dependency graph, collaboration engine, universal
document AST, or format-independent undo engine is included in this slice.
No new runtime dependency is proposed.
