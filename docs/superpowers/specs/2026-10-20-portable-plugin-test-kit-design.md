# Portable plugin conformance test kit

Status: proposed phase 3 design, requested on 2026-10-20. The managed runtime
and editing protocol are implemented; this document specifies the next public
subpath. It does not implement or export the test kit.

Related documents: [runtime architecture](2026-10-19-core-runtime-proposal.md),
[editing protocol](2026-10-20-editing-protocol-design.md),
[plugin authoring](../../plugin-authoring.md),
[customization](2026-10-19-customization-design.md), and
[domain language](../../../GLOSSARY.md).

## Goal and boundary

Give a plugin author reusable tests of their actual plugin through the public
Omniview runtime. The same suite must be usable from Bun tests, another test
runner, or an ordinary asynchronous JavaScript program. Plugins and framework
adapters continue to live in separate repositories.

The kit checks lifecycle integration, declared capabilities through author
assertions, independent documents, optional editing, immutable serialization,
and persistence receipts. It uses the plugin's real definition, source, and
capability methods. It supplies no parser, common document model, renderer,
storage service, test runner, or certification badge.

Format-specific meaning belongs to fixture callbacks. A generic lifecycle check
cannot establish that an Excel formula, Markdown parser, or PDF renderer is
correct. The kit also cannot discover arbitrary resource leaks. A plugin's
resource assertions and format regression tests remain necessary.

## Alternatives and decision

| Approach | Benefit | Cost |
| --- | --- | --- |
| Independent named cases with async `run()` functions | Native runner names, filtering, parallelism and failure reports; no runner dependency | Author registers cases and configures runner time limits |
| An embedded runner returning a single report | One convenience call | Duplicates runner scheduling, timeouts, output and skip semantics; hides individual tests |
| Unstructured assertion helpers only | Small initial API | Every plugin rebuilds the lifecycle scenarios and cleanup orchestration |

Choose independent cases. The kit owns scenario setup and cleanup; the caller
owns registration, execution order, concurrency, time limits and presentation.
There is no global runner registration, automatic execution, retry loop, CLI,
hidden sleep, environment detection, or background scheduling on import.

## Public surface

Add `@omniview/core/testing` alongside the existing root and `/sdk` entries.
Applications keep using the root; plugin implementation code uses `/sdk`; plugin
tests import `/testing` explicitly. Importing root or SDK must not pull testing
code into the application's runtime graph.

The following signatures are normative proposed declarations. `DocumentSession`,
`ReadableSource`, `SerializationResult`, and `OmniviewError` refer to existing
root types; `PluginDefinition`, `MaybePromise`, `Cleanup`, and `EditOptions` refer
to existing SDK types. All properties shown as readonly remain readonly.

