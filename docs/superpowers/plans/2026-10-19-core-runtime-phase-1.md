# Core runtime phase 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task by task. Use subagent-driven-development only
> when delegation is authorized. Steps use checkbox syntax for tracking.

**Goal:** Deliver a portable headless runtime with readable sources, a useful
plugin-author SDK, isolated managed sessions, observable lifecycle, cancellation,
and reliable resource cleanup.

**Architecture:** One core owns an immutable ordered plugin registry and multiple
independent document sessions. A session owns one source and one plugin result.
The package exposes application APIs through the root and authoring tools through
`/sdk`; neither entry point imports a renderer, framework, CSS, or test runner.

**Tech stack:** Bun 1.4.3, TypeScript 7.0.2, Biome 2.5.15, standard Web APIs.
No new dependencies.

---

## Scope and sequencing

This is the detailed plan for stages 1 and 2 of
[the architecture proposal](../specs/2026-10-19-core-runtime-proposal.md).
The outcome is a working lifecycle runtime and the minimal SDK needed to author
plugins against it. It does not implement editing, default UI, format parsers,
framework adapters, a universal document model, or a public test-kit package.

Typed capability keys are included so a plugin can expose a read-only document
API without private imports. Built-in editing/serialization/revision protocols
and the portable `@omniview/core/testing` entry point get follow-up plans. Do not
publish a nonfunctional `/testing` export or empty modules for those features.

Execute one public behavior at a time: write the indicated test, observe the
expected failure, implement only that behavior, then run the focused test.
The scenario tables expand each task into consecutive red/green cycles; do not
write every scenario before implementing the first. Run coverage and full checks
at a completed milestone, without weakening the existing 100% threshold.
If a later scenario already passes because an earlier slice established that
behavior, retain it as an integration/regression check and move to the next
missing behavior. Do not damage working code to manufacture a red result or
implement the same feature twice.

The previous foundation API is experimental. Replace its unmanaged result and
view/edit union with the managed API below; record migration explicitly. This
phase does not silently redefine the old `save()` method. Determine release
versioning against actual published history when preparing a release.

## Agreed public test boundaries

| Boundary | Catches | Does not claim to validate |
| --- | --- | --- |
| Root source helpers | Metadata, byte ranges, byte ownership, cancellation | HTTP credentials, filesystem access, format decoding |
| Root core/session API | Selection, independent lifetimes, state, abort, cleanup | Renderer layout or application persistence |
| SDK API | Authoring inference, typed capabilities, plugin context | Correctness of a third-party parser |
| Packed npm package / JSR source graph | Export parity, declarations, portable imports | Authenticated publication or actual GitHub execution |

Tests import `src/index.ts` or `src/sdk/index.ts`, the source counterparts of
public package entry points. Do not test private registries, stores, cancellation
helpers, or cleanup collections by importing their files. Exercise them through
these boundaries. Packed-consumer tests import package names, never source paths.

## Public contract to implement

The following declarations are the target contract. Split them into the files
listed in the ownership map; they are shown together here to make references and
dependencies explicit. Public exports require JSDoc and explicit return types.

