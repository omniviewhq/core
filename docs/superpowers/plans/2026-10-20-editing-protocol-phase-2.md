# Editing Protocol Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended for independent tasks)
> or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Keep coupled runtime changes with one
> implementer; delegate only independent work when the workflow authorizes it.

**Goal:** Add optional async editing, guarded changes, revision/dirty state,
immutable serialization captures, and host persistence acknowledgements to the
portable managed runtime.

**Architecture:** Plugins keep their models and typed capability methods. Core
coordinates one async writer per session and synchronous accepted changes;
serialization captures a revision before asynchronous encoding. Session-owned
controllers share one observable store and the existing lifetime/resource layer.

**Tech Stack:** Bun 1.4.3, TypeScript 7.0.2, Biome 2.5.15, standard Web APIs,
bigint counters with string revisions. No new dependencies or package subpaths.

---

## Authority, scope, and execution rules

The user approved the [phase 2 design](../specs/2026-10-20-editing-protocol-design.md)
on 2026-10-20, including async edit operations. That document is the normative
public contract. Phase 1 baseline is commit `e2706d2`, with 98 behavior tests,
100% source line/function coverage, root/SDK exports, and packed consumers.
The task instructions below were written before implementation. Execution results
are recorded at the end; saving the original plan implemented no API.

Read `AGENTS.md`, `GLOSSARY.md`, the design, and current modules before changing
code. No UI, parser, command registry, rollback engine, public test-kit export,
new plugin repository, dependency, package version change, or registry publication
is included. The host owns storage and any sequencing of remote writes.

Use an isolated feature branch for execution; preserve any existing user changes.
If a managed worktree cannot be written under workspace permissions, use the
existing checkout on a feature branch, as in phase 1. Do not repeatedly create
unwritable worktrees. Integrate with `master` according to the user's existing
commit/push authorization after review and validation; never force-push.

Each scenario below is a separate vertical red/green slice: write one test,
observe its meaningful failure, implement its behavior, rerun the focused test,
then move to the next scenario. A scenario already established by an earlier
slice is retained as a regression; do not break working behavior to manufacture
a failure. Do not bulk-write all tests and then implement the whole feature.

Run strict types after each slice that changes contracts. Run full coverage at
task milestones; do not add unused production functions ahead of their first
public behavior. Introduce private methods when their task first exercises
them. Do not publish fake implementations of future methods. Keep all existing
phase 1 tests, especially reentrant cleanup, cancellation, and primary-error tests.

Use these coherent verification/commit milestones. Tasks 3-5 share writer
settlement; Tasks 6-8 share capture/receipt ownership. Their intermediate slices
run focused tests and types, then the complete milestone must pass the unchanged
full check before committing. Do not bypass coverage or claim an intermediate
slice is the completed protocol.

| Milestone | Full acceptance and commit |
| --- | --- |
| Shared type contracts | End of Task 1 |
| Optional editing support and policy | End of Task 2 |
| Complete guarded writer lifecycle | End of Task 5, covering Tasks 3-5 |
| Captures, cleanup, and persistence receipts | End of Task 8, covering Tasks 6-8 |
| Portable integration | End of Task 9 |
| Documentation and final review | End of Task 10 |

The shell examples use repository-relative paths for commands. Source imports
retain `.ts` suffixes. Semantic commits need detailed bodies explaining intent,
ownership decisions, and actual verification; the subjects below are suggestions.

## Confirmed test boundaries

| Boundary | Catches | Does not claim |
| --- | --- | --- |
| Root core/session API | Policy, state, lifetime, revisions, output, persistence | Storage durability or renderer layout |
| SDK through real fixture capabilities | Async work, commit guards, inference, captures | Correctness of a third-party model/parser |
| Actual packed root and `/sdk` | Export/runtime/declaration compatibility, independent Node execution | Registry publication or GitHub workflow execution |

Tests import `src/index.ts` or `src/sdk/index.ts`, never private controllers,
resource scopes, stores, counters, or task objects. Reuse controlled promises
from `tests/support/fixtures.ts`. No sleeps, guessed microtask counts, public
revision setters, production test hooks, or internal-function spies. A test
plugin may expose an operation through a typed capability to exercise the
public `PluginContext.edit` API; that is not a new public core testing API.

Attach `promise.catch((error: unknown) => error)` before triggering cancellation.
Run the matcher after the trigger: Bun 1.4.3 expectation chains can drain jobs.
Avoid asymmetric nested error matchers followed by inspection of the same
object: Bun may replace the matched field. Inspect `.cause` identity/shape
before such a matcher, or use separate direct assertions.

## Files and dependency direction

| File | Responsibility |
| --- | --- |
| `src/editing/types.ts` | Revision, options, operation context, mutation result, editing snapshot |
| `src/editing/state.ts` | Cached frozen editing state, revision counter, consistency/notification guards |
| `src/editing/create-editing.ts` | Definition snapshot, policy, writer token, async work and commit coordination |
| `src/serialization/types.ts` | Capture, encoder, output and persistence-receipt contracts |
| `src/serialization/capture.ts` | Synchronous capture validation, method ownership, malformed late capture cleanup |
| `src/serialization/create-serialization.ts` | Encoding tickets, capture resource ownership, output normalization, receipt registry |
| `src/sessions/create-session.ts` | Compose controllers with existing load, snapshots, handle methods and disposal |
| `src/sessions/types.ts`, `src/core/types.ts` | New ready state, host methods and read-only configuration |
| `src/core/create-core.ts` | Snapshot default policy and pass per-session override |
| `src/plugins/types.ts` | Optional editing definition and generic `PluginContext.edit` |
| `src/errors.ts` | Eight new structured error codes; retain existing codes |
| `src/index.ts`, `src/sdk/index.ts` | Explicit exports, using existing root and SDK entries |
| `tests/support/editing-fixture.ts` | Real per-open text model and typed public operation capability |
| `tests/editing*.test.ts`, `tests/serialization*.test.ts`, `tests/persistence.test.ts` | Public runtime scenarios |
| `tests/editing.types.ts`, `tests/package-consumer/consumer.ts` | Strict type/packed-consumer checks |
| Existing guides/architecture/AGENTS | Current API guidance after implementation, preserving roadmap exclusions |

Editing and serialization import contracts/errors/lifecycle primitives, never
core or public barrels. Serialization consumes a narrow editing controller
interface; it never accesses the plugin's live model, counter, or raw state.
Type-only cross-imports between editing and serialization contracts are allowed.
Keep phase 1 source/selection logic independent. No parallel observer system.

### Private coordination contracts to implement

Declare these private interfaces beside their controllers, with explicit types.
They are not root/SDK exports. Add each member in the task that first uses it.