```ts
export interface PluginTestFixture {
  readonly plugin: PluginDefinition;
  createSource(): MaybePromise<ReadableSource>;
  readonly dispose?: Cleanup;
}

export interface PluginTestContext<T extends PluginTestFixture> {
  readonly fixture: T;
  readonly session: DocumentSession;
}

export interface PluginOutputContext<T extends PluginTestFixture> {
  readonly fixture: T;
  readonly output: SerializationResult;
  readonly expectedFingerprint: string;
}

export interface UnsupportedSourceCase<T extends PluginTestFixture> {
  readonly id: string;
  createSource(fixture: T): MaybePromise<ReadableSource>;
}

export interface ControlledLoad {
  readonly entered: PromiseLike<void>;
  readonly drained: PromiseLike<void>;
  release(): MaybePromise<void>;
}

export interface ControlledEdit extends ControlledLoad {
  readonly result: PromiseLike<void>;
}

export interface PluginEditingChecks<T extends PluginTestFixture> {
  change(context: PluginTestContext<T>, options: EditOptions): MaybePromise<void>;
  verifyChanged(context: PluginTestContext<T>): MaybePromise<void>;
  verifyOutput(context: PluginOutputContext<T>): MaybePromise<void>;
  noChange?: (
    context: PluginTestContext<T>, options: EditOptions,
  ) => MaybePromise<void>;
  pending?: (
    context: PluginTestContext<T>, options: EditOptions,
  ) => ControlledEdit;
}

export interface PluginTestSuiteOptions<T extends PluginTestFixture> {
  readonly id: string;
  createFixture(): MaybePromise<T>;
  verifyDocument(context: PluginTestContext<T>): MaybePromise<void>;
  fingerprint(context: PluginTestContext<T>): MaybePromise<string>;
  readonly editing: false | PluginEditingChecks<T>;
  readonly unsupported?: readonly UnsupportedSourceCase<T>[];
  pauseLoad?: (fixture: T) => MaybePromise<ControlledLoad>;
  verifyDisposed?: (fixture: T) => MaybePromise<void>;
  onLateError?: (error: PluginConformanceError) => void;
}

export interface PluginConformanceCase {
  readonly id: string;
  readonly name: string;
  run(): Promise<void>;
}

export interface PluginConformanceOmission {
  readonly id: string;
  readonly reason: string;
}

export interface PluginTestSuite {
  readonly id: string;
  readonly cases: readonly PluginConformanceCase[];
  readonly omitted: readonly PluginConformanceOmission[];
}

export type PluginConformancePhase = "fixture" | "check" | "cleanup";

export interface PluginConformanceErrorOptions extends ErrorOptions {
  readonly caseId: string;
  readonly phase: PluginConformancePhase;
  readonly diagnostics?: readonly OmniviewError[];
  readonly cleanupErrors?: readonly unknown[];
}

export class PluginConformanceError extends Error {
  readonly caseId: string;
  readonly phase: PluginConformancePhase;
  readonly diagnostics: readonly OmniviewError[];
  readonly cleanupErrors: readonly unknown[];
  constructor(message: string, options: PluginConformanceErrorOptions);
}

export function createPluginTestSuite<T extends PluginTestFixture>(
  options: PluginTestSuiteOptions<T>,
): PluginTestSuite;
```

This is a focused suite builder, not a public mock `PluginContext`, fake core,
document implementation, or general assertion library. Deferred-promise helpers
and mutable test models remain internal until a separate need establishes a
public contract. No new application `ErrorCode` or `apiVersion` is needed.

## Discovery and configuration

Creating a suite is synchronous and side-effect free apart from validation. It
must not invoke the fixture factory, source factories, plugin, or callbacks.
Snapshot option fields, nested profile fields, descriptor arrays, and callback
receivers once. Later mutation of supplied objects does not change discovered
cases. Freeze the returned suite, arrays and descriptors; keep no shared mutable
run state in a case closure.

Suite and unsupported-source IDs match `[a-z0-9][a-z0-9._-]*`; an empty ID or
duplicate unsupported ID is invalid. A case ID combines the suite ID and the
suffix in the check catalog below. IDs are stable machine identifiers; names
are descriptive English labels and are not assertion keys. The caller must use
unique suite IDs when combining several suites.

Reject malformed configuration synchronously with `TypeError`, retaining an
original accessor failure as its cause. This includes missing required callbacks,
an editing value other than `false` or a complete profile, invalid optional
callbacks and malformed descriptors. Validate returned fixtures and controls at
execution time; those failures use `PluginConformanceError` in phase `fixture`.

Optional checks are selected by configuration, never silently inferred from a
plugin result. `editing: false` means the fixture expects viewer-only support;
an editing profile means it expects editable support even though permission
still defaults to read-only. A mismatch fails a check. The plugin factory may
configure the same plugin differently in separate suites.

