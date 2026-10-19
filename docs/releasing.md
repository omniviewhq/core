# Releasing @omniview/core

This repository publishes only the core. Plugins and framework adapters have
their own repositories, versions, and release pipelines.

## Registry setup

1. Use the existing JSR package `@omniview/core`. Link it to
   `omniviewhq/core` in the package settings to enable GitHub Actions OIDC.
2. Configure the `@omniview` npm organization/package and a publishing token
   with access to `@omniview/core`. Save it as the GitHub Actions secret
   `NPM_TOKEN`. The Bun publish command reads `NPM_CONFIG_TOKEN`.
3. Keep `package.json` and `jsr.json` names and versions synchronized.

## Validate

```sh
bun install --frozen-lockfile
bun run pack:check
bun run jsr:check
```

The npm dry run runs the publication checks and lists packaged files without
uploading. The JSR dry run type-checks the package and checks the source graph
without uploading; the CLI may download Deno on its first run. The dry run
allows local uncommitted changes; actual publication requires a clean checkout.

## Publish

Run the **Release** workflow manually from `master`, the primary branch.
The workflow skips publication when invoked from another branch.
Validation completes before publishing jobs start. npm and JSR are independent
registries: inspect both job results. If one registry succeeds and the other
fails, rerun only the failed job; an already published version is immutable.

For local publication after validation:

```sh
bun publish --access public
bun run jsr publish
```

Local publication uses the relevant registry's authentication flow. The setup
task only runs dry runs; it does not publish version 0.1.0.
