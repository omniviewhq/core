# Core foundation implementation plan

**Goal:** Prepare the standalone @omniview/core repository for Bun development
and validated npm/JSR publication.

**Architecture:** A portable TypeScript library with an ordered plugin registry
and discriminated view/edit sessions. Format implementations live elsewhere.

**Tech stack:** Bun 1.4.3, TypeScript, Biome, GitHub Actions.

- [x] Run `bun init --yes`; pin the toolchain and development dependencies.
- [x] Configure package exports to `dist/index.js` and `dist/index.d.ts`;
  configure JSR exports to `src/index.ts` with the same name and version.
- [x] Write behavior tests for selection, validation, error propagation, source
  identity, session disposal, and optional editing; run against an unimplemented
  core and verify failure before implementing it.
- [x] Implement the minimal registry in `src/omniview.ts` and public contracts
  in `src/types.ts`; verify the tests pass.
- [x] Configure full-source coverage loading and a 100% line/function threshold.
- [x] Install selected existing AI skills with their supporting files and
  document their provenance and selection.
- [x] Add CI, manual release workflows, README, MIT license, contributor rules,
  and registry setup documentation.
- [x] Run frozen installation, lint, both type checks, coverage, ESM/declaration
  build, npm dry run, and JSR dry run. Verify a packed package imports cleanly.
- [x] Prove the coverage gate rejects an untested source file, remove the probe,
  and rerun the clean suite. Initialize Git, configure the supplied origin, and
  use `master` as the primary local branch.
