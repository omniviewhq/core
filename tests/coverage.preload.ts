import { pathToFileURL } from "node:url";

// Bun measures loaded modules. Include every production source file so a new,
// unimported module cannot silently escape the coverage threshold.
for await (const file of new Bun.Glob("src/**/*.ts").scan({
  cwd: process.cwd(),
  absolute: true,
})) {
  if (!file.endsWith(".d.ts")) await import(pathToFileURL(file).href);
}
