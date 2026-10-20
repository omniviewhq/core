# Omniview core foundation

Agreed constraints: Bun-first development; `@omniview/core` on npm and JSR;
core in `omniviewhq/core`; each plugin and framework adapter in a separate
repository; framework-independent consumption; optional editing as a product
goal; 100% source line/function coverage. The primary branch is `master`.

The implemented foundation is a managed headless runtime, replacing the initial
experimental view/edit session union. It snapshots an ordered validated plugin
registry, reads Blob/File/byte-backed sources, selects plugins through sequential
async detection or explicit choice, and manages independent document sessions.
Plugins use `apiVersion: 1` and return document capabilities and cleanup;
applications receive observable managed handles. Session failures are terminal,
loading is cancellable, and disposal awaits resource cleanup. See
[migration](../../migration-managed-sessions.md) and
[plugin authoring](../../plugin-authoring.md) for current contracts.

The repository is one TypeScript library using standard Web APIs only. Public
source has no Bun, Node, framework, DOM, or CSS dependency. Bun handles
development, testing, and bundling; TypeScript emits declarations and checks
public source without runtime-specific ambient types. Biome handles formatting.

Dependencies flow from core composition to sessions, then source/plugin and
capability contracts. Shared cancellation, cleanup, and reporting live in
`src/lifecycle/`, below session orchestration; plugins and sources never depend
on sessions. The root serves applications; `/sdk` serves plugin authors; explicit
`/testing` imports serve plugin tests without a second runtime. Root and SDK
imports do not load testing code. See the [runtime architecture](2026-10-19-core-runtime-proposal.md)
for the implemented module layout and future stages.

Phase 2 implements optional async editing with synchronous accepted changes, revision
and dirty state, immutable serialization captures, and exact persistence receipts.
See the [editing protocol](2026-10-20-editing-protocol-design.md). Host applications
own storage and acknowledge the output actually persisted. The old `mode`/`save()`
union is not a current contract. Phase 3 implements the
[portable public test kit](2026-10-20-portable-plugin-test-kit-design.md): independent
async cases use actual public sessions, author content/output assertions, fresh
fixtures, explicit omissions, and optional controlled work/resource checks.
Runner registration and finite time limits belong to the caller. This cannot
certify parser correctness or prove absence of leaks without author verification.
The next integration proof is a real text plugin in its own repository and a
plain JavaScript host. UI, format plugins, framework adapters, and undo/redo
remain future work.

Developer customization remains a public architecture requirement. Future UI
supports optional themes, replaceable regions, and fully custom rendering over
public state, commands, and events. Shipped selectors and names follow the
namespaced, instance-scoped [customization contract](2026-10-19-customization-design.md).

npm publishes browser-compatible ESM and declarations from `dist/`; JSR publishes
the same root, `/sdk`, and `/testing` APIs from `src/`. The package uses MIT licensing and
version `0.1.0`. CI verifies strict types, Windows/Linux behavior, full-source
coverage, the build, packed consumers, and registry dry runs. A preload loads
every production module so unimported code cannot escape coverage. Bun does not
enforce branch coverage; tests explicitly cover failure paths.

Publication and git push are separate authorized actions; repository preparation
does not authorize either.
