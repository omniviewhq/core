import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");
if (dirname(output) !== root || basename(output) !== "dist") {
  throw new Error("Refusing to clean an unexpected build directory");
}
await rm(output, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [
    resolve(root, "src/index.ts"),
    resolve(root, "src/sdk/index.ts"),
  ],
  root: resolve(root, "src"),
  outdir: output,
  target: "browser",
  format: "esm",
  splitting: true,
  sourcemap: "linked",
  packages: "external",
});
if (!result.success) throw new AggregateError(result.logs, "Build failed");
