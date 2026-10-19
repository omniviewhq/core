import { expect, test } from "bun:test";
import { createOmniview, createSource } from "../src/index.ts";
import {
  defineCapability,
  definePlugin,
  OmniviewError,
  provideCapability,
} from "../src/sdk/index.ts";
import { deferred, fixturePlugin } from "./support/fixtures.ts";

test("the default author fixture supports a source and opens a document", async () => {
  const plugin = fixturePlugin();
  const source = createSource(new Blob(["hello"]));
  const signal = new AbortController().signal;
  expect(await plugin.supports({ source, signal })).toBe(true);
  const core = createOmniview({ plugins: [plugin] });
  const session = await core.open(source);
  expect(session.getSnapshot()).toMatchObject({
    status: "ready",
    editing: { supported: false },
  });
  await core.dispose();
});

test("plugin authors can read a source and publish a document capability", async () => {
  const text = defineCapability<{ getText(): string }>("example.text:content");
  const plugin = definePlugin({
    id: "example/text",
    apiVersion: 1,
    authorLabel: "Example text reader",
    supports: ({ source }) => source.mimeType.split(";")[0] === "text/plain",
    async open({ source, signal }) {
      const content = new TextDecoder().decode(await source.read({ signal }));
      return {
        capabilities: [provideCapability(text, { getText: () => content })],
      };
    },
  });
  const source = createSource(new Blob(["hello"], { type: "text/plain" }));
  const signal = new AbortController().signal;
  expect(await plugin.supports({ source, signal })).toBe(true);
  const core = createOmniview({ plugins: [plugin] });
  const session = await core.open(source);
  expect(session.getCapability(text)?.getText()).toBe("hello");
  // The author retains the concrete value while publication erases its type.
  const value = { getText: () => "a second document" };
  const publication = provideCapability(text, value);
  expect(publication.value).toBe(value);
  expect(value.getText()).toBe("a second document");
  expect(Object.isFrozen(text)).toBe(true);
  expect(Object.isFrozen(publication)).toBe(true);
  expect(plugin.authorLabel).toBe("Example text reader");
  await core.dispose();
});

test.each([
  "example:",
  ":content",
  "Example:content",
  "example:with space",
  "example:content:more",
])("rejects an invalid capability identifier: %j", (id) => {
  expect(() => defineCapability(id as `${string}:${string}`)).toThrow(
    OmniviewError,
  );
  expect(() => defineCapability(id as `${string}:${string}`)).toThrow(
    expect.objectContaining({ code: "INVALID_CAPABILITY" }),
  );
});

test.each([
  null,
  undefined,
  123,
  Symbol("example:content"),
  { toString: () => "example:content" },
])("rejects a non-string JavaScript capability identifier: %j", (id) => {
  expect(() =>
    defineCapability(id as unknown as `${string}:${string}`),
  ).toThrow(expect.objectContaining({ code: "INVALID_CAPABILITY" }));
});

test("deferred fixtures provide explicit success and failure controls", async () => {
  const success = deferred<string>();
  success.resolve("ready");
  expect(await success.promise).toBe("ready");
  const failure = deferred<void>();
  const cause = new Error("controlled failure");
  const rejected = failure.promise.catch((error: unknown) => error);
  failure.reject(cause);
  expect(await rejected).toBe(cause);
});