```ts
// src/editing/create-editing.ts
import type { ErrorContext, OmniviewError } from "../errors.ts";
import type { PluginContext } from "../plugins/types.ts";
import type { EditingDefinition, SerializationSnapshot } from "../serialization/types.ts";
import type { EditingSnapshot, Revision } from "./types.ts";

export interface EditingHost {
  ensureReady(): void;
  context(): ErrorContext;
  publish(): void;
}

export interface EditingController {
  attach(definition: EditingDefinition | undefined): void;
  getSnapshot(): EditingSnapshot;
  edit: PluginContext["edit"];
  setReadOnly(value: boolean): void;
  assertAvailable(): void;
  capture<T>(consume: (
    take: () => SerializationSnapshot, revision: Revision,
  ) => T): T;
  acknowledge(revision: Revision): void;
  close(reason: OmniviewError): void;
}
```

`ensureReady` first checks a synchronous session terminal flag, then lifecycle
status. It throws `SESSION_CLOSED` or `SESSION_NOT_READY` with contextual identity.
`context` returns the captured source/session/selected-plugin identity, including
after disposal. `publish` recomposes the current ready snapshot only if still
live and its nested editing object changed. It never writes a ready arm over a
terminal snapshot. `attach` snapshots the original receiver/capture method once.

`capture` checks readiness/support/exclusivity and holds the synchronous capture
guard while `consume` invokes `take`, validates the returned object, and claims
its cleanup. It passes a fixed revision and a one-call closure for the captured
method, invoked with its original receiver and frozen `{ revision }` context.
`assertAvailable` checks ready/support and the apply/capture consistency guard,
without invoking capture or checking read-only policy.

```ts
// src/serialization/create-serialization.ts
import type { EditingController } from "../editing/create-editing.ts";
import type { Revision } from "../editing/types.ts";
import type { ErrorContext, OmniviewError } from "../errors.ts";
import type { ErrorReporter } from "../lifecycle/reporting.ts";
import type { Cleanup } from "../plugins/types.ts";
import type { SourceMetadata } from "../sources/types.ts";
import type { SerializeOptions, SerializationResult } from "./types.ts";

export interface SerializationHost {
  readonly editing: Pick<EditingController,
    "assertAvailable" | "capture" | "acknowledge">;
  readonly source: SourceMetadata;
  context(): ErrorContext;
  isClosed(): boolean;
  own(cleanup: Cleanup): () => void;
  readonly report: ErrorReporter;
}

export interface SerializationController {
  serialize(options?: SerializeOptions): Promise<SerializationResult>;
  markPersisted(result: SerializationResult): void;
  close(reason: OmniviewError): void;
}

// Receipt ownership stays private to this controller, not in public objects.
// WeakMap<SerializationResult, Revision>
```

`own` uses the existing session resource scope. `source` is the existing frozen
original metadata. `isClosed` reads the terminal flag, not a potentially older
observable snapshot. `close` invalidates all serialization tickets immediately,
marks registered captures as session-claimed, and aborts their encoding signals;
it does not await encoding promises. Actual known cleanup is awaited by the
session resource scope.

### State, operation, and cleanup algorithms

Use a private bigint revision counter, persisted string revision, policy/busy
fields, an `exclusive` phase (`applying` or `capturing`), and a notification-depth
counter. Public revisions are decimal strings; no arithmetic API or overflow
hook. Cache the frozen nested snapshot by its observable fields. Keep state
updates separate from publication so failure/revocation can publish coherent
revision, policy, and busy state together.

```ts
// Reference calculations inside the state module.
const revision = counter.toString();
const dirty = revision !== persistedRevision;

// Every actual ready-state publication is guarded against nested commits.
notificationDepth++;
try { host.publish(); } finally { notificationDepth--; }
```

An edit operation owns a token, AbortController, linked external listener,
settled flag, and one explicitly controlled result promise. Register its promise
resolvers before any notification. Do not implement a failed commit solely by
aborting the phase 1 `abortable`: that helper always produces `CANCELLED`, whereas
an invalid/throwing commit must force `EDIT_FAILED` even if plugin work catches it.

```text
finish(token, outcome):
  if token already settled: return
  mark settled; invalidate token; unlink caller signal
  if current writer is token: clear writer and busy
  publish changed live state once; never publish ready after closure
  abort operation signal on failure/cancellation, preserving first outcome
  settle this token's promise with its original outcome
```

Invalidate before abort callbacks and observers. Attach fulfillment/rejection
handlers to the underlying work even after forced settlement. Keep token
identity checks in every continuation, so an older finalizer cannot release a
newer writer. Successful completion leaves its signal unlinked without inventing
an abort; retained contexts are invalid regardless of that signal's aborted flag.
If failure is detected inside a change callback/result validation, prepare its
first outcome and token invalidation immediately, but leave the applying guard
before publishing state or dispatching abort callbacks. Combine conservative
revision and released busy state in that publication. Abort listeners then read
the updated snapshot, just as phase 1 disposal observers read terminal state.

For each serialization ticket keep its captured revision, cancellation state,
local once-only capture scope, session unregister function, `sessionClaimed`
flag, and pending/success/failure outcome. Session closure claims registered
tickets synchronously, rather than waiting until their LIFO cleanup callbacks
are invoked. This matters when some other owned cleanup is still pending.

```text
finish encoding/cancellation:
  normalize output bytes before releasing snapshot resources
  await the ticket's cached local cleanup promise
  unregister session cleanup before publishing any diagnostic
  if an encoding/cancellation primary exists:
    report cleanup failure once only when session has not claimed it
    reject primary
  else if cleanup failed: reject CLEANUP_FAILED
  else if ticket/session no longer permits success: reject CANCELLED
  else: freeze result, register exact identity in WeakMap, fulfill
```

Never register a capture in an already-closed session scope: close its local
scope and treat it as late cleanup instead. A capture returned after reentrant
closure is cleaned, never encoded, and cannot generate a receipt. Rejected
async captures are detached; observe their eventual outcome and dispose late
snapshot resources through one diagnostic owner.

## Task 1: Shared declarations and strict authoring types

**Files:** Create `src/editing/types.ts`, `src/serialization/types.ts`,
`tests/editing.types.ts`; modify type exports in `src/index.ts`, `src/sdk/index.ts`.

- [x] Write the following compile-time assertions before adding the exports:

```ts
import type { EditingSnapshot, Revision, SerializationResult } from "../src/index.ts";
import type {
  CaptureContext, EditContext, EditingDefinition, EditOptions, MaybePromise,
  MutationResult, SerializeContext, SerializedData, SerializationSnapshot,
} from "../src/sdk/index.ts";

export function checkEdits(context: EditContext): void {
  const result: string = context.commit(() => ({ changed: true, value: "text" }));
  const noChange: MutationResult<void> = { changed: false, value: undefined };
  context.commit(() => noChange);
  // @ts-expect-error A change callback cannot return a Promise.
  context.commit(async () => ({ changed: true, value: "text" }));
  // @ts-expect-error changed must be boolean.
  context.commit(() => ({ changed: "yes", value: "text" }));
  void result;
}

export function checkContracts(
  state: EditingSnapshot, revision: Revision, output: SerializationResult,
  options: EditOptions, capture: CaptureContext, encoder: SerializeContext,
  snapshot: SerializationSnapshot, definition: EditingDefinition,
): void {
  if (state.supported) {
    const current: string = state.revision;
    const dirty: boolean = state.dirty;
    void [current, dirty];
  }
  const data: SerializedData = { data: new Uint8Array([97]) };
  const pending: MaybePromise<SerializedData> = Promise.resolve(data);
  // @ts-expect-error Revision metadata is a string, not a numeric counter.
  const numeric: number = revision;
  void [output, options, capture, encoder, snapshot, definition, pending, numeric];
}
```

