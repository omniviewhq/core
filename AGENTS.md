# Omniview core

This repository contains only @omniview/core. Every plugin and framework adapter
belongs in its own repository. Read README.md and the architecture document first.

## Development

- Bun-first: bun install, bun test, Bun.build/bun build, bun --check. Use Bun's
  built-in APIs in development tooling before adding dependencies.
- Public library code must work without Bun, Node, or any framework. Use standard
  Web APIs; do not import bun:*, node:*, React, or Vue from src/.
- Use TypeScript with explicit public types, strict checks, and JSR-compatible
  relative imports. Export the plugin contract through src/index.ts.
- Editing is optional per session. Narrow mode before using save(). The host
  owns persistence and calls dispose(); core must propagate plugin failures.
- Keep npm and JSR names/versions synchronized. npm ships dist; JSR ships src.
- Add behavior tests before implementation. Keep source line and function
  coverage at 100%; test failure paths, not just happy paths. Do not exclude
  production code to meet coverage. Bun does not enforce branch coverage.
- Run bun run check before reporting completion. For packaging changes also run
  bun pm pack --dry-run and bun run jsr:check. Preserve bun.lock.
- Use Conventional Commits with an imperative semantic subject and a detailed
  body covering intent, important changes, and validation.
- Repository preparation does not authorize registry publication or git push.

## Skills

Project skills are installed in .agents/skills with full supporting files.
See docs/ai-skills.md and .agents/skills.local.json for selection and provenance.
Use skills relevant to the task. Product/backend-specific skills were omitted.