The frozen `omitted` list identifies unconfigured families: `editing` for viewer
fixtures (excluding their required `editing/unsupported` case), `editing/noop`,
`editing/pending`, `load/pending`, `unsupported`, and `cleanup/plugin` as relevant.
Each omission ID has the suite ID prefix and one nonempty explanation. A family
omission covers all of its optional case suffixes. An omitted check is never counted as
passed and is never represented by an empty successful case. There is no runtime
skip return value. The caller can display omissions or fail its own coverage
policy; the kit sets no universal policy for formats that genuinely lack a feature.

## Fixtures and author responsibilities

Every `run()` calls `createFixture()` afresh, even when the same case is run twice
or concurrently. Each invocation owns its fixture, cores, sessions, diagnostic
collector and controls. A factory returns a fresh plugin definition and fresh
environment for that invocation. The independence case deliberately reuses that
one definition across its documents and cores.

`createSource()` returns an independent readable source for each document. Its
bytes are deterministic for the fixture, reads have no destructive cursor, and
returned arrays are independently owned. It may adapt bytes, a Blob, or an
author-controlled source; it never opens files or fetches URLs on behalf of the
author. External setup resources belong to fixture `dispose`, including a
fixture acquired successfully before source creation fails. If the fixture
factory fails before returning, it owns any resources already acquired.

The required `verifyDocument` callback asserts the initial document's actual
public capabilities and content. It may use the author's assertion library or
throw an ordinary error. A returned `false` is an invalid fixture result, not a
passing assertion. Verification callbacks must complete with undefined; any
other fulfilled value is a fixture error. The same rule applies to all
verification callbacks.

`fingerprint` returns a deterministic semantic string for this fixture's public
document content. It must exclude session IDs, revisions, timestamps, busy state,
caches and view state. Equal strings mean equivalent content for the tested
scenario; the kit does not require hashing, JSON, or a universal AST. It checks
that a fingerprint is a string, but the author is responsible for its meaning.

For editable fixtures, `change` calls a real public capability with supplied
options, changes content to a deterministic distinct state, and completes its
actual operation. It may accept several changes. `verifyChanged` asserts that
state, and its fingerprint must differ from the initial fingerprint. The kit
compares opaque revisions for equality only; it does not parse strings or assume
one capability invocation always produces exactly one revision.

`verifyOutput` decodes `output.source` and asserts the supplied expected semantic
fingerprint. It must inspect serialized bytes independently of the live model.
Changing an adapter's expected value, copying live state, replacing the plugin
with a mock, or wrapping a denied edit in a fake success would invalidate the
fixture. The fixture adapters are trusted test inputs, not plugin runtime APIs.

The optional `noChange` calls a genuine supported operation that performs no
accepted content change. It is omitted for plugins without such an operation;
equivalent final content alone does not prove that no revision was accepted.

`verifyDisposed`, when provided, asserts plugin resources after all cores have
closed and controlled work has drained, but before fixture environment cleanup.
Fixture `dispose` must not hide a plugin leak by running first. A typical check
asserts that parser subscriptions, worker handles, or registered resources have
returned to their initial count. Generic checks alone make no such leak claim.
The callback runs during cleanup of every case, including partially initialized
and pre-aborted runs; it must account for what was actually acquired. Its
dedicated `cleanup/plugin` case ensures a normal open/close is also exercised.

## Execution and failure ownership

Each case uses the real public `createOmniview` and managed sessions. It invokes
no private controller, registry, store, revision setter, or fake context. Callback
contexts are frozen wrappers containing the actual fixture and actual session;
the author-owned fixture itself is not deep-frozen. Async fixture and verification
callbacks are awaited. Control results are boxed objects, not promises standing
in for a controlled operation.

Register outcome observers before cancellation, revocation, disposal, or waiting
for a control milestone. Independent outcomes are stored without manufacturing
unhandled rejections. A milestone that loses to premature operation completion
fails the fixture contract rather than waiting for an event that cannot happen.