- [x] Run `bun run typecheck`; expect missing root/SDK type exports.
- [x] Add exactly the declarations from the approved design's public-contract
  section, with type-only imports and JSDoc. Export host types from root and
  all authoring types from SDK. Use `Revision = string`; counters stay private.
  Do not yet add required methods to existing runtime interfaces; their first
  behavior is introduced in subsequent tasks rather than fake runtime methods.
- [x] Run `bun run typecheck`, then `bun run check`. Type-only files must not
  reduce executable coverage or add dependencies.
- [x] Commit `feat(editing): define shared editing contracts` with the strict
  synchronous-change/async-operation distinction in its body.

## Task 2: Optional support, policy precedence, and observable state

**Files:** Create `src/editing/state.ts`, `src/editing/create-editing.ts`,
`tests/editing-policy.test.ts`; modify `src/plugins/types.ts`, `src/sessions/types.ts`,
`src/core/types.ts`, `src/core/create-core.ts`, `src/sessions/create-session.ts`,
`src/errors.ts`. Introduce only controller members exercised in this task.

- [x] Write this first public behavior:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { fixturePlugin } from "./support/fixtures.ts";

test("separates plugin editing support from host policy", async () => {
  const source = createSource(new Blob(["a"]));
  const core = createOmniview({ plugins: [fixturePlugin({
    open: () => ({ editing: { capture: () => ({
      serialize: () => ({ data: new Blob(["a"]) }),
    }) } }),
  })] });
  const session = await core.open(source);
  const initial = session.getSnapshot();
  expect(initial).toMatchObject({ status: "ready", editing: {
    supported: true, readOnly: true, busy: false,
    revision: "0", persistedRevision: "0", dirty: false,
  } });
  session.setReadOnly(false);
  expect(session.getSnapshot()).toMatchObject({ editing: { readOnly: false } });
  const enabled = session.getSnapshot();
  session.setReadOnly(false);
  expect(session.getSnapshot()).toBe(enabled);
  expect(initial).not.toBe(enabled);
  if (enabled.status !== "ready") throw new Error("Expected ready");
  expect(Object.isFrozen(enabled.editing)).toBe(true);
  await core.dispose();
});
```

- [x] Run `bun test tests/editing-policy.test.ts`; expect the absent editing arm
  or `setReadOnly` behavior to fail. Expand public types only with those features.
- [x] Add `PluginDocument.editing`, ready snapshot `.editing`, core/session
  `readOnly?: boolean`, and `setReadOnly`. Snapshot core defaults and overrides
  once. Add all eight approved error codes without removing existing ones.
  Read optional definition fields once after result cleanup is registered.

```ts
// Policy resolution, performed before tracking a newly created session.
function resolveReadOnly(value: boolean | undefined, fallback: boolean): boolean {
  if (value !== undefined && typeof value !== "boolean") {
    throw new OmniviewError("INVALID_OPTIONS", "readOnly must be boolean");
  }
  return value ?? fallback;
}
```

- [x] Integrate the host publication callback with the existing store. A live
  ready snapshot is recomposed only when the nested editing snapshot reference
  changes. Store notification revisions remain distinct from content revisions.
  Snapshot `{ receiver, capture }` data at attach, preserving method context.
  Do not invoke the capture method or create unused callable wrappers yet.
- [x] Expand one behavior per red/green cycle:

| Fixture/action | Expected assertion |
| --- | --- |
| Existing plugin returns `{}` | ready editing equals `{ supported:false }` |
| Core `readOnly:false`, no override | ready readOnly=false |
| Core false + session true; core true + session false | session override wins |
| Mutate the caller's options object after construction/creation | captured policy does not change |
| JS values `null`, `0`, `"false"` supplied as policy | `INVALID_OPTIONS`, no tracked session on create failure |
| Editing values null/array/empty/noncallable capture | `INVALID_EDITING`, owned result cleanup runs once |
| Getter for editing/capture throws null | contextual `PLUGIN_FAILED`; no raw dereference exception |
| Before load / unsupported / disposed policy call | `SESSION_NOT_READY` / `EDITING_UNSUPPORTED` / `SESSION_CLOSED` |
| Repeated equal policy, source metadata checks | no extra notification; original source metadata remains frozen/stable |

- [x] Run focused tests, `bun run typecheck`, and `bun run check`; commit
  `feat(editing): expose support and read-only policy` with option and snapshot
  compatibility details. Keep `PluginContext.edit` for its functioning slice next.

## Shared text fixture for Tasks 3-9

Add this complete fixture in Task 3, after adding the generic context method.
It exercises actual model changes and captures. It is test support, not a
production text plugin, format repository, or public testing subpath.

```ts
// tests/support/editing-fixture.ts
import type { DocumentSession, EditingSnapshot } from "../../src/index.ts";
import {
  defineCapability, definePlugin, provideCapability,
  type CaptureContext, type EditContext, type EditOptions, type MaybePromise,
  type PluginDefinition, type SerializationSnapshot,
} from "../../src/sdk/index.ts";

export interface TextWork extends EditContext {
  read(): string;
  replace(value: string): void;
}

export interface TextEditor {
  read(): string;
  replace(value: string, options?: EditOptions): Promise<void>;
  run<T>(work: (context: TextWork) => MaybePromise<T>, options?: EditOptions): Promise<T>;
}

export const textEditor = defineCapability<TextEditor>("fixture.text:editor");

export interface TextFixtureOptions {
  readonly capture?: (text: string, context: CaptureContext) => SerializationSnapshot;
}

export function textPlugin(options: TextFixtureOptions = {}): PluginDefinition {
  return definePlugin({
    id: "fixture/editable-text", apiVersion: 1, supports: () => true,
    async open({ source, signal, edit, onDispose }) {
      let text = new TextDecoder().decode(await source.read({ signal }));
      onDispose(() => { text = ""; });
      const run: TextEditor["run"] = (work, editOptions) => edit((context) => {
        const replace = (next: string): void => context.commit(() => {
          const changed = text !== next;
          text = next;
          return { changed, value: undefined };
        });
        return work({ signal: context.signal, commit: context.commit,
          read: () => text, replace });
      }, editOptions);
      return {
        capabilities: [provideCapability(textEditor, {
          read: () => text,
          replace: (next, editOptions) => run(({ replace }) => replace(next), editOptions),
          run,
        })],
        editing: { capture(context) {
          const captured = text;
          return options.capture ? options.capture(captured, context) : {
            serialize: () => ({ data: new TextEncoder().encode(captured),
              mimeType: "text/plain;charset=utf-8" }),
          };
        } },
      };
    },
  });
}