```ts
// src/errors.ts
export type ErrorCode =
  | "INVALID_SOURCE" | "INVALID_RANGE" | "INVALID_PLUGIN"
  | "DUPLICATE_PLUGIN" | "PLUGIN_NOT_FOUND" | "UNSUPPORTED_SOURCE"
  | "PLUGIN_FAILED" | "INVALID_CAPABILITY" | "CAPABILITY_CONFLICT"
  | "SESSION_NOT_READY" | "SESSION_CLOSED" | "CORE_CLOSED"
  | "CANCELLED" | "CLEANUP_FAILED" | "OBSERVER_FAILED";

export interface ErrorContext {
  readonly sourceName?: string;
  readonly pluginId?: string;
  readonly sessionId?: string;
}

export interface OmniviewErrorOptions extends ErrorOptions {
  readonly context?: ErrorContext;
}

export class OmniviewError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;
  constructor(code: ErrorCode, message: string,
    options: OmniviewErrorOptions = {}) {
    super(message, options);
    this.name = "OmniviewError";
    this.code = code;
    this.context = Object.freeze({ ...options.context });
  }
}

// src/sources/types.ts
export interface SourceMetadata {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface ReadOptions {
  readonly start?: number;
  readonly end?: number;
  readonly signal?: AbortSignal;
}

export interface ReadableSource extends SourceMetadata {
  read(options?: ReadOptions): Promise<Uint8Array>;
}

export interface SourceOptions {
  readonly name?: string;
  readonly mimeType?: string;
}

// Declaration of the source factory implemented in sources/blob-source.ts.
export declare function createSource(
  input: Blob | Uint8Array, options?: SourceOptions,
): ReadableSource;

// src/capabilities/types.ts
declare const capabilityType: unique symbol;
export interface CapabilityKey<T extends object> {
  readonly id: `${string}:${string}`;
  readonly [capabilityType]?: T;
}

export interface CapabilityEntry {
  readonly key: CapabilityKey<object>;
  readonly value: object;
}

// src/plugins/types.ts
export type MaybePromise<T> = T | PromiseLike<T>;
export type Cleanup = () => MaybePromise<void>;

export interface ProbeContext {
  readonly source: ReadableSource;
  readonly signal: AbortSignal;
}

export interface PluginContext extends ProbeContext {
  readonly sessionId: string;
  onDispose(cleanup: Cleanup): () => void;
}

export interface PluginDocument {
  readonly capabilities?: readonly CapabilityEntry[];
  readonly dispose?: Cleanup;
}

export interface PluginDefinition {
  readonly id: string;
  readonly apiVersion: 1;
  supports(context: ProbeContext): MaybePromise<boolean>;
  open(context: PluginContext): MaybePromise<PluginDocument>;
}

// src/sessions/types.ts
export interface SessionIdentity {
  readonly id: string;
  readonly source: SourceMetadata;
}

export type SessionSnapshot = SessionIdentity & (
  | { readonly status: "created" | "loading" }
  | { readonly status: "ready"; readonly pluginId: string }
  | { readonly status: "error" | "cancelled";
      readonly error: OmniviewError }
  | { readonly status: "disposed" }
);

export interface LoadOptions {
  readonly signal?: AbortSignal;
}

export interface SessionOptions {
  readonly pluginId?: string;
}

export interface DocumentSession {
  readonly id: string;
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  load(options?: LoadOptions): Promise<void>;
  getCapability<T extends object>(key: CapabilityKey<T>): T | undefined;
  dispose(): Promise<void>;
}

// src/core/types.ts
export interface CoreOptions {
  readonly plugins: readonly PluginDefinition[];
  readonly onError?: (error: OmniviewError) => void;
}

export interface OpenOptions extends SessionOptions, LoadOptions {}

export interface Omniview {
  createSession(source: ReadableSource,
    options?: SessionOptions): DocumentSession;
  open(source: ReadableSource, options?: OpenOptions): Promise<DocumentSession>;
  getSessions(): readonly DocumentSession[];
  dispose(): Promise<void>;
}

// Declaration of the factory implemented in core/create-core.ts.
export declare function createOmniview(options: CoreOptions): Omniview;
```

Add explicit `import type` declarations between the actual files. `ErrorOptions`
and `AbortSignal` are standard platform types; do not import Bun/Node types.
Keep absent exact-optional fields absent instead of constructing `{ signal:
undefined }` or `{ pluginId: undefined }` under exactOptionalPropertyTypes.

### SDK helpers

Implement these in `plugins/define-plugin.ts` and `capabilities/define-capability.ts`:

```ts
export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition;
}

export function defineCapability<T extends object>(
  id: `${string}:${string}`,
): CapabilityKey<T> {
  if (!/^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/.test(id)) {
    throw new OmniviewError("INVALID_CAPABILITY", "Invalid capability id");
  }
  return Object.freeze({ id });
}

export function provideCapability<T extends object>(
  key: CapabilityKey<T>, value: NoInfer<T>,
): CapabilityEntry {
  return Object.freeze({ key, value });
}
```

`definePlugin` preserves contextual typing and author-added metadata. Runtime
registration validation belongs in the registry, not duplicated in the helper.
`NoInfer` makes the capability key determine the required value type. Use a
single documented cast at the capability lookup boundary to recover `T` from
the validated internal map; do not spread assertions or `any` through the API.

Plugin-specific options use a typed author factory closure in this phase. A
generic configuration container or dependency-injection framework is unnecessary:

```ts
interface TextOptions { readonly encoding: string }

export function textPlugin(options: TextOptions): PluginDefinition {
  return definePlugin({
    id: "example/text",
    apiVersion: 1,
    supports: ({ source }) => source.mimeType.split(";")[0] === "text/plain",
    async open({ source, signal }) {
      const bytes = await source.read({ signal });
      const content = new TextDecoder(options.encoding).decode(bytes);
      return {
        capabilities: [provideCapability(textContent, {
          getText: () => content,
        })],
      };
    },
  });
}

export const textContent: CapabilityKey<{ getText(): string }> =
  defineCapability<{ getText(): string }>("example.text:content");
```

This is an integration example for tests/docs, not a format plugin to publish
from the core repository. Real plugins remain in their own repositories.

## Module ownership and dependency direction

