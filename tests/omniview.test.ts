import { describe, expect, test } from "bun:test";
import {
  createOmniview,
  type DocumentSource,
  type EditSession,
  type OmniviewPlugin,
  type ViewSession,
} from "../src/index.ts";

const source: DocumentSource = {
  name: "notes.txt",
  data: new Blob(["hello"], { type: "text/plain" }),
};

function viewer(id = "text"): OmniviewPlugin {
  return {
    id,
    supports: (file) => file.name.endsWith(".txt"),
    open: async () => ({ mode: "view", dispose() {} }),
  };
}

describe("createOmniview", () => {
  test("opens a supported document through its plugin", async () => {
    const core = createOmniview({ plugins: [viewer()] });
    expect((await core.open(source)).mode).toBe("view");
  });

  test("rejects unsupported files, including an empty registry", async () => {
    const empty = createOmniview({ plugins: [] });
    await expect(empty.open(source)).rejects.toThrow("No plugin supports");
    const core = createOmniview({ plugins: [viewer()] });
    await expect(
      core.open({
        name: "photo.png",
        data: new Blob([], { type: "image/png" }),
      }),
    ).rejects.toThrow("No plugin supports");
  });

  test("uses the first supporting plugin in registration order", async () => {
    const second: OmniviewPlugin = {
      ...viewer("second"),
      open: async () => {
        throw new Error("wrong plugin");
      },
    };
    const core = createOmniview({ plugins: [viewer(), second] });
    expect((await core.open(source)).mode).toBe("view");
  });

  test("skips plugins that do not support the source", async () => {
    const unsupported: OmniviewPlugin = {
      ...viewer("image"),
      supports: () => false,
    };
    const core = createOmniview({ plugins: [unsupported, viewer()] });
    expect((await core.open(source)).mode).toBe("view");
  });

  test("passes the original source and preserves plugin method context", async () => {
    const plugin: OmniviewPlugin = {
      id: "context",
      supports(file) {
        expect(this.id).toBe("context");
        expect(file).toBe(source);
        return true;
      },
      async open(file) {
        expect(this.id).toBe("context");
        expect(file).toBe(source);
        return { mode: "view", dispose() {} };
      },
    };
    await createOmniview({ plugins: [plugin] }).open(source);
  });

  test("snapshots the supplied plugin list", async () => {
    const plugins = [viewer()];
    const core = createOmniview({ plugins });
    plugins.length = 0;
    expect((await core.open(source)).mode).toBe("view");
  });

  test.each(["", "  ", "\n"])("rejects an empty plugin id: %j", (id) => {
    expect(() => createOmniview({ plugins: [viewer(id)] })).toThrow(
      "Plugin id must not be empty",
    );
  });

  test("rejects duplicate plugin ids", () => {
    expect(() => createOmniview({ plugins: [viewer(), viewer()] })).toThrow(
      "Duplicate plugin id: text",
    );
  });

  test("propagates detection errors as rejected promises", async () => {
    const error = new Error("cannot detect");
    const plugin = {
      ...viewer(),
      supports() {
        throw error;
      },
    };
    await expect(
      createOmniview({ plugins: [plugin] }).open(source),
    ).rejects.toBe(error);
  });

  test("propagates plugin open errors", async () => {
    const error = new Error("cannot parse");
    const plugin = {
      ...viewer(),
      async open() {
        throw error;
      },
    };
    await expect(
      createOmniview({ plugins: [plugin] }).open(source),
    ).rejects.toBe(error);
  });

  test("keeps viewer-only sessions read-only", async () => {
    let disposed = false;
    const session: ViewSession = {
      mode: "view",
      dispose() {
        disposed = true;
      },
    };
    const plugin = { ...viewer(), open: async () => session };
    const opened = await createOmniview({ plugins: [plugin] }).open(source);
    expect(opened).toBe(session);
    expect("save" in opened).toBe(false);
    opened.dispose();
    expect(disposed).toBe(true);
  });

  test("exposes saving only for editable sessions", async () => {
    let text = "hello";
    let disposed = false;
    const session: EditSession = {
      mode: "edit",
      async save() {
        return new Blob([text], { type: "text/plain" });
      },
      dispose() {
        disposed = true;
      },
    };
    const plugin = { ...viewer(), open: async () => session };
    const opened = await createOmniview({ plugins: [plugin] }).open(source);
    expect(opened).toBe(session);
    expect(opened.mode).toBe("edit");
    if (opened.mode !== "edit") throw new Error("Expected an editor session");
    text = "edited text";
    expect(await (await opened.save()).text()).toBe("edited text");
    expect(await source.data.text()).toBe("hello");
    opened.dispose();
    expect(disposed).toBe(true);
  });
});