export function editingState(session: DocumentSession): Extract<EditingSnapshot, { supported:true }> {
  const snapshot = session.getSnapshot();
  if (snapshot.status !== "ready" || !snapshot.editing.supported) {
    throw new Error("Expected a ready editable document");
  }
  return snapshot.editing;
}

export function editor(session: DocumentSession): TextEditor {
  const capability = session.getCapability(textEditor);
  if (!capability) throw new Error("Expected text editor capability");
  return capability;
}
```

## Task 3: Async operation ownership and accepted changes

**Files:** Modify `src/editing/create-editing.ts`, `src/editing/state.ts`,
`src/plugins/types.ts`, `src/sessions/create-session.ts`, `tests/sdk.test.ts`;
create the shared fixture above, `tests/editing.test.ts`, and extend
`tests/editing.types.ts`.

- [x] Write the first operation test:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { deferred } from "./support/fixtures.ts";
import { editor, editingState, textPlugin } from "./support/editing-fixture.ts";

test("accepts several changes across one async edit", async () => {
  const gate = deferred<void>(); const started = deferred<void>();
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), { readOnly:false });
  const api = editor(session);
  const operation = api.run(async ({ replace }) => {
    replace("b"); started.resolve();
    await gate.promise;
    replace("c"); return "finished";
  });
  await started.promise;
  expect(api.read()).toBe("b");
  expect(editingState(session)).toMatchObject({ busy:true, revision:"1", dirty:true });
  gate.resolve();
  expect(await operation).toBe("finished");
  expect(api.read()).toBe("c");
  expect(editingState(session)).toMatchObject({ busy:false, revision:"2", persistedRevision:"0", dirty:true });
  await core.dispose();
});
```

- [x] Run `bun test tests/editing.test.ts`; expect missing `edit` or no accepted
  revision behavior. Add `PluginContext.edit` with the approved generic signature,
  thread the real controller method into `plugin.open`, then add the full fixture.
- [x] Migrate the two manual `plugin.open({ ... })` contexts in
  `tests/sdk.test.ts` to real `core.open(source)` integration, retaining SDK
  capability/inference assertions and probe behavior. A new required context
  method makes those hand-written contexts obsolete. Do not stub `edit`, assert
  the missing member away, or weaken its type. Retrieve the text capability from
  the real managed session and await core cleanup.
- [x] Implement one explicitly settled result promise per edit as described
  above. Establish active token/busy before notifications and defer plugin work.
  Enforce ready/support/exclusive/policy/busy guards without calling denied work.
  Attach handlers to sync throws and thenables; preserve original error causes.
- [x] Implement synchronous commit with returned-field snapshotting, revision
  advancement, changed=false suppression, and stable frozen state. The critical
  boundary is:

```text
commit(token, change):
  require live ready session, valid token, available model, writable policy
  reject nested notification commit
  enter applying phase
  invoke change and capture changed/value/thenability once
  on invalid/throw: advance conservatively; force EDIT_FAILED for token
  on changed=true: advance once
  leave applying phase
  publish coherent revision/busy state under notification-depth guard
  if session closed during callback: do not publish ready; deny continuation
  return captured value for a successful change
```

- [x] Expand scenarios consecutively: no-op replacement leaves revision `"0"`;
  returned values retain their types; zero-commit async work changes only busy;
  second writer rejects `EDIT_BUSY` without invoking work; a viewer-only retained
  edit function rejects unsupported; calling edit during open rejects not-ready;
  initial read-only denial invokes no callback. Read-only APIs remain readable.
- [x] Run focused tests and strict types. Verify previously loaded ready
  sessions still share their original load promise after revision changes.
  Keep this slice with Tasks 4-5 until the writer milestone passes full checks.

## Task 4: Cancellation, permission revocation, and stale operations

**Files:** Complete writer lifetime handling in `src/editing/create-editing.ts`;
modify session disposal composition; create `tests/editing-cancellation.test.ts`.

- [x] Write this controlled race before changing cancellation behavior:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { deferred } from "./support/fixtures.ts";
import { editor, editingState, textPlugin } from "./support/editing-fixture.ts";

test("a cancelled old writer cannot change a newer operation", async () => {
  const started = deferred<void>(); const releaseOld = deferred<void>();
  const stale = deferred<unknown>(); const controller = new AbortController();
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), { readOnly:false });
  const api = editor(session);
  const old = api.run(async ({ replace }) => {
    replace("first"); started.resolve(); await releaseOld.promise;
    try { replace("stale"); } catch (error) { stale.resolve(error); }
  }, { signal:controller.signal });
  const rejected = old.catch((error: unknown) => error);
  await started.promise;
  const reason = new Error("cancel first writer"); controller.abort(reason);
  expect(await rejected).toMatchObject({ code:"CANCELLED", cause:reason });
  const nextStarted = deferred<void>(); const releaseNext = deferred<void>();
  const next = api.run(async ({ replace }) => {
    nextStarted.resolve(); await releaseNext.promise; replace("newer");
  });
  await nextStarted.promise; releaseOld.resolve();
  expect(await stale.promise).toMatchObject({ code:"CANCELLED" });
  expect(editingState(session).busy).toBe(true);
  releaseNext.resolve(); await next;
  expect(api.read()).toBe("newer");
  expect(editingState(session)).toMatchObject({ revision:"2", dirty:true, busy:false });
  await core.dispose();
});
```

- [x] Run `bun test tests/editing-cancellation.test.ts`; expect cancelled work
  not settling or stale continuation changing/releasing the new operation.
- [x] Link each caller signal only to its own operation. On abort invalidate
  first, release active ownership immediately, settle `CANCELLED`, and continue
  observing underlying work. Map revocation to a contextual READ_ONLY cause and
  closure to SESSION_CLOSED cause. `close` emits no intermediate ready state.
- [x] Preserve phase 1 disposal identity/ownership using this exact ordering:

```text
session.dispose():
  return existing disposal promise when present
  cache a controlled disposal promise before any user callback
  set terminal flag (all operation validity checks include this flag)
  synchronously claim the existing resource scope's owned entries
  remove core membership; publish disposed; clear subscriptions/capabilities
  close editing/serialization controllers; abort lifetime signal
  settle cached disposal promise from known cleanup, retaining phase 1 error rules