| File | Responsibility |
| --- | --- |
| `src/errors.ts` | Error codes, contextual errors and causes |
| `src/sources/types.ts` | Public source/read contracts |
| `src/sources/blob-source.ts` | `createSource(Blob \| Uint8Array, options)` |
| `src/capabilities/types.ts` | Typed keys and provided entries |
| `src/capabilities/define-capability.ts` | SDK key/entry helpers |
| `src/plugins/types.ts` | Plugin, probe, context and result protocols |
| `src/plugins/define-plugin.ts` | Inference-preserving SDK definition helper |
| `src/plugins/registry.ts` | Immutable ordered registration snapshot |
| `src/plugins/resolve-plugin.ts` | Explicit selection and ordered async probes |
| `src/lifecycle/cancellation.ts` | Abort race and late-result observation |
| `src/lifecycle/resources.ts` | Cleanup registration, LIFO disposal, late cleanup |
| `src/lifecycle/reporting.ts` | Safe reporting of non-returnable failures |
| `src/sessions/types.ts` | Public session handle and snapshots |
| `src/sessions/state.ts` | Stable frozen snapshots and subscriptions |
| `src/sessions/create-session.ts` | Load, capabilities, terminal state and ownership |
| `src/core/types.ts` | Core options and public interface |
| `src/core/create-core.ts` | Composition, session collection and core disposal |
| `src/sdk/index.ts` | Plugin-author public exports |
| `src/index.ts` | Host-facing public exports |
| `scripts/build.ts` | Clean multi-entry browser ESM build |
| `scripts/verify-package.ts` | Verify actual packed consumer without source imports |

The lifecycle primitives depend only on public contracts/errors. Sources and
plugins may use them without depending on session orchestration. Sessions
compose sources, the registry, capabilities, state, and lifecycle primitives.
The core composes sessions; lower layers must not import core or public barrels.
This deliberately moves shared cancellation/resources out of `sessions/` from
the earlier proposal to prevent a registry-to-session dependency cycle.

## Runtime rules fixed before implementation

### Source ownership

`createSource(input: Blob | Uint8Array, options?: SourceOptions): ReadableSource`
uses an explicit name first, a File's name when present, otherwise `document`.
Reject empty/whitespace-only names. Use Blob's MIME type unless overridden;
byte input defaults to `application/octet-stream`. A byte input is copied at
construction. Every read returns an independently owned byte array.

Ranges use inclusive `start` and exclusive `end`, defaulting to `[0, size)`.
Both must be safe integers with `0 <= start <= end <= size`; reject invalid
ranges with INVALID_RANGE instead of relying on Blob's silent clamping.
Empty ranges are valid. Abort before or during a read yields CANCELLED with
the original abort reason as cause. Custom readers follow the same contract.

Custom sources remain host-owned and can be shared across sessions. The core
does not implicitly dispose a source, fetch a URL, or read a filesystem path.
The session snapshots a frozen metadata object rather than exposing a mutable
host metadata object as observable state.

### Registration and selection

Validate nonempty IDs, duplicate IDs, apiVersion exactly 1, and callable
supports/open at core construction. Copy the registration list; later caller
array changes do not change the core. Definitions/configuration are read-only
after registration. Preserve callback method context.

An explicit pluginId bypasses probing; missing IDs yield PLUGIN_NOT_FOUND.
Otherwise await supports callbacks sequentially in registration order and use
the first true result. All false yields UNSUPPORTED_SOURCE. A thrown/rejected
probe or open yields PLUGIN_FAILED, with original cause plus pluginId,
sourceName, and sessionId. Do not try another plugin after that failure.
Reject a nonboolean probe result or a malformed open result as PLUGIN_FAILED
with an explanatory cause. Probes do not retain resources: temporary probe
resources use try/finally, and session-owned allocations belong in open().

### Session lifecycle

| Current state | Operation/result | Outcome |
| --- | --- | --- |
| created | first load | loading, one cached load promise |
| loading | another load | return that same promise; do not start another probe/open |
| ready | another load | return the settled successful load promise |
| error/cancelled | another load | return the original rejected load promise; retry uses a new session |
| loading | successful result | register its cleanup, validate capabilities, then ready |
| loading | ordinary failure | error; clean known resources; reject primary error |
| loading | caller abort | cancelled; clean known resources; reject CANCELLED |
| any live state | dispose | disposed immediately; abort work; clean resources |
| disposed | load | reject SESSION_CLOSED |
| disposed | dispose | return the same disposal promise |

Source identity is fixed for a session. Session IDs are unique within one core
instance and remain stable; UI DOM IDs use their separate viewer-instance
namespace. Do not introduce a global active document or shared plugin model.

Assign the cached load promise before synchronously publishing loading so a
reentrant subscriber cannot trigger a second open. Schedule work after that
assignment. Link only the first load caller's external signal and remove the
listener when loading settles. Later abort of that external signal must not
destroy an already-ready session. The plugin's context signal remains alive
until the session fails, is cancelled, or is disposed.

Cancellation must reject without waiting for an ignored plugin open promise.
Always attach handlers to that underlying promise: dispose a late successful
result and observe late rejection to avoid unhandled rejections. If disposal
and completion race, terminal state wins and the result is cleaned exactly once.
Never wait for the unresolved plugin open as part of session.dispose().

### State and observer isolation

getSnapshot returns the same reference until a transition. Snapshot and source
metadata are frozen. subscribe does not emit immediately; consumers read the
current snapshot. Each subscription has its own idempotent unsubscribe, even
if the same listener function is registered twice.

Notify synchronously in registration order. A listener removed before its turn
is skipped. If a callback causes another transition, do not continue sending
the superseded notification pass. Notify disposed once, then remove all
subscriptions; subscribing afterwards returns an inert unsubscribe function.

