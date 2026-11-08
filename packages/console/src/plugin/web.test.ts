import { describe, expect, it } from "vitest";
import { PLUGIN_BRIDGE_VERSION } from "./bridge.js";
import {
  applyTheme,
  connect,
  type FrameDocument,
  type FrameMessageEvent,
  type FrameWindow,
  PluginBridgeError,
} from "./web.js";

const ORIGIN = "https://console.example";

/** A window and a document as a frame has them, with the console's page played by the test. */
function frameOf(consoleOrigin: string | null = ORIGIN, pressed?: boolean) {
  const posted: { message: unknown; targetOrigin: string; transfer: Transferable[] | undefined }[] =
    [];
  const listeners = new Set<(event: FrameMessageEvent) => void>();
  const parent = {
    postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]) {
      posted.push({ message, targetOrigin, transfer });
    },
  };
  /** The windows the frame opened, as the browser was asked. */
  const opened: string[] = [];
  const win: FrameWindow = {
    parent,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    open: (url, target, features) => {
      opened.push(`${url} ${target} ${features}`);
      return null;
    },
    // A browser that can say whether a person pressed something a moment ago, or one that cannot.
    ...(pressed === undefined ? {} : { navigator: { userActivation: { isActive: pressed } } }),
  };
  const set: Record<string, string> = {};
  const doc: FrameDocument = {
    documentElement: {
      dataset:
        consoleOrigin === null ? {} : { console: consoleOrigin, plugin: "leave", page: "mine" },
      style: {
        setProperty(name, value) {
          set[name] = value;
        },
      },
      lang: "en",
    },
    body: { scrollHeight: 240 },
    title: "",
  };
  const receive = (data: unknown, origin = ORIGIN, source: unknown = parent) => {
    for (const listener of listeners) {
      listener({ data, origin, source });
    }
  };
  const init = () =>
    receive({
      v: 1,
      t: "init",
      plugin: { key: "leave", version: "1.0.0" },
      page: "mine",
      project: null,
      person: { id: "p", login: "alice", name: "Alice", language: "ko", admin: false },
      roles: ["employee"],
      path: "2026",
      language: "ko",
      theme: { "--sc-color-text": "#111" },
    });
  const lastCall = () => posted.at(-1)?.message as { id: string; method: string; params: unknown };
  return { win, doc, posted, set, receive, init, lastCall, listeners, opened };
}

