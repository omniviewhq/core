import { mkdir, mkdtemp, rename } from "node:fs/promises";
import { resolve } from "node:path";
import jsrManifest from "../jsr.json";
import packageManifest from "../package.json";

interface PackedManifest {
  name: string;
  version: string;
  exports: Record<string, string | { types: string; import: string }>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dir, "..");
await Bun.write(resolve(root, ".cache/package-consumer/.keep"), "");
const consumer = await mkdtemp(resolve(root, ".cache/package-consumer/run-"));

async function run(command: string[], cwd = root): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await process.exited;
  if (code !== 0) throw new Error(`${command.join(" ")} exited with ${code}`);
}

const archivePath = resolve(consumer, "core.tgz");
await run([
  process.execPath,
  "pm",
  "pack",
  "--ignore-scripts",
  "--filename",
  archivePath,
]);
const archive = new Bun.Archive(await Bun.file(archivePath).bytes());
const files = await archive.files();
for (const path of files.keys()) {
  assert(
    /^package\/(?:package\.json|README\.md|LICENSE|dist\/.+\.(?:js|js\.map|d\.ts))$/.test(
      path,
    ),
    `Unexpected npm archive file: ${path}`,
  );
}
for await (const path of new Bun.Glob("**/*").scan({
  cwd: resolve(root, "dist"),
  onlyFiles: true,
})) {
  assert(
    files.has(`package/dist/${path.replaceAll("\\", "/")}`),
    `Build output missing from npm archive: ${path}`,
  );
}
const manifestFile = files.get("package/package.json");
assert(manifestFile, "The npm archive must contain package.json");
const manifest: PackedManifest = await manifestFile.json();
assert(
  manifest.name === packageManifest.name && manifest.name === jsrManifest.name,
  "Registry package names must match",
);
assert(
  manifest.version === packageManifest.version &&
    manifest.version === jsrManifest.version,
  "Registry versions must match",
);
for (const field of [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
] as const) {
  assert(
    Object.keys(manifest[field] ?? {}).length === 0,
    `Core must have zero ${field}`,
  );
}
for (const [entry, base, source] of [
  [".", "dist/index", "./src/index.ts"],
  ["./sdk", "dist/sdk/index", "./src/sdk/index.ts"],
] as const) {
  const exported = manifest.exports[entry];
  assert(
    typeof exported === "object" &&
      exported.types === `./${base}.d.ts` &&
      exported.import === `./${base}.js`,
    `Invalid npm entry point: ${entry}`,
  );
  assert(
    jsrManifest.exports[entry] === source,
    `Invalid JSR entry point: ${entry}`,
  );
  assert(
    files.has(`package/${base}.d.ts`) && files.has(`package/${base}.js`),
    `Missing public entry files: ${entry}`,
  );
}
assert(
  [...files.keys()].some((path) => /^package\/dist\/chunk-.+\.js$/.test(path)),
  "The two entry points must ship shared runtime chunks",
);
await archive.extract(resolve(consumer, "unpacked"));
await mkdir(resolve(consumer, "node_modules/@omniview"), { recursive: true });
await rename(
  resolve(consumer, "unpacked/package"),
  resolve(consumer, "node_modules/@omniview/core"),
);
await Bun.write(
  resolve(consumer, "package.json"),
  JSON.stringify({ private: true, type: "module" }),
);
await Bun.write(
  resolve(consumer, "consumer.ts"),
  Bun.file(resolve(root, "tests/package-consumer/consumer.ts")),
);
for (const [name, lib, types] of [
  ["dom", ["ES2022", "DOM"], []],
  ["node", ["ES2022"], ["node"]],
] as const) {
  const config = resolve(consumer, `tsconfig.${name}.json`);
  await Bun.write(
    config,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        lib,
        types,
        outDir: `output-${name}`,
      },
      files: ["consumer.ts"],
    }),
  );
  await run(
    [
      process.execPath,
      resolve(root, "node_modules/typescript/bin/tsc"),
      "-p",
      config,
    ],
    consumer,
  );
  await run(
    ["node", resolve(consumer, `output-${name}/consumer.js`)],
    consumer,
  );
}
console.log(
  "Packed consumer passed strict DOM and Node type checks and Node execution",
);
