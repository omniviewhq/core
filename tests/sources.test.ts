import { expect, test } from "bun:test";
import { createSource, OmniviewError } from "../src/index.ts";

test("reads a named source with exclusive-end byte ranges", async () => {
  const source = createSource(new Blob(["hello"], { type: "text/plain" }), {
    name: "notes.txt",
  });
  expect(source.name).toBe("notes.txt");
  expect(source.size).toBe(5);
  expect([...(await source.read({ start: 1, end: 4 }))]).toEqual([
    101, 108, 108,
  ]);
});

test("copies byte input and returns independent read buffers", async () => {
  const input = new Uint8Array([2, 4, 6]);
  const source = createSource(input);
  input[0] = 9;
  const first = await source.read();
  expect([...first]).toEqual([2, 4, 6]);
  first[1] = 9;
  expect([...(await source.read())]).toEqual([2, 4, 6]);
  expect(source.mimeType).toBe("application/octet-stream");
});

test("adapts File metadata and explicit overrides", async () => {
  const file = new File(["hello"], "a.txt", { type: "text/plain" });
  expect(createSource(file).name).toBe("a.txt");
  const source = createSource(file, { name: "b.txt", mimeType: "custom/type" });
  expect(source.name).toBe("b.txt");
  expect(source.mimeType).toBe("custom/type");
  expect([...(await source.read({ start: 2, end: 2 }))]).toEqual([]);
  expect([...(await createSource(new Blob()).read())]).toEqual([]);
});

test.each([
  { start: -1 },
  { start: 0.5 },
  { end: 6 },
  { start: 4, end: 2 },
  { end: Number.NaN },
  { start: Number.POSITIVE_INFINITY },
])("rejects invalid byte ranges: %j", async (range) => {
  await expect(
    createSource(new Blob(["hello"])).read(range),
  ).rejects.toMatchObject({ code: "INVALID_RANGE" });
});

test.each(["", "  "])("rejects a blank name: %j", (name) => {
  expect(() => createSource(new Blob(), { name })).toThrow(OmniviewError);
});

test("rejects invalid runtime sources and preserves structured causes", () => {
  expect(() => createSource(null as unknown as Blob)).toThrow(OmniviewError);
  const cause = new Error("original");
  const context = { sourceName: "a.txt" };
  const error = new OmniviewError("INVALID_SOURCE", "bad source", {
    cause,
    context,
  });
  context.sourceName = "changed";
  expect(error.cause).toBe(cause);
  expect(error.context.sourceName).toBe("a.txt");
  expect(error.name).toBe("OmniviewError");
});

test("cancels reads and retains the original abort reason", async () => {
  const source = createSource(new Blob(["hello"]));
  const controller = new AbortController();
  const cause = new Error("cancel read");
  controller.abort(cause);
  await expect(
    source.read({ signal: controller.signal }),
  ).rejects.toMatchObject({ code: "CANCELLED", cause });
  const next = new AbortController();
  const reading = source.read({ signal: next.signal });
  const rejected = reading.catch((error: unknown) => error);
  next.abort();
  expect(await rejected).toMatchObject({ code: "CANCELLED" });
});

test("reads with a live signal and preserves source I/O failures", async () => {
  const signal = new AbortController().signal;
  expect([...(await createSource(new Blob(["a"])).read({ signal }))]).toEqual([
    97,
  ]);
  const cause = new Error("storage failed");
  class BrokenBlob extends Blob {
    override slice(): Blob {
      return this;
    }
    override arrayBuffer(): Promise<ArrayBuffer> {
      return Promise.reject(cause);
    }
  }
  await expect(
    createSource(new BrokenBlob(["a"])).read({ signal }),
  ).rejects.toBe(cause);
});