describe("connect", () => {
  it("says ready, waits for init, applies the tokens and the language, and answers the connection", async () => {
    const frame = frameOf();
    const connecting = connect({ window: frame.win, document: frame.doc, resize: false });
    expect(frame.posted).toEqual([
      {
        message: { v: PLUGIN_BRIDGE_VERSION, t: "ready" },
        targetOrigin: ORIGIN,
        transfer: undefined,
      },
    ]);
    frame.init();
    const plugin = await connecting;
    expect(plugin.context.person.login).toBe("alice");
    expect(plugin.context.path).toBe("2026");
    expect(frame.set).toEqual({ "--sc-color-text": "#111" });
    expect(frame.doc.documentElement.lang).toBe("ko");
  });

  it("refuses a document that names no console", async () => {
    const frame = frameOf(null);
    await expect(connect({ window: frame.win, document: frame.doc })).rejects.toBeInstanceOf(
      PluginBridgeError,
    );
  });

  it("ignores messages from another origin or another window", async () => {
    const frame = frameOf();
    const connecting = connect({
      window: frame.win,
      document: frame.doc,
      resize: false,
      timeoutMs: 50,
    });
    frame.receive({ v: 1, t: "init" }, "https://elsewhere.example");
    frame.receive(
      {
        v: 1,
        t: "init",
        plugin: { key: "leave", version: "1" },
        project: null,
        person: { id: "p", login: "mallory", name: null, language: "en", admin: true },
        roles: [],
        path: "",
        language: "en",
        theme: {},
      },
      ORIGIN,
      {},
    );
    await expect(connecting).rejects.toMatchObject({ code: "plugin.no_init" });
  });

  it("performs calls through the page and settles them by id", async () => {
    const frame = frameOf();
    const connecting = connect({ window: frame.win, document: frame.doc, resize: false });
    frame.init();
    const plugin = await connecting;
    const pending = plugin.command("request", { from: "2026-11-01" });
    const call = frame.lastCall();
    expect(call).toEqual({
      v: 1,
      t: "call",
      id: "1",
      method: "command",
      params: { name: "request", args: { from: "2026-11-01" } },
    });
    frame.receive({
      v: 1,
      t: "result",
      id: "1",
      ok: true,
      value: { kind: "command", text: "Requested.", data: null, waiting: null },
    });
    await expect(pending).resolves.toMatchObject({ text: "Requested." });

    const refused = plugin.query("balance");
    frame.receive({
      v: 1,
      t: "result",
      id: "2",
      ok: false,
      error: { code: "plugin.forbidden", message: "no role" },
    });
    await expect(refused).rejects.toMatchObject({ code: "plugin.forbidden", message: "no role" });

    void plugin.records.list("requests", { limit: 5, order: "-from" });
    expect(frame.lastCall().params).toEqual({ collection: "requests", limit: 5, order: "-from" });
    void plugin.records.get("requests", "r1", 2);
    expect(frame.lastCall().params).toEqual({ collection: "requests", id: "r1", version: 2 });
    void plugin.files.put(new Uint8Array([1, 2, 3]), "a.bin", "application/octet-stream");
    const put = frame.posted.at(-1) as {
      message: { params: { bytes: ArrayBuffer } };
      transfer: Transferable[] | undefined;
    };
    expect(put.message.params.bytes.byteLength).toBe(3);
    expect(put.transfer).toHaveLength(1);
  });

  it("asks for a person's picture by the person, keeps it, and takes none for an answer", async () => {
    const frame = frameOf();
    const connecting = connect({ window: frame.win, document: frame.doc, resize: false });
    frame.init();
    const plugin = await connecting;
    const answer = (id: string, value: unknown) =>
      frame.receive({ v: 1, t: "result", id, ok: true, value });
    const refuse = (id: string, code: string) =>
      frame.receive({ v: 1, t: "result", id, ok: false, error: { code, message: "no" } });

    const asked = plugin.people.picture("p1");
    expect(frame.lastCall()).toMatchObject({ method: "people.picture", params: { id: "p1" } });
    answer(frame.lastCall().id, { type: "image/png", bytes: new ArrayBuffer(4) });
    await expect(asked).resolves.toMatch(/^blob:/);
    // Asked again, it is the same address, and the page is asked nothing.
    const calls = frame.posted.length;
    await expect(plugin.people.picture("p1")).resolves.toBe(await asked);
    expect(frame.posted).toHaveLength(calls);

    const none = plugin.people.picture("p2");
    refuse(frame.lastCall().id, "plugin.not_found");
    await expect(none).resolves.toBeNull();
    const away = plugin.people.picture("p3");
    refuse(frame.lastCall().id, "picture.unavailable");
    await expect(away).resolves.toBeNull();

    // A plugin that was not given the people is told, and may ask again once it is.
    const refused = plugin.people.picture("p4");
    refuse(frame.lastCall().id, "plugin.forbidden");
    await expect(refused).rejects.toMatchObject({ code: "plugin.forbidden" });
    void plugin.people.picture("p4");
    expect(frame.lastCall()).toMatchObject({ method: "people.picture", params: { id: "p4" } });
  });

  it("navigates within the console only, and says its title", async () => {
    const frame = frameOf();
    const connecting = connect({ window: frame.win, document: frame.doc, resize: false });
    frame.init();
    const plugin = await connecting;
    plugin.navigate("/projects/web");
    expect(frame.posted.at(-1)?.message).toEqual({ v: 1, t: "navigate", path: "/projects/web" });
    expect(() => plugin.navigate("https://elsewhere.example/")).toThrow(PluginBridgeError);
    plugin.setTitle("Leave\nrequests");
    expect(frame.doc.title).toBe("Leave requests");
    expect(frame.posted.at(-1)?.message).toEqual({ v: 1, t: "title", text: "Leave requests" });
    plugin.download("f1");
    expect(frame.posted.at(-1)?.message).toEqual({ v: 1, t: "download", id: "f1" });
    // A link to the web is the frame's own to open, in a new tab with no opener and no referrer
    // (ADR-0078), asking the page nothing; a path of the console's is not one.
    plugin.open("https://forms.example/leave");
    expect(frame.opened).toEqual(["https://forms.example/leave _blank noopener,noreferrer"]);
    expect(frame.posted.at(-1)?.message).toEqual({ v: 1, t: "download", id: "f1" });
    expect(() => plugin.open("/projects/web")).toThrow(PluginBridgeError);
    expect(() => plugin.open("javascript:alert(1)")).toThrow(PluginBridgeError);
    expect(frame.opened).toHaveLength(1);
  });

  it("opens a link right after a press in the frame, and refuses one when the browser says there was none (ADR-0078)", async () => {
    const after = frameOf(ORIGIN, true);
    const connecting = connect({ window: after.win, document: after.doc, resize: false });
    after.init();
    const plugin = await connecting;
    plugin.open("https://forms.example/leave");
    expect(after.opened).toHaveLength(1);
    const without = frameOf(ORIGIN, false);
    const connectingWithout = connect({
      window: without.win,
      document: without.doc,
      resize: false,
    });
    without.init();
    const idle = await connectingWithout;
    expect(() => idle.open("https://forms.example/leave")).toThrow(PluginBridgeError);
    expect(without.opened).toEqual([]);
  });

  it("subscribes once per kind and hands events, themes and paths to the handlers", async () => {
    const frame = frameOf();
    const connecting = connect({ window: frame.win, document: frame.doc, resize: false });
    frame.init();
    const plugin = await connecting;
    const events: unknown[] = [];
    const stop = plugin.onEvent(["records"], (kind, data) => events.push([kind, data]));
    plugin.onEvent(["records", "command"], () => {});
    expect(
      frame.posted
        .filter((post) => (post.message as { t: string }).t === "subscribe")
        .map((post) => post.message),
    ).toEqual([
      { v: 1, t: "subscribe", kinds: ["records"] },
      { v: 1, t: "subscribe", kinds: ["records", "command"] },
    ]);
    frame.receive({ v: 1, t: "event", kind: "records", data: { collection: "requests" } });
    expect(events).toEqual([["records", { collection: "requests" }]]);
    stop();
    frame.receive({ v: 1, t: "event", kind: "records", data: {} });
    expect(events).toHaveLength(1);

    const themes: unknown[] = [];
    plugin.onTheme((theme) => themes.push(theme));
    frame.receive({ v: 1, t: "theme", theme: { "--sc-color-bg": "#000" } });
    expect(frame.set["--sc-color-bg"]).toBe("#000");
    expect(themes).toEqual([{ "--sc-color-bg": "#000" }]);

    const paths: string[] = [];
    plugin.onPath((path) => paths.push(path));
    frame.receive({ v: 1, t: "path", path: "2027" });
    expect(paths).toEqual(["2027"]);

    const sizes: string[] = [];
    plugin.onSize((size) => sizes.push(size));
    frame.receive({ v: 1, t: "size", size: "large" });
    expect(sizes).toEqual(["large"]);

    plugin.close();
    expect(frame.listeners.size).toBe(0);
  });

  it("says its height when asked to", async () => {
    const frame = frameOf();
    const connecting = connect({ window: frame.win, document: frame.doc });
    frame.init();
    const plugin = await connecting;
    expect(
      frame.posted.some(
        (post) =>
          JSON.stringify(post.message) === JSON.stringify({ v: 1, t: "resize", height: 240 }),
      ),
    ).toBe(true);
    plugin.close();
  });
});

describe("applyTheme", () => {
  it("sets the console's tokens and nothing else", () => {
    const set: Record<string, string> = {};
    const doc: FrameDocument = {
      documentElement: {
        dataset: {},
        style: {
          setProperty(name, value) {
            set[name] = value;
          },
        },
        lang: "",
      },
      body: null,
      title: "",
    };
    applyTheme(doc, { "--sc-color-text": "#111", color: "red", "--other": "x" });
    expect(set).toEqual({ "--sc-color-text": "#111" });
  });
});