An invocation always attempts, in order: release each acquired control exactly
once, await its `drained` milestone, dispose every owned core, run configured
resource verification, and dispose the fixture environment. Every later cleanup
is attempted even if an earlier one fails. Cores and sessions are tracked as soon
as created. Checks that explicitly dispose a session/core still use its cached
disposal promise; cleanup must not run a plugin resource twice.
If releasing a control fails, record that cleanup failure and keep observing its
milestones, but do not block later cleanup awaiting that unreleased gate. Always
attempt the remaining control releases, core disposal and fixture cleanup.

If a check or fixture callback fails, retain that first failure as `.cause`,
including a thrown `null` or `undefined`. Attach secondary cleanup failures in
`cleanupErrors`. With no primary failure, cleanup failure rejects in phase
`cleanup`, with an `AggregateError` cause covering cleanup failures. Diagnostic
errors received through core `onError` make an otherwise successful case fail in
phase `check`; expected direct rejections are checked by the scenario instead.
If a primary already exists, attach diagnostics without replacing it.

`PluginConformanceError` exposes the full stable case ID and phase. Its diagnostic
and cleanup arrays are frozen snapshots. Keep original error identities and
causes; do not serialize arbitrary plugin values or depend on error messages.
The error is testing-specific and does not masquerade as an `OmniviewError`.

Phase selection follows the failed boundary:

| Boundary | Phase |
| --- | --- |
| Fixture/source factory, invalid returned data, invalid control or premature result, rejected entered milestone | `fixture` |
| Observed invariant, author content assertion, unexpected capability/encoding outcome, diagnostic before settlement | `check` |
| Release, drain, core disposal, resource verification, or fixture cleanup with no earlier primary | `cleanup` |

A non-string fingerprint or non-undefined verification result is invalid fixture
data. An exception thrown by a content verification callback is an assertion
failure. A later cleanup failure never changes an already-selected primary phase.

Known controlled work drains before completion. Diagnostics arriving after a
case has settled, for example from a plugin's detached cleanup registration, go
to `onLateError` with the originating case ID. The default sink is console.error;
a throwing sink falls back to console.error and does not create an unhandled
rejection. This cannot retroactively reject a completed case. Authors needing
strict late-error accounting connect this sink to their runner's own diagnostics
and supply drainable controls/resource assertions.

The runner owns time limits. There are no internal timing thresholds, automatic
retries, or guessed microtask flushes. A noncooperative plugin or broken fixture
can leave a case pending; the runner must enforce a finite test limit. A runner
timeout is not evidence that cleanup completed. The kit does not promise to kill
arbitrary plugin code or force an unresolved fixture cleanup to settle.

## Required check catalog

Each row is one independently runnable case unless its condition omits it.
Every run starts with a fresh fixture; helpers may share only immutable code.

| Case suffix | Observable assertions |
| --- | --- |
| `open/detection` | Automatic detection selects the fixture plugin; ready metadata matches the original source; `verifyDocument` succeeds; declared editing support matches |
| `open/explicit` | Opening with the plugin's exact ID produces the expected document through the managed runtime |
| `session/lifetime` | Created/not-ready guards, shared first-load promise, frozen stable snapshots, repeated disposal identity, closed guards, and removal from core membership |
| `session/independence` | Two documents in one core and a document in another core have valid initial content; closing one leaves the others usable; IDs are distinct within a core, not assumed globally distinct |
| `load/pre-aborted` | An already-aborted first load rejects `CANCELLED` with the original reason and reaches cancelled lifecycle state |
| `load/queued-dispose` | Disposing immediately after `load()` remains terminal; load rejects cancellation and repeated disposal shares its promise |
| `source/ownership` | Opening, verifying and closing do not change original source metadata or bytes; separate source reads remain independent |
| `unsupported/<id>` | Each configured unsupported source rejects automatic opening with `UNSUPPORTED_SOURCE`; the temporary session is removed |
| `cleanup/plugin` | Configured `verifyDisposed` runs after session/core cleanup and before fixture environment cleanup |

The lifetime cases inspect public guard categories and state. They do not claim
that every arbitrary retained capability method can be revoked by core. Format
capability assertions remain author-supplied. Pre-aborted and queued cases also
do not claim to exercise a plugin's already-running I/O; that uses the controlled
loading profile below.

