# Omniview core

This repository contains only @omniview/core. Every plugin and framework adapter
belongs in its own repository. Read README.md and the architecture document first.

## Development

- Bun-first: bun install, bun test, Bun.build/bun build, bun --check. Use Bun's
  built-in APIs in development tooling before adding dependencies.
- Public library code must work without Bun, Node, or any framework. Use standard
  Web APIs; do not import bun:*, node:*, React, or Vue from src/.
- Use TypeScript with explicit public types, strict checks, and JSR-compatible
  relative imports. Applications use the root entry point; plugin authors use
  /sdk and plugin tests explicitly use /testing. Keep all three public APIs
  portable; root/SDK imports must not load testing. Expose no private paths.
- The current API uses readable sources and managed DocumentSession handles.
  Plugins declare apiVersion: 1 and publish session-scoped capabilities.
  Await session/core dispose(); propagate plugin failures and report secondary
  cleanup failures. The host owns persistence.
- Optional editing extends apiVersion: 1 through PluginDocument.editing.
  Follow docs/superpowers/specs/2026-10-20-editing-protocol-design.md:
  PluginContext.edit may await work; each model change uses a synchronous commit.
  Default readOnly is true; cancellation/failure preserves accepted revisions
  with no rollback. Capture immutable state synchronously; encode asynchronously.
  The host acknowledges successful authoritative writes with the exact same-session
  SerializationResult, in storage commit order. Never infer persistence from
  serialization, clone a receipt, or replace the original source metadata.
- Capture cleanup is owned once across encoding and session disposal. Cleanup
  may initiate owner disposal without awaiting it, but must never return or await
  an owner disposal promise that includes that same cleanup.
- The portable /testing kit is implemented. Follow
  docs/superpowers/specs/2026-10-20-portable-plugin-test-kit-design.md: exercise
  real plugins through public operations, use fresh per-run fixtures, report
  explicit omissions, and leave runner limits/registration to the host. Author
  assertions establish content correctness and resource cleanup; generic checks
  cannot certify a parser or prove absence of leaks.
- Keep UI, format implementations, adapters, undo/redo, collaboration, and autosave
  scheduling outside this phase. Next comes an external real text plugin and
  plain JavaScript host. There is no mode/save API.
- Keep npm and JSR names/versions synchronized. npm ships dist; JSR ships src.
- Add behavior tests before implementation. Keep source line and function
  coverage at 100%; test failure paths, not just happy paths. Do not exclude
  production code to meet coverage. Bun does not enforce branch coverage.
- Run bun run check before reporting completion. For packaging changes also run
  bun pm pack --dry-run and bun run jsr:check. Preserve bun.lock.
- Use Conventional Commits with an imperative semantic subject and a detailed
  body covering intent, important changes, and validation.
- Repository preparation does not authorize registry publication or git push.

## Customization and style isolation

- Follow docs/superpowers/specs/2026-10-19-customization-design.md for UI work.
- Keep core headless. UI must support optional themes, replaceable regions,
  and fully custom rendering over public state, commands, and events.
- Prefix shipped classes with omniview-, CSS variables with --omniview-,
  and data attributes with data-omniview-. Namespace animations, layers,
  fonts, counters, plugin hooks, and generated IDs as well.
- Scope all shipped selectors to an Omniview root, including portal roots.
  No generic global classes, document-wide resets, or unscoped elements.
- Keep default CSS optional, easy to override, and independent per instance.
  Official plugins and adapters must follow the same customization contract.

## Skills

Project skills are installed in .agents/skills with full supporting files.
See docs/ai-skills.md and .agents/skills.local.json for selection and provenance.
Use skills relevant to the task. Product/backend-specific skills were omitted.
