# @omniview/core

A portable, headless runtime for plugin-driven file viewing and optional editing.
Every format plugin and framework adapter lives in
its own repository and package.

The managed runtime provides readable sources, deterministic async plugin
selection, independent observable sessions, typed capabilities, cancellation,
and asynchronous cleanup. Editable plugins use guarded async operations,
revision/dirty state, immutable serialization captures, and host persistence
acknowledgements. The public API is experimental. Rendering, controls, format
parsers, framework adapters, and a public test kit remain future work.

## Use without a framework

After publication, install with any npm-compatible package manager or JSR:

```sh
bun add @omniview/core
# npm install @omniview/core
# bunx jsr add @omniview/core
```

Applications import `@omniview/core`; plugin authors import
`@omniview/core/sdk`. Both entry points have zero runtime dependencies and use
standard Web APIs, without Bun, Node, a framework, DOM, or CSS requirements.
npm ships ESM and declarations; JSR ships TypeScript source with the same API.

This plain JavaScript example defines a read-only fixture, not a production
format plugin:

```js
import { createOmniview, createSource } from "@omniview/core";
import {
  defineCapability,
  definePlugin,
  provideCapability,
} from "@omniview/core/sdk";

const textContent = defineCapability("example.text:content");

function textFixture({ encoding = "utf-8" } = {}) {
  return definePlugin({
    id: "example/text-fixture",
    apiVersion: 1,
    supports: ({ source }) => source.mimeType.split(";")[0] === "text/plain",
    async open({ source, signal, onDispose }) {
      let text = new TextDecoder(encoding).decode(await source.read({ signal }));
      onDispose(() => { text = ""; });
      return {
        capabilities: [provideCapability(textContent, { getText: () => text })],
      };
    },
  });
}

const core = createOmniview({ plugins: [textFixture()] });
const session = core.createSession(createSource(
  new Blob(["Hello!"], { type: "text/plain" }),
  { name: "notes.txt" },
));
const unsubscribe = session.subscribe(() => {
  console.log(session.getSnapshot().status);
});
try {
  await session.load();
  console.log(session.getCapability(textContent)?.getText());
} finally {
  unsubscribe();
  await core.dispose();
}
```

For a shorter lifecycle, `await core.open(source)` returns a ready managed
session. The host awaits `session.dispose()` when closing one document, or
`core.dispose()` when closing all documents. A browser can import built ESM from
`./dist/index.js` and `./dist/sdk/index.js` using `<script type="module">`;
serve the complete build, including shared chunks. No framework is required.

## Sources, selection, and sessions

`createSource` accepts `Blob`, `File`, or `Uint8Array`. It exposes fixed metadata
and fresh byte copies through `read({ start, end, signal })`; ranges use an
inclusive start and exclusive end. Hosts can implement `ReadableSource` for
custom storage and retain control over network/filesystem access.

Plugins declare `apiVersion: 1`. Detection awaits `supports(context)` sequentially
in registration order and selects the first `true`. An explicit `pluginId`
bypasses detection. Plugin failures preserve their cause and do not fall back
to another plugin.

A session moves from `created` to `loading`, then `ready`, `error`, or
`cancelled`; disposal is terminal from any state. Snapshots are immutable and
stable between changes. Load failures and cancellation are terminal: create a
new session to retry. Capabilities are available only while ready and belong
to that session's lifetime. Never retain them for use after disposal.

Disposal aborts work and awaits known cleanup callbacks in reverse registration
order. Late plugin results cannot restore ready state and are cleaned up too.
Operation failures reject their promises; observer errors and secondary/late
cleanup failures reach `onError`, defaulting to `console.error`.

See [plugin authoring](docs/plugin-authoring.md) for TypeScript, source ranges,
cancellation, and error details, and [migration](docs/migration-managed-sessions.md)
for the replaced foundation API. The host owns persistence; core has no `mode`
or `save()` method.

## Optional editing and persistence

A plugin enables editing by returning an `editing.capture()` definition. A
viewer-only plugin still works and reports `editing.supported === false` in
ready state. Editable sessions default to read-only: policy precedence is the
session's `readOnly`, the core's `readOnly`, then `true`. Enable writes explicitly
with `{ readOnly: false }`; `session.setReadOnly(true)` can revoke them later.
Read-only sessions can still serialize and acknowledge persisted output.

This plain JavaScript fixture uses the same public capability for every host:

```js
import { createOmniview, createSource } from "@omniview/core";
import {
  defineCapability, definePlugin, provideCapability,
} from "@omniview/core/sdk";

const editableText = defineCapability("example.text:editable");
const editablePlugin = definePlugin({
  id: "example/editable-text-fixture",
  apiVersion: 1,
  supports: () => true,
  async open({ source, signal, edit }) {
    let text = new TextDecoder().decode(await source.read({ signal }));
    return {
      capabilities: [provideCapability(editableText, {
        getText: () => text,
        replaceText: (next) => edit(async ({ commit }) => {
          const prepared = await Promise.resolve(next);
          commit(() => {
            const changed = text !== prepared;
            text = prepared;
            return { changed, value: undefined };
          });
        }),
      })],
      editing: {
        capture() {
          const captured = text;
          return {
            serialize: () => ({ data: new TextEncoder().encode(captured) }),
          };
        },
      },
    };
  },
});

// persistBytes belongs to the host and fulfills only after a successful write.
export async function editAndPersist(persistBytes) {
  const core = createOmniview({ plugins: [editablePlugin] });
  try {
    const session = await core.open(createSource(new Blob(["before"])), {
      readOnly: false,
    });
    const text = session.getCapability(editableText);
    if (!text) throw new Error("Text API unavailable");
    await text.replaceText("after");
    const output = await session.serialize();
    await persistBytes(await output.source.read());
    session.markPersisted(output);
  } finally {
    await core.dispose();
  }
}
```

`edit` may await preparation and accept several changes through synchronous
`commit` callbacks. Each `changed: true` advances an opaque string revision;
`changed: false` does not. One writer is allowed per session, with no queue.
Failures and cancellation preserve accepted changes; core supplies no rollback.
The ready snapshot exposes `readOnly`, `busy`, `revision`, `persistedRevision`,
and `dirty` when editing is supported. Revisions are compared for equality,
and `dirty` means `revision !== persistedRevision`.

Serialization synchronously captures one revision, then may encode it
asynchronously while later edits proceed. Capture must retain immutable data or
copy mutable data; encoding must not read the later live model. Output stays
readable after disposal, and session source metadata continues to describe the
original input, even when output supplies a different name or MIME type.

Serialization alone leaves persistence state unchanged. After a successful
authoritative write, pass the exact returned object to `markPersisted` on the
same live session. Clones, fabricated objects, and another session's receipt
are rejected. Failed writes must skip acknowledgement. Hosts must sequence
conflicting writes or acknowledge their actual storage commit order: if an older
write overwrites newer bytes, acknowledging it makes the newer document dirty
again. Exporting a copy need not acknowledge persistence. See
[plugin authoring](docs/plugin-authoring.md#optional-editing) for cancellation,
capture cleanup, and an autosave building block.

## Customization architecture

Future UI and official plugins must support optional themes, replaceable regions,
and fully custom rendering over public state, commands, and events. Default CSS
is optional and scoped to each viewer or portal root. Classes use `omniview-*`,
variables `--omniview-*`, and attributes `data-omniview-*`; other style names and
generated IDs are namespaced too. See the
[customization contract](docs/superpowers/specs/2026-10-19-customization-design.md).

## Development

Use Bun **1.4.3** (see `packageManager`):

```sh
bun install --frozen-lockfile
bun run check
bun run test:package
bun pm pack --dry-run
bun run jsr:check
```

`check` runs Biome, strict type checking, tests with 100% source line/function
coverage, and the browser-targeted multi-entry ESM/declaration build. A preload
loads all production modules for coverage. Bun does not enforce branch coverage;
tests cover failure paths explicitly. LCOV is written to `coverage/lcov.info`.
`test:package` verifies an actual npm archive through independent consumers.
`bun run fix` formats and fixes lint findings. Public-source type checking uses
no Bun or Node ambient types.

## Publishing

npm receives `dist/`; JSR receives `src/`. Both expose the root and `/sdk` as
`@omniview/core` version `0.1.0`. There is no `/testing` export. See
[release setup](docs/releasing.md) before the separate manual Release workflow.
Repository preparation does not authorize publication or git push.

## Project

- [GitHub](https://github.com/omniviewhq/core)
- [JSR](https://jsr.io/@omniview/core)
- [Architecture](docs/superpowers/specs/2026-10-19-core-foundation-design.md)
- [Runtime architecture and roadmap](docs/superpowers/specs/2026-10-19-core-runtime-proposal.md)
- [Phase 1 implementation plan](docs/superpowers/plans/2026-10-19-core-runtime-phase-1.md)
- [Approved editing protocol design](docs/superpowers/specs/2026-10-20-editing-protocol-design.md)
- [Phase 2 implementation plan](docs/superpowers/plans/2026-10-20-editing-protocol-phase-2.md)
- [Proposed portable plugin test kit](docs/superpowers/specs/2026-10-20-portable-plugin-test-kit-design.md)
- [Installed AI skills](docs/ai-skills.md)

MIT licensed.
