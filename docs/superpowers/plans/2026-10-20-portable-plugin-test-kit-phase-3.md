# Portable Plugin Test Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans.
> Execute all tasks without an additional handoff question: the user explicitly
> requested implementation. Track steps with checkboxes.

**Goal:** Implement the approved portable `/testing` conformance suite, including
real plugin scenarios, controlled cancellation, explicit omissions and packaging.

**Architecture:** Immutable discovery produces independent case closures. Each
run owns its fixture, cores, controls and diagnostics; scenario modules use that
narrow orchestration API and public core operations. Root and SDK never import
testing. Tests use only the root, SDK and testing public seams.

**Tech Stack:** Existing Bun, strict TypeScript, Biome and standard Web APIs.
No new dependency or package version change.

---

## Scope and execution

Authority is the [approved design](../specs/2026-10-20-portable-plugin-test-kit-design.md)
and the user's instruction to implement it on 2026-10-20. Preserve all existing
196 tests and the 100% source line/function gate. No parser, renderer, external
plugin repository, test runner, publication or production test hook is included.

Use `feat/plugin-test-kit` in the current checkout: the prior managed-worktree
attempt was sandbox-blocked; do not create more unusable worktrees. Integrate and
push normally to `master` under the user's persistent authorization after review.
Use semantic commits with detailed intent and actual verification evidence.

Confirmed seams: public suite discovery/run/error contracts; actual root/SDK
plugin capabilities; actual extracted npm consumers. No private imports, mocks
of controllers, revision injection, sleeps or guessed microtask flushing.

Work vertically: add a public failing behavior, observe meaningful failure,
implement it, run focused tests/types, then extend. Existing behavior needs no
manufactured red. Attach rejection handlers before triggering cancellation.
Milestone coverage must remain unmodified. Keep orchestration with the primary
implementer; delegate one independent scenario task at a time with explicit file
ownership and review the result before integration.

## File map

| Path | Responsibility |
| --- | --- |
| `src/testing/types.ts` | Exact approved public fixture/profile/suite declarations |
| `src/testing/errors.ts` | Testing error, cause and frozen diagnostic snapshots |
| `src/testing/index.ts` | Explicit public exports, independent of root/SDK exports |
| `src/testing/config.ts` | Validate and snapshot configuration/receivers once |
| `src/testing/create-suite.ts` | Stable IDs, frozen descriptors and omissions |
| `src/testing/run.ts` | Fresh fixture, tracked cores, primary/cleanup/late ownership |
| `src/testing/control.ts` | Observed control milestones, release-once and drain |
| `src/testing/assertions.ts` | Private assertions, observed outcomes and phase markers |
| `src/testing/context.ts` | Narrow private scenario orchestration contracts |
| `src/testing/cases/baseline.ts` | Detection/lifetime/source/viewer/unsupported checks |
| `src/testing/cases/editing.ts` | Real edits, output and exact receipts |
| `src/testing/cases/pending.ts` | Optional controlled load/edit races |
| `tests/testing-*.test.ts` | Public behavior, mutant and failure regressions |
| `tests/testing.types.ts` | Strict fixture inference and negative contracts |
| `tests/support/conformance-fixture.ts` | Known-good text/viewer configurations and gates |
| Manifests/build/verifier/packed consumer | Third public entry and graph/identity checks |
| README/AGENTS/authoring/architecture/spec | Current implemented API and examples |

## Task 1: Contracts and first discovery slice

- [ ] Copy the approved declarations into `src/testing/types.ts`; implement
  `PluginConformanceError` in `errors.ts` using native ErrorOptions and frozen
  copied arrays. Public members require explicit isolated-declaration types.
- [ ] Add this first test in `tests/testing-discovery.test.ts` before the entry:

```ts
import { expect, test } from "bun:test";
import { createSource } from "../src/index.ts";
import { definePlugin } from "../src/sdk/index.ts";
import { createPluginTestSuite } from "../src/testing/index.ts";

test("discovers frozen cases without creating fixtures", () => {
  let calls = 0;
  const suite = createPluginTestSuite({
    id: "viewer.basic", editing: false,
    createFixture() {
      calls++;
      return { plugin: definePlugin({ id:"example/viewer", apiVersion:1,
        supports:()=>true, open:()=>({}) }),
        createSource:()=>createSource(new Blob(["a"])) };
    },
    verifyDocument() {}, fingerprint:()=>"a",
  });
  expect(calls).toBe(0);
  expect(suite.cases.some((check)=>check.id==="viewer.basic/open/detection")).toBe(true);
  expect(Object.isFrozen(suite.cases)).toBe(true);
  expect(suite.omitted.some((item)=>item.id==="viewer.basic/editing")).toBe(true);
});
```

- [ ] Run `bun test tests/testing-discovery.test.ts`, expect missing entry.
  Introduce real case closures together with the first working open scenario;
  do not publish no-op run placeholders. Snapshot callbacks/receivers once.
- [ ] Extend discovery with stable IDs, no import/factory side effects, malformed
  options/getters/duplicate unsupported IDs, nested mutation and all omissions.
  Declaration-only tests cover generic subtype inference and readonly results.

## Task 2: Per-run ownership and baseline cases

- [ ] Add `tests/support/conformance-fixture.ts` using a real model and root/SDK
  APIs. Its known-good baseline config supplies a fresh plugin/environment,
  deterministic sources, initial assertions and semantic fingerprints.
- [ ] Add a run regression proving two concurrent invocations acquire and clean
  distinct fixtures. Use `Promise.all([check.run(), check.run()])`, with counters
  in the fixture factory/dispose, and assert two acquisitions/two cleanups.