Listener failures become OBSERVER_FAILED and go to CoreOptions.onError without
changing document state or stopping other listeners. Without a handler, report
through console.error. If the handler itself throws, report that failure through
console.error and continue; never recurse into the failing handler.

### Capabilities and cleanup

Validate capability IDs, object values, and uniqueness before publishing ready.
Duplicate IDs yield CAPABILITY_CONFLICT. Lookup by the canonical key ID returns
the provided typed value or undefined. Before ready, lookup throws
SESSION_NOT_READY; after disposal it throws SESSION_CLOSED. Returned plugin
capabilities are valid only while their session is live; plugin implementations
use their context signal and resource scope to enforce that lifetime.

onDispose registers a cleanup and returns an idempotent unregister function.
Distinct registrations of the same function remain independent. Run registered
cleanup callbacks in reverse registration order, attempting all even if some
fail. Register the plugin result's dispose callback once, preserving its context.
Use either result disposal or onDispose for a particular resource, not both.

Known cleanup is awaited by explicit dispose(). Aggregate failures in one
CLEANUP_FAILED error. After the scope is closed, a new registration executes
asynchronously immediately and reports failures through onError; do not leak
the resource or reopen the scope. Late plugin results use this path.

A load failure retains its primary error even when cleanup also fails; report
the secondary cleanup error once. Explicit disposal rejects its cleanup error
to its caller. Detached/late cleanup reports through onError because an earlier
dispose promise may already be settled. Do not silently swallow cleanup errors
or report the same known cleanup failure twice through convenience wrappers.

### Core ownership

createSession validates the supplied reader/metadata, tracks the created
session, and does not start loading. getSessions returns a frozen collection
snapshot with stable identity until collection membership changes. Remove a
session as soon as it becomes disposed, even if cleanup is still pending.
The removal happens before disposed subscribers run, so a subscriber reading
core.getSessions() cannot see the terminal session as still owned.

open is createSession + await load; on failure it disposes/removes its temporary
session while preserving the primary error. Disposing the core marks it closed
before running session cleanup, attempts every session using allSettled, and
aggregates cleanup failures. Repeat disposal returns the same promise.
createSession after closure throws CORE_CLOSED; open after closure rejects it.

## Test fixtures used by the following tasks

Create `tests/support/fixtures.ts` when the SDK contract is introduced:

```ts
import { definePlugin, type PluginDefinition } from "../../src/sdk/index.ts";

export function fixturePlugin(
  overrides: Partial<PluginDefinition> = {},
): PluginDefinition {
  return definePlugin({
    id: "fixture/text",
    apiVersion: 1,
    supports: () => true,
    open: () => ({}),
    ...overrides,
  });
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
```

Use controlled promises for asynchronous races, never sleeps or guessed delays.
Use real Blob/Uint8Array inputs. Test plugins implement the real public plugin
contract; they do not mock private collaborators.

## Task 1: Structured errors and readable sources

**Files:** Create `src/errors.ts`, `src/sources/types.ts`,
`src/sources/blob-source.ts`, `src/lifecycle/cancellation.ts`, and
`tests/sources.test.ts`. Extend `src/index.ts` with source/error exports while
retaining the foundation exports until Task 3 migrates them.

- [x] **Red:** Add and run the first source test:

```ts
import { expect, test } from "bun:test";
import { createSource } from "../src/index.ts";

test("reads a named source using exclusive-end byte ranges", async () => {
  const source = createSource(new Blob(["hello"], { type: "text/plain" }), {
    name: "notes.txt",
  });
  expect(source.name).toBe("notes.txt");
  expect(source.size).toBe(5);
  expect([...await source.read({ start: 1, end: 4 })]).toEqual([101, 108, 108]);
});
```

Run `bun test tests/sources.test.ts`; expect failure because createSource does
not exist, then scaffold its exported signature and observe the behavior fail.

- [x] **Green:** Implement the declared source API: validate input/name, capture
  an immutable Blob or copied bytes, snapshot metadata, and implement read with
  explicit integer/range validation and copied output. Use the shared abort race
  for asynchronous reads; no fetch/Node/Bun imports in source modules.
- [x] **Expand one red/green cycle per row:**

| Case | Independent expected result |
| --- | --- |
| `[2,4,6]` input, mutate original to `[9,4,6]` | source still reads `[2,4,6]` |
| mutate a returned array | next read retains original bytes |
| File named `a.txt`, then explicit name `b.txt` | inferred name a.txt; override b.txt |
| empty file and start=end | empty arrays |
| negative, fractional, reversed, or oversized range | INVALID_RANGE |
| blank name / invalid runtime input | INVALID_SOURCE |
| already-aborted read with a supplied reason | CANCELLED with same cause |

- [x] Add an error assertion proving `.code`, `.context`, and `.cause` preserve
  independently supplied values. Test source MIME values as metadata, not a
  fixed assumption that Blob never appends a charset parameter.
- [x] Run focused tests and `bun run typecheck`.
- [x] Commit `feat(sources): add portable readable sources` with the source
  ownership/range/abort decisions and validation in the body.