```

  A controlled promise uses standard `new Promise` resolvers, not a new runtime
  dependency or an unlisted ES2024 ambient API. Do not await writer work here.
- [x] Add separate races for pre-aborted and queued edits (work never runs),
  cancellation before any commit, cancellation after partial progress, late
  rejection, policy true while work awaits, policy false followed by a new
  operation, external abort after success, and disposal with ignored work.
  Capture a completed `TextWork` context and assert subsequent commit is denied.
- [x] Assert in-flight operation promise cancellation is `CANCELLED`, while a
  new call through the disposed capability rejects `SESSION_CLOSED`. The
  retained cancelled context on a live session remains `CANCELLED` even after
  re-enable. Keep the original cause, revision and source/session/plugin context.
- [x] Run cancellation and all phase 1 cleanup/lifetime regressions, strict types,
  then proceed to Task 5's full writer milestone. Do not commit an unverified
  partial cancellation/cleanup boundary.

## Task 5: Failed changes, reentrant notifications, and stable observations

**Files:** Complete guards/error settlement in `src/editing/create-editing.ts`
and `src/editing/state.ts`; create `tests/editing-failures.test.ts`,
`tests/editing-state.test.ts`. Keep phase 1 observer isolation in the existing store.

- [x] Write the forced-failure behavior:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { editor, editingState, textPlugin } from "./support/editing-fixture.ts";

test("a caught failed commit still rejects the operation and stays dirty", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), { readOnly:false });
  const cause = new Error("change failed");
  let retainedFailure: unknown;
  const operation = editor(session).run(({ commit }) => {
    try { commit(() => { throw cause; }); } catch (error) { retainedFailure = error; }
    return "plugin caught the synchronous exception";
  });
  await expect(operation).rejects.toMatchObject({ code:"EDIT_FAILED", cause });
  expect(retainedFailure).toMatchObject({ code:"EDIT_FAILED", cause });
  expect(editingState(session)).toMatchObject({ revision:"1", dirty:true, busy:false });
  expect(session.getSnapshot().status).toBe("ready");
  await editor(session).replace("recovered");
  expect(editingState(session).revision).toBe("2");
  await core.dispose();
});
```

- [x] Run `bun test tests/editing-failures.test.ts`; expect fulfillment, missing
  conservative revision, or a nested/wrong error cause before implementation.
- [x] Complete first-outcome settlement. A failed callback invalidates the token
  before notifications and cannot be neutralized by work catching its exception.
  Force `EDIT_FAILED`, advance once for uncertainty, and keep lifecycle ready.
  Work failure outside a commit does not create an additional revision.
- [x] Add malformed JavaScript callback results using an explicit unknown cast
  in tests: null, primitive, missing value, nonboolean changed, throwing getters,
  and a promise. Read fields once, preserve TypeError/unknown causes, and observe
  a rejected async callback promise even though it is invalid as a change.
- [x] Verify reentrant behavior with controlled callbacks:

```ts
// Inside a test after constructing a writable session with textPlugin().
const attempts: unknown[] = [];
const operation = editor(session).run((work) => {
  const remove = session.subscribe(() => {
    if (editingState(session).revision === "1") {
      try { work.commit(() => ({ changed:true, value:undefined })); }
      catch (error) { attempts.push(error); }
    }
  });
  try { work.replace("b"); } finally { remove(); }
});
await operation;
expect(attempts).toHaveLength(1);
expect(attempts[0]).toMatchObject({ code:"EDIT_BUSY" });
expect(editingState(session).revision).toBe("1");
```

- [x] Expand separately: busy observer starts a second operation (rejected);
  busy observer revokes/disposes before scheduled work (work never called);
  revision observer revokes after an accepted change (that revision retained,
  operation cancelled); observer throws (diagnostic only); duplicate subscriptions,
  removed observers and superseded notification passes preserve phase 1 behavior.
  JSON-encode snapshot metadata and assert revision remains the string `"1"`.
- [x] During applying, deny nested commit, policy change, and acknowledgement
  without a second body invocation. Capture/ack guard tests join Tasks 6/8 when
  those public methods exist. During revision notification, preserve the commit
  guard across nested policy notifications; use a depth counter, not a boolean
  that an inner callback can clear.
- [x] Run focused tests, strict types, then `bun run check`; commit
  `feat(editing): coordinate cancellable document changes` for Tasks 3-5 with
  async progress, uncertainty, cancellation and observer semantics in the body.

## Task 6: Consistent captures and independently owned output

**Files:** Create `src/serialization/capture.ts`,
`src/serialization/create-serialization.ts`, `tests/serialization.test.ts`;
add private capture guards to the editing controller/state; modify
`src/sessions/types.ts`, `src/sessions/create-session.ts` to expose serialize.

- [x] Write the consistency test first:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { deferred } from "./support/fixtures.ts";
import { editor, editingState, textPlugin } from "./support/editing-fixture.ts";

test("serializes captured A while later edits reach B", async () => {
  const gate = deferred<void>(); const captured: string[] = [];
  let cleaned = 0;
  const core = createOmniview({ plugins: [textPlugin({
    capture(text, context) {
      captured.push(`${context.revision}:${text}`);
      return {
        async serialize() { await gate.promise; return { data:new TextEncoder().encode(text) }; },
        dispose() { cleaned++; },
      };
    },
  })] });
  const session = await core.open(createSource(new Blob(["a"], { type:"text/plain" }), { name:"notes.txt" }), { readOnly:false });
  await editor(session).replace("A");
  const serializing = session.serialize();
  expect(captured).toEqual(["1:A"]); // capture happens at call time
  await editor(session).replace("B");
  gate.resolve();
  const output = await serializing;
  expect(output.revision).toBe("1");
  expect(new TextDecoder().decode(await output.source.read())).toBe("A");
  expect(output.source.name).toBe("notes.txt");
  expect(cleaned).toBe(1);
  expect(editingState(session)).toMatchObject({ revision:"2", persistedRevision:"0", dirty:true });
  await core.dispose();
  expect(new TextDecoder().decode(await output.source.read())).toBe("A");
  expect(cleaned).toBe(1);
});
```

- [x] Run `bun test tests/serialization.test.ts`; expect missing serialize or
  inconsistent capture timing/bytes. Introduce `serialize` only with this
  functioning path, not a rejected placeholder method.
- [x] Add synchronous capture and a cancellable encoding ticket. Wrap guards
  and capture in a synchronous try that returns a rejected promise on failure;
  do not defer capture through `Promise.resolve().then(...)`. Set up ticket/signal
  state before any plugin callback. Pre-aborted signals invoke no capture.

```text
serialize(options):
  require live ready supported controller and available model
  reject pre-aborted signal without capture
  allocate independent ticket and cancellation linkage
  editing.capture((take, revision) => {
    save revision on ticket
    invoke take once; validate/own its cleanup and encoder under capture guard
    if still live: register ticket cleanup with session scope
  })
  race encoding against ticket cancellation; retain original method receiver
  normalize bytes with source defaults; await once-only local cleanup
  recheck ticket/session; issue frozen result at captured revision