For `editing: false`, add `editing/unsupported`: ready state reports
`supported: false`; serialization, policy change and acknowledgement reject
`EDITING_UNSUPPORTED`. A fabricated acknowledgement is used only to test guard
precedence. No editing method is invented for a viewer-only plugin.

For an editing profile, add these cases:

| Case suffix | Observable assertions |
| --- | --- |
| `editing/default-readonly` | Default support is present and read-only; `change` rejects `READ_ONLY`; content/revision/persisted state stay unchanged |
| `editing/policy` | Core default false and session override true/false resolve correctly; dynamic revocation/re-enable gates real capability changes |
| `editing/change` | Explicit permission admits `change`; `verifyChanged` succeeds; semantic fingerprint and revision change; dirty becomes true and busy clears |
| `editing/noop` | Optional `noChange` preserves revision, persistence and semantic content; transient busy transitions are allowed |
| `editing/independence` | Changing/revoking one document leaves the content, policy and revisions of the other sessions/cores unchanged |
| `serialization/initial` | Read-only export matches the initial fingerprint, is frozen, and leaves original metadata and persistence unchanged |
| `serialization/pre-aborted` | An already-aborted serialize rejects `CANCELLED` with the exact reason; content, revision and persistence stay unchanged |
| `serialization/capture` | Call serialize for initial state, immediately perform `change`, then verify the first output against the initial fingerprint and a second output against changed content |
| `serialization/concurrent` | Two initial captures have distinct output identities and match initial content; a later capture after change matches the new content and revision |
| `serialization/ownership` | Mutating a read buffer cannot corrupt later reads; output remains readable and verifiable after session disposal |
| `persistence/receipts` | Serialization alone stays dirty after a change; exact same-session acknowledgement becomes clean; repeated acknowledgement is a no-op; copies/fabrications and foreign receipts reject without changing state |
| `persistence/ordering` | Capture initial A and changed B; acknowledge B then A, matching that host write order; changed content remains current and becomes dirty again; re-acknowledging B restores clean |
| `editing/closed` | After disposal, a real attempted change rejects `SESSION_CLOSED`; no capability operation can resurrect a ready session |

The capture check verifies the observable call-time result, including when an
encoder finishes synchronously. It does not prove isolation across every possible
encoder schedule; an author tests a delayed encoder using controlled dependencies
in their own format scenarios. The baseline requires no encoder-delay API.
Concurrent case runs must not share fixture state. A renamed output may have
different metadata; only original session/source metadata must stay unchanged.
The receipt tests simulate acknowledgement order without claiming durable writes
to a real storage destination. Format encoding failures and malformed-output
contracts remain covered by core regressions and author format-specific tests.

## Controlled asynchronous profiles

These checks are optional and explicitly listed as omitted when unconfigured.
They use author-controlled dependencies or existing public capabilities; a plugin
must not add a production test-only command or expose `EditContext` solely for
this kit. An adapter must not substitute a wrapper delay for the plugin's actual
pending work. Plugins without suitable controllable async work can use the
baseline and their own integration tests.

`pauseLoad(fixture)` arms one real source/parser/dependency gate before load.
`entered` fulfills once that gate is reached during actual plugin loading;
loading must remain pending until release or cancellation. `release()` makes the
dependency available. `drained` fulfills after the tracked underlying work and
cleanup of any resources returned after cancellation/closure have finished.
It must not wait for normal disposal of a still-live document; that belongs to
the kit's subsequent core cleanup. It is a completion milestone, not the
already-cancelled public load promise. The author instruments its dependency
and resources to supply this milestone; the kit does not inspect private scopes.
All control milestones are observed from acquisition; a rejected entered
milestone is a fixture failure, and a rejected drain is a cleanup failure.
`release` and `drained` must be cooperative and deterministic.