## Task 2: Plugin-author SDK and typed capability keys

**Files:** Create `src/plugins/types.ts`, `src/plugins/define-plugin.ts`,
`src/capabilities/types.ts`, `src/capabilities/define-capability.ts`,
`src/sdk/index.ts`, `tests/support/fixtures.ts`, `tests/sdk.types.ts`, and
`tests/sdk.test.ts`.

- [x] **Red:** Write compile-time examples through the SDK source entry point:

```ts
import { defineCapability, definePlugin, provideCapability }
  from "../src/sdk/index.ts";

const text = defineCapability<{ getText(): string }>("example.text:content");
provideCapability(text, { getText: () => "hello" });
// @ts-expect-error The key fixes the capability value type.
provideCapability(text, { getText: () => 123 });
// @ts-expect-error Capability identifiers require a namespace.
defineCapability<{ getText(): string }>("content");

export const plugin = definePlugin({
  id: "example/text", apiVersion: 1, authorLabel: "example",
  supports: ({ source }) => source.name.endsWith(".txt"),
  open: ({ signal, onDispose }) => {
    onDispose(() => { void signal.aborted; });
    return { capabilities: [provideCapability(text, {
      getText: () => "hello",
    })] };
  },
});
```

- [x] Run `bun run typecheck`; expect missing SDK exports before implementation.
- [x] Implement the exact contracts/helpers above, complete cross-file imports,
  and explicit SDK re-exports. Export the error class/type, source contracts,
  plugin context/definition/result, capabilities, and helper functions.
- [x] Runtime test invalid key names such as `example:` and `:content` yield
  INVALID_CAPABILITY; valid key/helper behavior is exercised through the plugin
  integration in Task 4, not identity-only tests.
- [x] Add a negative type assertion for apiVersion other than 1. Keep the
  namespace and value mismatch assertions active under strict checking.
- [x] Run SDK tests and type checks; commit
  `feat(sdk): add plugin and capability contracts` with a detailed body.

## Task 3: Managed core/session shell and foundation migration

**Files:** Create `src/core/types.ts`, `src/core/create-core.ts`,
`src/sessions/types.ts`, `src/sessions/create-session.ts`,
`src/plugins/registry.ts`, `src/plugins/resolve-plugin.ts`.
Replace root exports; remove legacy `src/omniview.ts` and `src/types.ts` only
after moving/replacing their verified behaviors. Rewrite
`tests/omniview.test.ts` and `tests/contracts.types.ts` for the managed contract.

- [x] **Red:** Establish the public lifecycle with a complete integration test:

```ts
import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import { fixturePlugin } from "./support/fixtures.ts";

test("creates an observable session before loading its document", async () => {
  const core = createOmniview({ plugins: [fixturePlugin()] });
  const session = core.createSession(createSource(new Blob(["a"])));
  expect(session.getSnapshot().status).toBe("created");
  expect(core.getSessions()).toEqual([session]);
  await session.load();
  expect(session.getSnapshot()).toMatchObject({
    status: "ready", pluginId: "fixture/text",
  });
  await core.dispose();
  expect(session.getSnapshot().status).toBe("disposed");
});
```

- [x] Implement the minimal passing core/session path against the target
  interfaces: tracked creation, asynchronous load, selected plugin result,
  frozen metadata/snapshot, and terminal disposal. Introduce the state and
  cleanup modules only as their behavior is exercised in later tasks.
- [x] Move each existing behavior test into the new public API: registration
  order, skipped unsupported plugins, original callback context, registration
  list snapshot, source bytes/metadata, empty IDs, duplicate IDs, and failures.
  Update assertions for structured errors and managed handles.
- [x] Remove the old fake-save/mode tests because this slice does not implement
  editing. Replace their meaningful coverage with plugin-result cleanup and
  typed capability integration in Tasks 4 and 6. Do not imply editing is ready.
- [x] Update type tests for status narrowing and capability lookup. Remove old
  ViewSession/EditSession imports instead of retaining incompatible aliases.
- [x] Run the migrated tests and strict types; commit
  `feat(core)!: introduce managed document sessions`. In the detailed body,
  include `BREAKING CHANGE:` explaining readable sources, managed handles,
  asynchronous disposal, and deferred replacement of legacy editing semantics.

## Task 4: Deterministic async selection and plugin result validation

**Files:** Modify registry/resolver/session modules; create
`tests/plugins.test.ts` and `tests/capabilities.test.ts`.

- [ ] **Red:** Use a delayed first probe to prove order is preserved:

```ts
test("waits for the first probe before considering later plugins", async () => {
  const probe = deferred<boolean>();
  const calls: string[] = [];
  const first = fixturePlugin({
    id: "first", supports() { calls.push("first"); return probe.promise; },
  });
  const second = fixturePlugin({
    id: "second", supports() { calls.push("second"); return true; },
  });
  const core = createOmniview({ plugins: [first, second] });
  const session = core.createSession(createSource(new Blob(["a"])));
  const loading = session.load();
  probe.resolve(true);
  await loading;
  expect(calls).toEqual(["first"]);
  expect(session.getSnapshot()).toMatchObject({ pluginId: "first" });
  await core.dispose();
});
```