```

- [x] Normalize output with standard sources. Read output properties once,
  validate shape and source options, and wrap failures as `SERIALIZATION_FAILED`:

```ts
// After snapshotting and validating SerializedData's fields.
const source = createSource(data, {
  name: name ?? host.source.name,
  mimeType: mimeType ?? host.source.mimeType,
});
const result: SerializationResult = Object.freeze({ revision, source });
```

  Do not let an async callback assimilate a raw capture/collection field. Box
  raw values until their protocol validation is complete, following phase 1's
  result-field fix. Private receipt registration may be added now as data;
  the public acknowledgement method is exercised in Task 8.
- [x] Extend scenarios one at a time: concurrent captures preserve independent
  revisions; capture while a writer awaits is allowed; serialization while
  read-only is allowed; Uint8Array input and every returned read are independent;
  snapshot cleanup zeroes its original array without corrupting returned bytes;
  output metadata override/defaults and malformed bytes/names are validated.
- [x] Add capture exclusivity tests: a change callback cannot call serialize;
  capture cannot reenter commit, edit start, nested capture, policy change, or
  later acknowledgement; reads and disposal remain allowed. A revision observer
  may serialize after a committed change. Capture/encoder/cleanup methods retain
  original receivers, and protocol/accessor fields are read once.
- [x] Keep output receipt minting private and after cleanup/success fences.
  Do not change original source metadata, persisted revision, or dirty on success.
  Run focused tests and strict types; continue through Tasks 7-8 before the
  capture/receipt milestone's full check and commit.

## Task 7: Serialization cancellation and capture resource ownership

**Files:** Complete `src/serialization/capture.ts`,
`src/serialization/create-serialization.ts`, session disposal integration;
create `tests/serialization-lifecycle.test.ts`,
`tests/serialization-failures.test.ts`. Reuse existing lifecycle primitives.

- [x] Write prompt disposal without waiting for an encoder:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import type { SerializedData } from "../src/sdk/index.ts";
import { deferred } from "./support/fixtures.ts";
import { textPlugin } from "./support/editing-fixture.ts";

test("disposes known capture resources without awaiting ignored encoding", async () => {
  const started = deferred<void>(); const encoded = deferred<SerializedData>();
  let cleaned = 0;
  const core = createOmniview({ plugins: [textPlugin({ capture: () => ({
    serialize() { started.resolve(); return encoded.promise; },
    dispose() { cleaned++; },
  }) })] });
  const session = await core.open(createSource(new Blob(["a"])));
  const outcome = session.serialize().catch((error: unknown) => error);
  await started.promise;
  await session.dispose();
  expect(await outcome).toMatchObject({ code:"CANCELLED" });
  expect(cleaned).toBe(1);
  encoded.reject(new Error("late encoder rejection is observed"));
  await core.dispose();
  expect(session.getSnapshot().status).toBe("disposed");
  expect(cleaned).toBe(1);
});
```

- [x] Run the focused test before extending ticket closure. On session close,
  invalidate tickets and mark their registered captures session-claimed before
  any later wrapper finalizer can report errors. Share one cached local cleanup
  promise between serializer and session ownership; do not re-run snapshot cleanup.
- [x] Add controlled tests for all abort points: before capture, reentrant abort
  during capture, queued encoder, pending encoder, and pending known cleanup.
  After a fulfilled serialize, later caller abort cannot affect its output,
  session, or another ticket. Read-only revocation cancels edits but not encoders.
  Each primary retains its original reason and session/source/plugin identity.
- [x] Add malformed captures: null, array, missing/noncallable encoder,
  invalid cleanup, getters throwing null, promises and custom thenables. A valid
  captured cleanup still runs if another field is invalid. An async capture
  rejects immediately; its eventual rejection is observed, and any late returned
  snapshot is disposed once with cleanup errors sent to the diagnostic sink.
- [x] Implement bounded cleanup/diagnostic ownership using the private ticket
  flags specified earlier. Before raising a secondary diagnostic, unregister
  session cleanup and check the session-claimed flag. Preserve `CANCELLED` or
  `SERIALIZATION_FAILED` over cleanup errors. Successful encoding + failed cleanup
  rejects `CLEANUP_FAILED` and produces no trusted receipt.

```text
session-owned capture failure:
  session dispose rejects its cleanup error (core aggregates)
  serialization rejects its cancellation primary
  serialization wrapper emits no duplicate secondary diagnostic

serializer-owned failure:
  unregister before reporting
  if primary failed: report one secondary cleanup error; reject primary
  if primary succeeded: reject cleanup error directly
```

- [x] Verify these independent cleanup scenarios:

| Scenario | Required outcome |
| --- | --- |
| Successful encoding/cleanup | one cleanup, usable result, no diagnostic |
| Encoder fails + cleanup fails | original serialization error returned, one secondary diagnostic |
| Encoder succeeds + cleanup fails | CLEANUP_FAILED returned, no receipt |
| Session closes + known cleanup fails | explicit disposal rejects, encode returns CANCELLED, no duplicate sink report |
| Another later-registered LIFO cleanup is blocked | session claim is already effective; the capture wrapper cannot report a second owner |
| Capture getter disposes session before returning its snapshot | late local cleanup runs; no encoding, ready resurrection, or session-scope duplicate report |
| Cleanup callback initiates disposal reentrantly without awaiting its owner | cached session promise, no wait on the unresolved encoder |
| Completed capture followed by later session disposal | no retained registration, cleanup still once |

- [x] Re-run phase 1 cleanup tests and Task 4 writer races. Run strict types and
  proceed to Task 8's capture/receipt milestone. Keep cleanup ownership and
  acknowledgements together rather than committing a half-owned resource boundary.

  Cleanup may initiate owner closure with a non-awaited call. It must not return
  or await an owner disposal promise that includes that same cleanup: this is a
  self-dependency, not a cancellation race core can safely resolve. Document this
  authoring rule and keep the reentry test distinct from an impossible self-wait.

## Task 8: Same-session persistence receipts and write ordering

**Files:** Add `markPersisted` to `src/sessions/types.ts` and handle composition;
complete receipt registry in `src/serialization/create-serialization.ts` and
acknowledgement in the editing controller; create `tests/persistence.test.ts`.

- [x] Write a storage-order test with a real in-memory host destination:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource, type SerializationResult } from "../src/index.ts";
import { deferred } from "./support/fixtures.ts";
import { editor, editingState, textPlugin } from "./support/editing-fixture.ts";