- [ ] Implement tracked core/source/context helpers and phase-aware boundaries.
  Snapshot fixture cleanup before inspecting other fields so failed validation
  still releases acquired resources. Preserve thrown null/undefined explicitly.
- [ ] Implement every baseline catalog row plus viewer `editing/unsupported`.
  Use only public core methods; `verifyDocument` must validate capabilities.
  Source ownership reads/copies compare real bytes, not implementation counters.
- [ ] Test each catalog case by selecting its stable ID and calling run. Add
  wrong detection/content and shared-state/leak mutant fixtures that fail at the
  intended check. Run `bun test tests/testing-baseline.test.ts` and typecheck.

## Task 3: Failure, diagnostic and cleanup ownership

- [ ] Introduce public failing tests for factory/source errors, malformed fixture,
  non-string fingerprints/non-undefined verification values and content throws.
- [ ] Implement the phase table from the design. A primary survives later
  cleanup; no primary plus cleanup failures yields cleanup phase and AggregateError.
  Keep original identities, including falsey thrown values, and freeze arrays.
- [ ] Add failures in multiple owned cores, resource verification and fixture
  cleanup. Assert every later cleanup runs and verifyDisposed precedes environment
  disposal, including partial initialization. Repeated disposal shares promises.
- [ ] Exercise core onError during/after cleanup, default late sink and throwing
  custom late sink. Known diagnostics fail an otherwise successful case; late
  diagnostics use the originating case ID without unhandled rejection.
- [ ] Run focused tests and full `bun run check` at a complete ownership milestone.
  Commit only an integrated, verified boundary; no lowered coverage thresholds.

## Task 4: Editing, serialization and receipt scenarios

- [ ] Add editable fixture adapters through actual typed capabilities, not a
  mock context or direct model mutation. A real change produces distinct content;
  output verification decodes bytes against the captured semantic fingerprint.
- [ ] Add one selected-case test, observe its absence/failure, implement that
  behavior, then continue through every editing/serialization/persistence row.
  Optional no-op must preserve revision, permitting transient busy transitions.
- [ ] Cover core/session policy precedence and re-enable, independent documents
  and cores, read-only and pre-aborted export, call-time and concurrent captures,
  independent reads, post-disposal output and retained closed editing calls.
- [ ] Receipt cases reject copy/fabricated/foreign identities without state
  changes. Acknowledge changed B then initial A then B; compare equality only,
  never parse opaque revisions or assume one revision per capability call.
- [ ] Add real unguarded mutation and delayed live-model encoding mutants.
  Run `bun test tests/testing-editing.test.ts` and strict types. Independently
  review spec compliance, then quality of the complete scenario boundary.

## Task 5: Controlled work and pending profiles

- [ ] Add a known-good controllable dependency to the fixture. Load entered and
  drained milestones must refer to actual plugin work; pending edit result must
  be the actual capability promise with a gate before its first accepted change.
- [ ] First test pending-load cancellation before release; assert no ready
  resurrection and resource balance after drain. Implement acquired controls,
  observed entered/drained/result outcomes, first-completion race and release once.
- [ ] Add pending-load disposal and four pending-edit cases. Register handlers
  before triggering cancellation. Verify busy/initial state while held, original
  cancellation reason, READ_ONLY/SESSION_CLOSED causes, and no late accepted edit.
- [ ] Test premature completion, rejecting/invalid milestones, wrong async
  control boxes, release failure and drain failure. If release fails, do not hang
  later cleanup on its unreleased gate; continue observing late outcomes.
- [ ] Run public pending/failure tests, strict types and full check. Commit the
  verified runtime with coherent discovery/scenario/control ownership.

## Task 6: Third entry and actual package consumers

- [ ] Add npm `./testing` => `dist/testing/index` and JSR `./testing` =>
  `./src/testing/index.ts`; add build entry without dependencies/version changes.
- [ ] Extend the verifier's entry table and replace its two-entry assumption.
  Check root and SDK import graphs exclude testing; root/SDK/testing share runtime
  error identity. Keep source preload and portable library ambient restrictions.
- [ ] Append an independent consumer suite using a real editable plugin in the
  packed-consumer file. Execute all its cases with ordinary async JavaScript and
  assert omissions. No source/fixture/private imports into the archive consumer.
- [ ] Run `bun run check`, full `tsc`, `bun run test:package`, npm pack dry run,
  and JSR dry run. Both DOM and Node-only consumer declarations compile and Node
  executes the packed kit independently. Commit portable integration evidence.

## Task 7: Current docs, review and acceptance

- [ ] Update README, AGENTS, authoring and architecture only once testing exists.
  Provide executable viewer/editable examples, explicit omission reporting,
  fixture/resource/control ownership and runner timeout limitations. Mark the
  design implemented without rewriting its historical verification record.
- [ ] Compile/execute guide examples against actual exports. Distinguish fixture
  semantic checks from exhaustive parser correctness and resource leak proofs.
- [ ] Request independent spec and quality review with precise files/invariants.
  Turn concrete findings into public failing regressions, fix and re-review.
- [ ] Run frozen install, full check, full development TypeScript, packed consumers,
  npm and JSR dry runs, and `git diff --check`; inspect all exits. Re-prove unused
  source fails coverage, remove probe and rerun the clean suite.
- [ ] Record task evidence here; commit detailed semantic changes, fast-forward
  master, rerun merged acceptance, push normally and verify clean status and
  equal local/remote master identities. Never publish a registry package.

## Traceability

Contracts/discovery: Task 1. Ownership/errors: Tasks 2-3. Catalog: Tasks 2, 4-5.
Controlled milestones/late work: Tasks 3, 5. Portability, exports and actual archive:
Task 6. Documentation, mutation/failure sensitivity, coverage and review: all
tasks and final Task 7 acceptance. All production additions remain covered.