Import `test/expect` from bun:test, public APIs from the root, and
`deferred/fixturePlugin` from the declared support fixture in these files.

- [ ] Implement sequential awaited probes, explicit plugin selection, structured
  error wrapping, and the cached load promise. Preserve supports/open method
  context by invoking methods on their definition object.
- [ ] Add one failing test then implementation for each of: explicit plugin
  bypasses probes; missing explicit plugin; all false; sync throw and rejected
  promise from supports/open; unsupported apiVersion; noncallable callbacks.
- [ ] A caller-provided error object must be the exact `.cause` of PLUGIN_FAILED;
  assert plugin/source/session context. Do not fallback after a failed probe.
  Add runtime-invalid JavaScript-style fixtures using an explicit unknown cast
  in tests for nonboolean probes, malformed results, and invalid apiVersion;
  do not weaken production types to make invalid fixtures compile.
- [ ] Open a plugin with a provided textContent capability, retrieve it through
  session.getCapability and assert `getText()` yields a known string. Test
  missing keys, duplicate capability IDs, invalid values, and lookup before
  readiness/after disposal. Reject malformed results instead of publishing ready.
- [ ] Run focused plugin/capability tests and type checks; commit
  `feat(plugins): resolve and validate async plugins` with detailed reasoning.

## Task 5: Stable subscriptions and reentrant observers

**Files:** Create `src/sessions/state.ts` and `src/lifecycle/reporting.ts`;
integrate them in session/core; create `tests/session-state.test.ts`.

- [ ] **Red:** Verify stable snapshots and the exact normal transition sequence:

```ts
test("publishes stable lifecycle snapshots", async () => {
  const core = createOmniview({ plugins: [fixturePlugin()] });
  const session = core.createSession(createSource(new Blob(["a"])));
  const initial = session.getSnapshot();
  expect(session.getSnapshot()).toBe(initial);
  const states: string[] = [];
  session.subscribe(() => states.push(session.getSnapshot().status));
  await session.load();
  await session.dispose();
  expect(states).toEqual(["loading", "ready", "disposed"]);
  expect(Object.isFrozen(initial)).toBe(true);
  expect(Object.isFrozen(initial.source)).toBe(true);
  await core.dispose();
});
```

- [ ] Implement immutable snapshots with a monotonically advancing internal
  notification revision. Store each subscription registration separately.
  Before each callback, check that it remains registered and the publication
  revision is still current. Catch callback errors and report without throwing
  through document operations.
- [ ] Add tests for unsubscribe twice; same listener registered twice; one
  listener removing another before its turn; callback-triggered dispose; no
  callbacks after disposed; callback-triggered load during loading.
- [ ] Capture the first load promise and assert repeated load calls return that
  exact promise and invoke plugin.open once, including reentrant notification.
- [ ] Observer-error tests use onError to capture OBSERVER_FAILED and prove a
  later listener still runs and load succeeds. Test default console reporting
  and a throwing onError handler by temporarily spying on console.error; always
  restore it with finally. This mocks the public diagnostic output only.
- [ ] Commit `feat(sessions): expose stable lifecycle subscriptions` after
  focused tests and strict checking.

## Task 6: Scoped cleanup and failure precedence

**Files:** Create/complete `src/lifecycle/resources.ts`; integrate the plugin
context and disposal path; create `tests/session-resources.test.ts`.

- [ ] **Red:** Register resources through the public plugin context:

```ts
test("cleans every resource in reverse order despite a failure", async () => {
  const calls: string[] = [];
  const cause = new Error("worker cleanup failed");
  const core = createOmniview({ plugins: [fixturePlugin({
    open({ onDispose }) {
      onDispose(() => { calls.push("first"); });
      onDispose(() => { calls.push("second"); throw cause; });
      return { dispose() { calls.push("document"); } };
    },
  })] });
  const session = await core.open(createSource(new Blob(["a"])));
  await expect(session.dispose()).rejects.toMatchObject({ code: "CLEANUP_FAILED" });
  expect(calls).toEqual(["document", "second", "first"]);
  expect(core.getSessions()).toEqual([]);
  await core.dispose();
});
```

- [ ] Implement one resource-scope entry per registration and cache its disposal
  promise before invoking callbacks. Clear owned entries and mark closed before
  asynchronous cleanup starts. Invoke callbacks sequentially in LIFO order,
  collect failures, then reject one contextual CLEANUP_FAILED with aggregate
  causes. Never stop at the first failing cleanup.
- [ ] Exercise unregister twice, duplicate function registrations, repeated
  dispose promise identity, created-session disposal, asynchronous cleanup,
  late registration, and preserved result-dispose method context.
- [ ] A plugin that registers a resource then fails opening must clean it. Assert
  load rejects the original PLUGIN_FAILED while one secondary CLEANUP_FAILED
  reaches onError. Add a separate late-result cleanup failure assertion.