test("an older write finishing last makes the newer document dirty again", async () => {
  const core = createOmniview({ plugins: [textPlugin()] });
  const session = await core.open(createSource(new Blob(["a"])), { readOnly:false });
  await editor(session).replace("first"); const first = await session.serialize();
  await editor(session).replace("second"); const second = await session.serialize();
  const oldGate = deferred<void>(); const newGate = deferred<void>();
  let stored = "a";
  async function persist(result: SerializationResult, gate: Promise<void>): Promise<void> {
    const bytes = await result.source.read();
    await gate;
    stored = new TextDecoder().decode(bytes);
    session.markPersisted(result);
  }
  const oldWrite = persist(first, oldGate.promise);
  const newWrite = persist(second, newGate.promise);
  newGate.resolve(); await newWrite;
  expect(stored).toBe("second");
  expect(editingState(session)).toMatchObject({ persistedRevision:"2", dirty:false });
  oldGate.resolve(); await oldWrite;
  expect(stored).toBe("first");
  expect(editor(session).read()).toBe("second");
  expect(editingState(session)).toMatchObject({ revision:"2", persistedRevision:"1", dirty:true });
  await core.dispose();
});
```

- [x] Run `bun test tests/persistence.test.ts`; expect missing acknowledgement
  or incorrect Math.max/dirty behavior.
- [x] Store issued exact result identities in a private
  `WeakMap<SerializationResult, Revision>`. Check live/support/apply-capture guards
  before ownership lookup. Do not trust a caller-provided `.revision` or a
  structural cast; use the registry's canonical revision. Never create a receipt
  before successful encoding, cleanup, and closure checks.

```ts
// After availability and ownership validation in markPersisted.
// revision comes from the private WeakMap, never a caller-supplied number.
state.persistedRevision = revision;
// Publication uses the cached editing object and dirty equality calculation.
// Do not replace with a maximum-revision calculation.
```

- [x] Test exact receipt acceptance and each rejection separately: another
  session/core's receipt, a spread copy, JSON copy, fabricated object, null and
  primitive JavaScript input. Rejections are `INVALID_PERSISTENCE`, leave all
  state unchanged, and do not invoke any model or storage callback.
- [x] Test serialization alone remains dirty; failed/rejected host writes leave
  persisted state unchanged; ack A after edit B keeps B dirty; read-only can ack;
  same revision ack is a no-op; an exact receipt can be reused after its bytes
  are written again; before-ready/unsupported/disposed precedence is preserved.
- [x] Add guard/reentry tests: ack during applying/capture is EDIT_BUSY, during
  a committed revision notification it is allowed. Ack observer may dispose;
  no later ready snapshot can restore the session. It must not change revision,
  current model, original source metadata, busy writer, or encoding ticket.
- [x] Run focused persistence, editing and serialization tests, strict types,
  then `bun run check`; commit
  `feat(serialization): own captures and persistence receipts` for Tasks 6-8,
  explaining cancellation, cleanup ownership and authoritative-write ordering.

## Task 9: Strict public integration and real packed consumers

**Files:** Extend `tests/editing.types.ts`, `tests/contracts.types.ts`,
`tests/package-consumer/consumer.ts`; create `tests/editing-integration.test.ts`.
Existing build/verification scripts and manifest exports remain authoritative.

- [x] Add strict type assertions for the actual integrated methods:

```ts
import type { DocumentSession, SerializationResult } from "../src/index.ts";
import type { PluginContext } from "../src/sdk/index.ts";

