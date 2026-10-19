# @omniview/core

Framework-agnostic file viewing and editing, extended through plugins.

This repository contains the headless Omniview core. Each format plugin and
framework adapter lives in its own repository and is released as its own package.
The core has zero runtime dependencies and does not require Bun in consuming apps.

## Status

Repository foundation: plugin selection, view/edit session contracts, packaging,
and CI. Rendering, built-in controls, format plugins, and framework adapters are
not implemented yet. The public API is experimental.

## Use without a framework

After the first release, install with any npm-compatible package manager:

```sh
bun add @omniview/core
# npm install @omniview/core
# bunx jsr add @omniview/core
```

Use it from plain JavaScript or TypeScript. The host supplies plugins:

```ts
import { createOmniview } from "@omniview/core";
import { myPlugin } from "./my-plugin.js";

const core = createOmniview({ plugins: [myPlugin] });
const session = await core.open({
  name: "notes.txt",
  data: new Blob(["Hello!"], { type: "text/plain" }),
});

try {
  if (session.mode === "edit") {
    const updatedFile = await session.save();
    // Persist updatedFile using your application's upload or download flow.
    console.log(updatedFile.size);
  }
} finally {
  session.dispose();
}
```

No framework is required. For a browser without a bundler, serve the built ESM
file and import it with `<script type="module">`:

```html
<script type="module">
  import { createOmniview } from "./dist/index.js";
  // Supply plugins from your application or their separate packages.
</script>
```

After publication, the same ESM file can be served by an npm CDN with a pinned
version. A global-script bundle and a Web Component are separate future options;
they are not required for framework-independent use.

## Plugin contract

Import `OmniviewPlugin`, `DocumentSource`, `ViewSession`, and `EditSession` from
`@omniview/core`. Plugins implement `supports(source)` and `open(source)`.
The first supporting plugin wins, in the order supplied to `createOmniview`.
Plugin IDs must be unique and nonempty. Selection and opening failures reject
`core.open()` without being swallowed.

A session declares `mode: "view"` or `mode: "edit"`. Only editable sessions expose
`save(): Promise<Blob>`. Saving serializes changes; the host chooses how to persist
them. The host owns the returned session and calls `dispose()` when finished.
UI rendering and editing interactions will be specified with the first plugins.

## Development

Use Bun **1.4.3** (see `packageManager`):

```sh
bun install --frozen-lockfile
bun run check
bun run pack:check
bun run jsr:check
```

`check` runs Biome, strict type checking, tests with 100% line and function
coverage, and a browser-targeted ESM build with TypeScript declarations.
All production modules are loaded for coverage, including modules not imported
by tests. Bun does not enforce branch coverage; tests cover both success and
failure paths explicitly. LCOV is written to `coverage/lcov.info`.

`bun run fix` formats and fixes lint findings. The public-source type check uses
no Bun or Node ambient types, keeping the library portable.

## Publishing

npm receives compiled ESM and `.d.ts` declarations from `dist/`. JSR receives
TypeScript source through `jsr.json`. Both use `@omniview/core` and version `0.1.0`.
See [release setup](docs/releasing.md) before running the manual Release workflow.

## Project

- [GitHub](https://github.com/omniviewhq/core)
- [JSR](https://jsr.io/@omniview/core)
- [Architecture](docs/superpowers/specs/2026-10-19-core-foundation-design.md)
- [Installed AI skills](docs/ai-skills.md)

MIT licensed.