- [ ] Assert post-disposal create/load/capability operations cannot restore usable
  state and subscribers are released. Verify no hidden timer or worker is
  required by core cleanup itself.
- [ ] Commit `feat(sessions): own and dispose plugin resources` with the disposal
  order, error precedence, and late-result rules in its detailed body.

## Task 7: Source and plugin cancellation without stale results

**Files:** Complete `src/lifecycle/cancellation.ts`; integrate with resolver and
session; create `tests/session-cancellation.test.ts`.

- [ ] **Red:** Prove disposal does not wait for an uncooperative plugin:

```ts
test("disposes a late result without resurrecting the session", async () => {
  const started = deferred<void>();
  const result = deferred<PluginDocument>();
  const cleaned = deferred<void>();
  const core = createOmniview({ plugins: [fixturePlugin({
    open() { started.resolve(undefined); return result.promise; },
  })] });
  const session = core.createSession(createSource(new Blob(["a"])));
  const loading = session.load();
  const rejected = expect(loading).rejects.toMatchObject({ code: "CANCELLED" });
  await started.promise;
  await session.dispose();
  await rejected;
  expect(session.getSnapshot().status).toBe("disposed");
  result.resolve({ dispose() { cleaned.resolve(undefined); } });
  await cleaned.promise;
  expect(session.getSnapshot().status).toBe("disposed");
  await core.dispose();
});
```

Import PluginDocument as a type from the SDK. Attach rejection assertions before
triggering abort to avoid an unhandled rejection in the test itself.

- [ ] Implement the abort race: install the abort listener, schedule/capture the
  underlying operation, reject promptly on abort, and keep fulfillment/rejection
  handlers attached even after the race settles. Remove the signal listener on
  each outcome. Late open results enter the closed resource scope for disposal.
- [ ] Test pre-aborted load never probes; abort during an async probe never
  calls open; abort during open publishes cancelled; dispose during open retains
  disposed; late rejection produces no unhandled promise rejection.
- [ ] Test a caller signal aborted after ready does not close the session, while
  session disposal aborts the plugin's retained context signal.
- [ ] Test terminal load retry behavior, cancellation reason preservation, and
  queued work cancelled before its start callback runs.
- [ ] Commit `feat(sessions): cancel loads and reject stale results` after all
  controlled-race tests and strict checks pass.

## Task 8: Multiple sessions and core-wide disposal

**Files:** Complete `src/core/create-core.ts`; create
`tests/core-lifecycle.test.ts`.

- [ ] **Red:** Give each open its own real plugin closure:

```ts
test("isolates two documents opened by the same plugin", async () => {
  const key = defineCapability<{ text(): string }>("fixture:text");
  const core = createOmniview({ plugins: [fixturePlugin({
    async open({ source, signal }) {
      const text = new TextDecoder().decode(await source.read({ signal }));
      return { capabilities: [provideCapability(key, { text: () => text })] };
    },
  })] });
  const a = await core.open(createSource(new Blob(["alpha"])));
  const b = await core.open(createSource(new Blob(["beta"])));
  expect(a.id).not.toBe(b.id);
  expect(a.getCapability(key)?.text()).toBe("alpha");
  expect(b.getCapability(key)?.text()).toBe("beta");
  await a.dispose();
  expect(core.getSessions()).toEqual([b]);
  expect(b.getCapability(key)?.text()).toBe("beta");
  await core.dispose();
  expect(b.getSnapshot().status).toBe("disposed");
});
```

Import defineCapability/provideCapability from the SDK; all other APIs come from
the root. This test checks behavior across public boundaries rather than internal
store/map implementation.

- [ ] Implement cached frozen membership snapshots and per-core monotonic session
  identity. Mark core closed before starting disposal; all tracked sessions are
  attempted even when one cleanup fails. Aggregate failures after all settle.
- [ ] Verify core.dispose rejects cleanup failures while every session ends
  disposed; repeat calls share the disposal promise; no session can be created
  during a cleanup callback; open after closure rejects CORE_CLOSED.
- [ ] Verify failed core.open removes its temporary session and retains the
  primary failure, while explicit failed sessions remain inspectable until
  disposed. Preserve once-only cleanup diagnostics.
- [ ] Verify getSessions reference stability between membership changes and
  independence between two separate core instances.
- [ ] Commit `feat(core): manage isolated document lifetimes` after focused and
  full runtime tests pass.

## Task 9: Package the root and SDK as real public entry points

**Files:** Create `scripts/build.ts`, `scripts/verify-package.ts`, and a small
`tests/package-consumer/` fixture; modify `package.json`, `jsr.json`,
`tsconfig.json`, README, and CI. Keep existing `bunfig.toml` production coverage
rules; do not exclude new source modules.

- [ ] Add a packed-consumer test that imports root and `/sdk` by package name,
  defines a plugin, opens a Blob source, obtains a typed capability, and disposes
  core. It must initially fail because `/sdk` is not exported or built.
- [ ] Configure npm `exports["./sdk"]` with `./dist/sdk/index.d.ts` and
  `./dist/sdk/index.js`. Configure JSR object exports `.` to `./src/index.ts`
  and `./sdk` to `./src/sdk/index.ts`. Keep names/versions synchronized.