export function checkManagedEditing(
  session: DocumentSession, plugin: PluginContext, result: SerializationResult,
): void {
  const operation: Promise<string> = plugin.edit(async ({ commit }) => {
    await Promise.resolve();
    return commit(() => ({ changed:true, value:"result" }));
  });
  const encoded: Promise<SerializationResult> = session.serialize();
  session.setReadOnly(true);
  session.markPersisted(result);
  // @ts-expect-error Acknowledgements require issued results, not revision strings.
  session.markPersisted("1");
  // @ts-expect-error Policy values are boolean.
  session.setReadOnly("false");
  void [operation, encoded];
}
```

- [x] Add this independent packed-consumer block after the existing phase 1
  consumer checks, reusing its `assert` helper. Do not import source paths or test
  fixtures; the existing verifier copies this file into a fresh extracted package:

```ts
const editableText = defineCapability<{
  read(): string;
  replace(value: string): Promise<void>;
}>("consumer:editable-text");
const editablePlugin = definePlugin({
  id: "consumer/editable-text", apiVersion: 1, supports: () => true,
  async open({ source, signal, edit }) {
    let text = new TextDecoder().decode(await source.read({ signal }));
    return {
      capabilities: [provideCapability(editableText, {
        read: () => text,
        replace: (next) => edit(async ({ commit }) => {
          await Promise.resolve();
          commit(() => {
            const changed = next !== text; text = next;
            return { changed, value:undefined };
          });
        }),
      })],
      editing: { capture() {
        const captured = text;
        return { serialize: () => ({ data:new TextEncoder().encode(captured) }) };
      } },
    };
  },
});
const editingCore = createOmniview({ plugins:[editablePlugin] });
try {
  const managed = await editingCore.open(createSource(new Blob(["before"])), { readOnly:false });
  const api = managed.getCapability(editableText);
  assert(api, "Editable capability must retain its public type");
  await api.replace("after");
  const output = await managed.serialize();
  const revision: string = output.revision;
  assert(revision === "1", "Async edit must advance the revision");
  assert(new TextDecoder().decode(await output.source.read()) === "after", "Output bytes must match the capture");
  const dirty = managed.getSnapshot();
  assert(dirty.status === "ready" && dirty.editing.supported && dirty.editing.dirty,
    "Encoding alone must not mark persisted");
  managed.markPersisted(output);
  const clean = managed.getSnapshot();
  assert(clean.status === "ready" && clean.editing.supported && !clean.editing.dirty,
    "Host acknowledgement must mark this revision clean");
  managed.setReadOnly(true);
  try {
    await api.replace("denied");
    throw new Error("Expected read-only denial");
  } catch (error) {
    assert(error instanceof OmniviewError && error.code === "READ_ONLY",
      "Retained capability must use core policy and shared error identity");
  }
} finally { await editingCore.dispose(); }
```

- [x] Before implementation of a missing contract, the corresponding public test
  must fail meaningfully. At this late integration stage earlier slices should
  already make these assertions pass; retain them as independent compatibility
  evidence rather than changing working code to manufacture a failure.
- [x] Add an integration test opening two documents with the same text plugin
  and a second core. Change/revoke/dispose one while another edits and encodes.
  Assert model, revision, policy, busy state, receipts, cancellation signals and
  core membership remain independent. An exact result from one document never
  acknowledges another even when both expose revision `"1"`.
- [x] Check every error from async work, callback/getter/iterator, output
  normalization and cleanup has the correct category, context and original
  cause. Confirm source metadata does not change on output rename or persistence.
  Exercise all new methods before ready and after disposal using retained handles.
- [x] Run `bun run check`,
  `bun node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`,
  `bun run test:package`, `bun pm pack --dry-run`, and `bun run jsr:check`.
  Expected: all exit 0; packed DOM and Node-only consumers execute in Node,
  source line/function coverage remains 100%, root/SDK share the error class.
  No new manifest export or dependency should be necessary.
- [x] Commit `test(editing): verify portable public integration` with actual
  runtime/type/package evidence in its detailed body.

## Task 10: Authoring guidance, migration, review, and acceptance

**Files:** Update `README.md`, `AGENTS.md`, `docs/plugin-authoring.md`,
`docs/migration-managed-sessions.md`,
`docs/superpowers/specs/2026-10-19-core-runtime-proposal.md`,
`docs/superpowers/specs/2026-10-20-editing-protocol-design.md`,
`GLOSSARY.md` only if domain terminology genuinely changes. Update this plan's
progress/evidence while executing; do not mark unimplemented steps complete.

- [x] Document plain JS and TS plugins using public root/SDK imports, retaining
  a viewer-only example. Include async preparation with several accepted changes,
  partial failure/cancellation, no automatic rollback, stale-context denial,
  per-session read-only defaults/overrides, and capability lifetime rules.
- [x] Include an autosave building block that captures from a revision observer
  and delegates scheduling/storage to the host, without implementing an autosave
  service in core. Show successful-write acknowledgement in a try/finally lifecycle:

```ts
// Inside a host that already has session and its own persistBytes function.
const output = await session.serialize({ signal });
await persistBytes(await output.source.read());
session.markPersisted(output);
```

  Explain that `persistBytes` and signal creation belong to the host, metadata
  revisions are opaque strings, and a serialized/cloned receipt is not trusted.
  A failed write must skip acknowledgement; the host must sequence conflicting
  writes or acknowledge authoritative commit order. Read-only can still export.
- [x] Document immutable capture expectations, once-only cleanup, output lifetime,
  rejected async captures, unsafe async atomic callbacks, and the cleanup
  self-dependency rule. Distinguish initialization/caches/view state from edits.
  Operation/serialization failures remain ready and do not replace load failures.
- [x] Update AGENTS/current architecture only after the API exists. Keep optional
  UI, format plugins, public test kit, undo/redo, collaboration and registry
  publication outside this phase. Explain source metadata staying original and
  the optional apiVersion 1 extension; actual package release versioning remains
  a separate decision based on publication history.
- [x] Execute guide JS/TS examples through public source counterparts and compile
  them using strict types. Public examples may not import internal controllers,
  test fixtures, or a nonexistent `/testing` subpath. These runtime examples are
  verified only after implementation, not as evidence while writing this plan.
- [x] Perform the following final acceptance commands and inspect every exit:

```sh
bun install --frozen-lockfile
bun run check
bun node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
bun run test:package
bun pm pack --dry-run
bun run jsr:check
git diff --check
```

  All exit 0. Check all new production files are included by the existing source
  preload and appear in coverage. Re-prove the gate with one temporary uncalled
  source function: coverage must exit nonzero; remove it and rerun the clean
  suite. Do not change exclusions/thresholds, commit the probe, or claim branch
  coverage. Do not publish any registry package.
- [x] Request independent review against the approved design and this plan under
  the repository's review skill at implementation time. Provide a precise change
  range and the cancellation/cleanup/persistence invariants, not chat history.
  Convert concrete findings into public red/green regressions; re-review fixes.
- [x] Commit `docs(editing): document editing and persistence lifecycle` with
  validation results. Integrate the verified feature into `master` and push only
  under the user's existing instructions. Verify clean status, equal local and
  remote master identities, and keep registry publication separate.

## Spec-to-task traceability

| Design requirement | Implementation tasks |
| --- | --- |
| Portable shared declarations, public generic authoring | 1, 3, 9 |
| Optional support, definition validation, policy precedence | 2 |
| Stable frozen snapshots, no redundant transitions | 2, 3, 5 |
| Async work with multiple synchronous accepted changes | 3 |
| Single writer per session, no implicit queue | 3, 4, 9 |
| Failed/invalid changes, conservative dirty state | 3, 5 |
| Caller abort, read-only revocation, retained contexts | 4 |
| Reentrant observers and lifecycle precedence | 4, 5, 6, 8 |
| String revisions, private unbounded counter, JSON-safe metadata | 1, 3, 5 |
| Immutable captures, concurrent encoding, independent output | 6 |
| Capture consistency guard and synchronous validation | 6, 7 |
| Late/invalid captures, cancelled encoders, cleanup ownership | 7 |
| Owned exact receipts, failed writes and out-of-order storage | 8 |
| Two documents/two cores, terminal handles | 4, 7, 9 |
| npm/JSR parity, actual archive and independent runtimes | 9, 10 |
| Current docs, migration, authoring constraints and final review | 10 |

## Plan self-review and handoff

Before committing this plan, verify each design invariant and acceptance row
maps to the tasks above. Check names/signatures against the approved design,
fixture generics against public declarations, field ownership across the two
controllers, and the distinction between lifecycle closure and observable state.
Remove unresolved placeholders rather than inventing production test hooks.

The implementation is ready to run task by task. Prefer a single implementer for
the coupled state/operation/serialization slices; independent review and the
packed-consumer/documentation work can use fresh subagents when authorized by
the execution workflow. This planning turn does not execute those tasks.

Planning verification (2026-10-20): the ten tasks map to every approved design
area above. Seven complete runtime-test examples, two type-test examples, the
shared fixture, and the packed-consumer example were checked by strict TypeScript
against declarations extracted from the design in an ignored scratch workspace.
This checks example/type consistency, not future runtime behavior; those future
tests were not executed. Local documentation links resolve, unresolved-marker
and whitespace checks pass. The unchanged phase 1 runtime still passes
`bun run check`: 98 tests, 100% line/function coverage, lint, strict types and build.

## Implementation acceptance (2026-10-20)

All ten tasks are implemented and reviewed. Shared contracts are committed in
`b1023db`. Tasks 2-8 were verified at the policy, writer and capture milestones,
then consolidated in `7ec0bc5` so the session composition and resource ownership
ship together. This replaces the suggested separate policy/writer/capture commit
boundaries above. Public integration is committed in `57be5d3`.

Independent writer and capture reviews exercised cancellation, stale contexts,
reentrant getters, first-outcome settlement, late captures, blocked LIFO cleanup
and exact receipts. Concrete findings received public failing regressions and
fixes; follow-up review found no remaining must-fix issue. No new dependency,
package subpath, renderer, plugin repository, registry publication or version
change was introduced. Domain terminology remains unchanged.

Acceptance evidence:

- Frozen install: 12 installs checked across 39 packages, no lockfile changes.
- `bun run check`: 196 tests pass, 549 assertions, 100% source line/function
  coverage, lint, strict build types and ESM/declaration build pass.
- Full development `tsc -p tsconfig.json --noEmit`: passes.
- Actual extracted npm archive: strict DOM and Node-only consumers typecheck
  and run in Node, including editable plugin and persistence flow.
- npm pack dry run and JSR publish dry run: pass; nothing published.
- Eight extracted TS guide modules compile strictly; public JS/TS examples
  execute, including partial edit failure and immutable observer captures.
- Coverage gate rejects a temporary uncalled source function with exit 1; the
  probe was removed and the clean full check rerun successfully. Thresholds
  and exclusions are unchanged. Branch coverage is not claimed.
- `git diff --check`: passes. Documentation records storage ordering and the
  cleanup self-dependency rule.

Integration target is the authorized `master` branch with a normal fast-forward
and push; local/remote identities are checked after integration.
