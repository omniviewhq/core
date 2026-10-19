# Omniview core foundation

Agreed constraints: Bun-first development; `@omniview/core` in npm and JSR;
core in `omniviewhq/core`; every plugin and framework adapter in a separate
repository; framework-independent consumption; editing supported by the core
contract and optionally provided by plugins; 100% source coverage.
The primary branch is `master`.

The repository is a single TypeScript library. The public source depends only on
standard Web APIs. Bun provides installation, testing, coverage, type checking,
and JavaScript bundling; TypeScript emits declarations and checks public source
without runtime-specific ambient types. Biome handles linting and formatting.

The initial core snapshots an ordered plugin list, validates IDs, and opens a
named Blob through the first supporting plugin. A plugin returns a discriminated
view or edit session. Only edit sessions serialize changes with save(). The host
owns persistence and session disposal. Errors propagate to the caller.

Framework adapters and the future vanilla DOM renderer will consume this same
contract. Rendering, first format plugins, editor interactions, asynchronous
capability detection, cancellation, history, and shared UI controls are outside
this repository-preparation slice and need their own designs.

npm publishes browser-compatible ESM with declarations; JSR publishes the same
API as TypeScript source. CI verifies Windows and Linux, 100% line/function
coverage, public types, the build, and both registry dry runs. A preload loads
every production source module so unloaded modules cannot escape coverage.
Branch coverage is not enforced by Bun; behavior tests cover both outcomes.

The package uses MIT licensing and version 0.1.0. Registry publication is a
separate manual action after npm credentials and the JSR repository link exist.