- [ ] Build both entry points together with splitting so shared runtime classes
  and token implementations are not duplicated between public imports:

```ts
import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");
if (dirname(output) !== root || basename(output) !== "dist") {
  throw new Error("Refusing to clean an unexpected build directory");
}
await rm(output, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "src/index.ts"), resolve(root, "src/sdk/index.ts")],
  root: resolve(root, "src"),
  outdir: output,
  target: "browser",
  format: "esm",
  splitting: true,
  sourcemap: "linked",
  packages: "external",
});
if (!result.success) throw new AggregateError(result.logs, "Build failed");
```

- [ ] Set the build script to `bun scripts/build.ts && tsc -p
  tsconfig.build.json`; include `scripts/**/*.ts` in development type checking.
  Public-source type checking still uses `types: []`. Validate all emitted JS
  chunks and declarations are included by the existing `files: ["dist", ...]`.
- [ ] In verify-package, use Bun to pack/read/extract the actual archive into
  an ignored temporary consumer. Verify expected manifest/files, compile its
  TypeScript under strict NodeNext with skipLibCheck false, and run compiled
  JS using Node. Use Bun-native process/archive APIs for the developer script;
  Node is the independent consumer runtime, not a new package dependency.
- [ ] The consumer verifies root.OmniviewError is the same constructor as
  sdk.OmniviewError and errors cross the public boundary correctly. It must not
  resolve dependencies from a source-path alias or reuse the old .cache smoke
  fixture as evidence. For an additional consumer check use lib: ["ES2022"] and
  types: ["node"] with skipLibCheck false. Standard Node Web API types come from
  the existing @types/bun dependency's transitive @types/node; public sources
  must not acquire a dependency on either ambient type package.
- [ ] Add `test:package` to CI after build. Include generated chunks in npm
  whitelist checks; exclude src/tests/skills/secrets from npm contents.
- [ ] Run npm pack dry-run and JSR dry-run with both exports. Do not publish.
- [ ] Commit `build: expose portable core and sdk entry points` with packaging
  compatibility and verification details.

## Task 10: Documentation, migration, and final acceptance

**Files:** Update README, AGENTS.md, the foundation design, and the runtime
proposal; add `docs/plugin-authoring.md` and `docs/migration-managed-sessions.md`.
Keep GLOSSARY terms consistent.

- [ ] Document plain JS and TS examples using only public imports. Include one
  viewer-only plugin fixture showing source reading, typed capability lookup,
  onDispose, and host-owned lifecycle. Do not create a production format plugin
  in the core repository.
- [ ] Explain metadata/range semantics, apiVersion 1, explicit-vs-detected plugin
  selection, structured errors, terminal failures, cancellation, error reporting,
  and session-scoped capability lifetimes.
- [ ] Explain migration from `{ name, data: Blob }` to createSource, from returned
  plugin sessions to managed DocumentSession, and from synchronous dispose to
  awaited cleanup. State that editing/save is intentionally a follow-up protocol.
- [ ] Retire AGENTS instructions describing mode/save as current session API;
  retain optional editing as the product requirement and link its next phase.
  Update architecture layout to the implemented lifecycle module boundary.
- [ ] Verify sources have no Bun/Node/framework/DOM imports or styles and zero
  runtime dependencies. No internal path appears in public authoring examples.
- [ ] Verify every public export has JSDoc/explicit types and both registries
  expose the implemented root/SDK API only.
- [ ] Run `bun install --frozen-lockfile`, `bun run check`, `bun run test:package`,
  `bun pm pack --dry-run`, and `bun run jsr:check`. All must exit 0.
- [ ] Re-prove the full-source coverage gate with a temporary uncalled source
  function, expect nonzero exit, remove the probe, then rerun the clean suite.
  Do not commit the probe or alter coverage exclusions to pass.
- [ ] Review implementation against the scenario/transition tables. Request
  independent code review under the repository workflow and resolve concrete
  correctness issues before reporting completion.
- [ ] Commit `docs: document managed core and plugin authoring` with validation
  details. Commit/push on master only within the user's authorization; no registry
  publication or real plugin/framework repository creation is part of execution.

## Completion criteria

- A plain JS application can define a plugin through `/sdk`, create/read a source,
  subscribe before load, obtain a capability, and await complete cleanup.
- Two documents opened by one plugin and two core instances remain independent.
- Failed, aborted, disposed, reentrant, and late-result operations follow the
  specified transition/error/ownership rules without resurrected sessions.
- All callbacks/resources are attempted exactly as owned, with actionable error
  reporting, no unhandled late rejection, and no implicit application I/O.
- Root and SDK source/declaration/runtime exports work from the actual npm
  archive and validate for JSR, without framework or CSS side effects.
- 100% executable source line/function coverage is enforced across loaded and
  previously unimported files; useful public-behavior assertions accompany it.
- The implementation and documentation explicitly distinguish completed
  lifecycle/SDK work from future editing, UI, formats, and the public test kit.