Register `load/pending-cancel` and `load/pending-dispose`. Each waits for entered,
aborts the caller signal or disposes the session, and observes the public load's
`CANCELLED` rejection before releasing the dependency. Afterwards it releases,
drains and closes remaining resources, asserting no ready resurrection or
unexpected diagnostic. Closing an already ready session is covered separately.

`editing.pending(context, options)` starts one real edit, returns its actual
public operation in `result`, and exposes a gate before its first accepted
change. After entered, content and revision must still be initial and busy must
be true. `drained` tracks the underlying continuation after release, even if
`result` was already cancelled. It resolves after termination rather than
rejecting with an expected cancelled continuation error; unexpected fixture
failures still reject it.

Register four cases: `editing/pending-cancel`, `editing/pending-revoke`,
`editing/pending-dispose`, and `editing/pending-writer`. The first three trigger
the named terminal condition, observe cancellation before release, then release
and drain and assert no late accepted change. The writer case attempts `change`
while the first operation is held, expects `EDIT_BUSY`, then releases the first
operation and verifies its actual changed state. Cancellation causes and context
must retain the session, selected plugin and source identities. Caller abort
retains its exact reason, permission revocation has a `READ_ONLY` cause, and
session disposal has a `SESSION_CLOSED` cause. New calls after disposal reject
`SESSION_CLOSED`; the already-running operation rejects `CANCELLED`.

These profiles do not assert rollback or define a universal async-edit command.
Progressive edits with several accepted commits, failure after partial progress,
and format-specific streaming behavior remain author scenarios. Core already
has its own exhaustive protocol regressions; the kit tests the actual plugin's
available integration points.

## Example registration

This proposed usage assumes a real text plugin in a separate package. Its public
`textContent` capability exposes `read()` and `replace(value, options)`. Package
and capability names here illustrate that external contract; no such official
plugin is created by this phase.

```ts
import { test } from "bun:test";
import { createSource } from "@omniview/core";
import { createPluginTestSuite } from "@omniview/core/testing";
import { textPlugin, textContent } from "example-text-plugin";

const suite = createPluginTestSuite({
  id: "text.utf8",
  createFixture: () => ({
    plugin: textPlugin(),
    createSource: () => createSource(new TextEncoder().encode("before"), {
      name: "notes.txt", mimeType: "text/plain;charset=utf-8",
    }),
  }),
  verifyDocument({ session }) {
    const api = session.getCapability(textContent);
    if (!api || api.read() !== "before") throw new Error("Expected initial text");
  },
  fingerprint({ session }) {
    const api = session.getCapability(textContent);
    if (!api) throw new Error("Missing text capability");
    return api.read();
  },
  editing: {
    async change({ session }, options) {
      const api = session.getCapability(textContent);
      if (!api) throw new Error("Missing text capability");
      await api.replace("after", options);
    },
    verifyChanged({ session }) {
      if (session.getCapability(textContent)?.read() !== "after") {
        throw new Error("Expected changed text");
      }
    },
    async verifyOutput({ output, expectedFingerprint }) {
      const text = new TextDecoder().decode(await output.source.read());
      if (text !== expectedFingerprint) throw new Error("Output mismatch");
    },
  },
});

for (const check of suite.cases) {
  test(check.name, () => check.run());
}
// Display suite.omitted in the project's own reporting or enforce a policy.
```

A plain JS host needs only the generated cases; it can `await check.run()` in a
loop and catch errors. A runner may register cases concurrently when its fixture
factory isolates external resources. Omitting `editing` accidentally is a
configuration error; use `false` intentionally for a viewer fixture.

## Packaging, architecture, and compatibility

Add `src/testing/index.ts` with explicit exports and focused private modules for
contracts, suite discovery, per-run ownership, errors, baseline cases, editing
cases, and controlled async cases. Avoid one large scenario runner. Testing
consumes root/SDK-equivalent public operations and contracts; it does not change
core's dependency direction or require private hooks. Internal relative imports
retain `.ts` extensions for JSR. No third-party runtime dependency is introduced.

Add npm export `./testing` with ESM and declarations, matching JSR
`"./testing": "./src/testing/index.ts"`. Add a third build entry and preserve
shared runtime/error identity across all entries. Update the packed verifier's
hardcoded two-entry assumptions and execute a real extracted testing consumer.
Importing `/testing` may load the headless core it exercises; importing root or
SDK must not load the kit. Root and SDK exports remain unchanged.

Production source uses standard Web APIs and ECMAScript only. No Bun/Node
imports, `bun:test`, assertions from a runner, DOM access, CSS, subprocesses,
filesystem access or network access occur in `/testing`. Source factories own
external I/O. Bun remains the development/build/test tool. Node-only declarations
and browser-compatible declarations must both compile, and Node must execute the
packed consumer independently of Bun. Registry names and versions stay aligned;
publication and release versioning are separate decisions.

## Acceptance and verification

Implementation is accepted only with all of the following:

1. Strict compile tests cover fixture subtype inference, actual session/capability
   types, callback option propagation, viewer/editable profiles, readonly outputs,
   and rejection of incomplete configuration. Public declarations meet isolated
   declaration and JSR slow-type requirements.
2. Suite creation and import run no factories; discovered IDs/omissions are stable
   and frozen. Mutating supplied configuration does not change cases. Re-running
   or concurrently running a case uses independent environments.
3. Known-good viewer and editable plugins pass through real managed sessions.
   Tests use public root/SDK/testing seams, controlled promises and actual models.
   No private imports, revision injection, arbitrary sleeps or microtask counting.
4. Deliberately broken plugin/fixture pairs fail for the intended reason: wrong
   detection/content, shared model state, unguarded mutation, live-model encoding
   after capture, missing disposal, swallowed cancellation, or a bad control
   milestone. Core rejection alone is not proof that a format adapter is correct.
5. Failure tests cover source/factory/verification errors, thrown null/undefined,
   rejected controls, multiple cleanup failures, duplicate disposal, diagnostics
   during cleanup, late errors, and a throwing late-error sink. Primary causes
   survive and every later cleanup is attempted without unhandled rejections.
6. Controlled loading/edit cases exercise their real gates. Baseline-only suites
   report the omitted profiles explicitly. A plugin lacking editing is never
   accidentally certified by skipped successful callbacks.
7. All production source remains in the existing 100% line/function coverage
   gate, including every new testing module. Preserve thresholds and preload;
   branch coverage is not claimed. Prove the gate still rejects unused source.
8. `bun run check`, full development TypeScript checks, actual packed consumers,
   npm pack dry run, JSR dry run and documentation examples pass. Existing root
   and SDK consumers retain error identity and execute without test-kit imports.
9. Update authoring/README/architecture/AGENTS only when `/testing` exists. Keep
   its current absence explicit until implementation. No actual format plugin,
   renderer, framework adapter, CDN deployment or registry publication is part
   of this phase.

The next deliverable after approval is a separate implementation plan with
vertical behavior slices and public red/green tests. The later external proof
remains a real text plugin in its own repository and a plain JavaScript host.

## Design verification record

On 2026-10-20 the proposed declarations were extracted and checked strictly
against the existing root/SDK types with no runtime ambient types. The example
and additional positive/negative type assertions also compile: fixture subtypes
retain their extra fields, discovered outputs are readonly, editing must be
declared, and pending operations must be returned as synchronous control boxes.
The illustrative external text-plugin contract was declared only for this check.
This validates proposed type consistency, not a future test-kit implementation.

Local documentation links and code fences resolve; unresolved-marker and
whitespace checks pass. The unchanged implemented runtime passes `bun run check`:
196 tests, 549 assertions, 100% source line/function coverage, lint, strict types
and build. No `/testing` entry, production test-kit source, package dependency or
format plugin was added while writing this specification.
