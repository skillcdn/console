import { describe, expect, it } from "vitest";
import {
  isBridgePath,
  isBridgeToFrame,
  isBridgeToPage,
  isBridgeUrl,
  isOpenableFrom,
} from "./bridge.js";

const INIT = {
  v: 1,
  t: "init",
  plugin: { key: "leave", version: "1.2.3" },
  page: "mine",
  project: null,
  person: { id: "p", login: "alice", name: null, language: "ko", admin: false },
  roles: ["employee"],
  path: "",
  language: "ko",
  theme: { "--sc-color-text": "#111" },
};

describe("isBridgeToFrame", () => {
  it("accepts what the console's page sends", () => {
    expect(isBridgeToFrame(INIT)).toBe(true);
    expect(
      isBridgeToFrame({
        ...INIT,
        page: undefined,
        widget: "balance",
        project: { key: "web", name: "Web" },
      }),
    ).toBe(true);
    expect(isBridgeToFrame({ v: 1, t: "result", id: "1", ok: true, value: 3 })).toBe(true);
    expect(
      isBridgeToFrame({
        v: 1,
        t: "result",
        id: "1",
        ok: false,
        error: { code: "plugin.forbidden", message: "no" },
      }),
    ).toBe(true);
    expect(isBridgeToFrame({ v: 1, t: "event", kind: "records", data: {} })).toBe(true);
    expect(isBridgeToFrame({ v: 1, t: "theme", theme: { "--sc-color-bg": "#fff" } })).toBe(true);
    expect(isBridgeToFrame({ v: 1, t: "path", path: "/2026-11" })).toBe(true);
    // A widget's size (ADR-0059): at the start, and when the person changes it.
    expect(isBridgeToFrame({ ...INIT, page: undefined, widget: "balance", size: "small" })).toBe(
      true,
    );
    expect(isBridgeToFrame({ v: 1, t: "size", size: "wide" })).toBe(true);
    expect(isBridgeToFrame({ ...INIT, widget: "balance", size: "huge" })).toBe(false);
    expect(isBridgeToFrame({ v: 1, t: "size", size: "huge" })).toBe(false);
  });

  it("takes the workspace, the day its week begins on within the week, and goes without it from an older console", () => {
    const workspace = {
      name: "Acme",
      languages: ["en", "ko"],
      timeZone: "Asia/Seoul",
      weekStart: "sunday",
      firstDay: 7,
    };
    expect(isBridgeToFrame({ ...INIT, workspace })).toBe(true);
    expect(isBridgeToFrame(INIT)).toBe(true);
    // The language for whoever has none (ADR-0081), from a console that says it.
    expect(isBridgeToFrame({ ...INIT, workspace: { ...workspace, language: "ko" } })).toBe(true);
    for (const wrong of [
      { ...workspace, language: 7 },
      { ...workspace, language: "" },
      { ...workspace, name: 7 },
      { ...workspace, languages: "ko" },
      { ...workspace, languages: [7] },
      { ...workspace, firstDay: 0 },
      { ...workspace, firstDay: 8 },
      { ...workspace, firstDay: 1.5 },
      { ...workspace, firstDay: "7" },
      { ...workspace, weekStart: "friday" },
      { ...workspace, timeZone: "" },
      "sunday",
    ]) {
      expect(isBridgeToFrame({ ...INIT, workspace: wrong })).toBe(false);
    }
  });

  it("drops anything else unread", () => {
    expect(isBridgeToFrame(null)).toBe(false);
    expect(isBridgeToFrame("init")).toBe(false);
    expect(isBridgeToFrame({ t: "init" })).toBe(false);
    expect(isBridgeToFrame({ v: 2, t: "init" })).toBe(false);
    expect(isBridgeToFrame({ ...INIT, theme: { color: "red" } })).toBe(false);
    expect(isBridgeToFrame({ ...INIT, theme: { "--sc-x": "a".repeat(201) } })).toBe(false);
    expect(isBridgeToFrame({ ...INIT, roles: "employee" })).toBe(false);
    expect(isBridgeToFrame({ v: 1, t: "result", id: "", ok: true })).toBe(false);
    expect(isBridgeToFrame({ v: 1, t: "result", id: "1", ok: false, error: "no" })).toBe(false);
    expect(isBridgeToFrame({ v: 1, t: "event", kind: "anything", data: {} })).toBe(false);
    expect(isBridgeToFrame({ v: 1, t: "call", id: "1", method: "command", params: {} })).toBe(
      false,
    );
  });
});

describe("isBridgeToPage", () => {
  it("accepts what a frame may ask", () => {
    expect(isBridgeToPage({ v: 1, t: "ready" })).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "unavailable" })).toBe(true);
    expect(
      isBridgeToPage({
        v: 1,
        t: "call",
        id: "1",
        method: "command",
        params: { name: "request", args: {} },
      }),
    ).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "navigate", path: "/projects/web" })).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "resize", height: 320 })).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "title", text: "Leave" })).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "download", id: "f1" })).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "open", url: "https://forms.example/leave" })).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "open", url: "mailto:hr@example.com" })).toBe(true);
    expect(isBridgeToPage({ v: 1, t: "subscribe", kinds: ["records", "plugin"] })).toBe(true);
  });

  it("refuses a method outside the bridge, a URL, and nonsense", () => {
    expect(isBridgeToPage({ v: 1, t: "call", id: "1", method: "fetch", params: {} })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "call", id: "1", method: "command", params: "x" })).toBe(
      false,
    );
    expect(isBridgeToPage({ v: 1, t: "navigate", path: "https://elsewhere.example/" })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "navigate", path: "//elsewhere.example/" })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "navigate", path: "relative" })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "resize", height: -1 })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "resize", height: Number.NaN })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "title", text: "a\nb" })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "open", url: "javascript:alert(1)" })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "open", url: "/projects/web" })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "subscribe", kinds: ["everything"] })).toBe(false);
    expect(isBridgeToPage({ v: 1, t: "init" })).toBe(false);
    expect(isBridgeToPage([])).toBe(false);
  });
});

describe("isBridgeUrl", () => {
  it("takes a web or a mail address, absolute and one line, and nothing that runs or is relative", () => {
    expect(isBridgeUrl("https://forms.example/leave?id=1#top")).toBe(true);
    expect(isBridgeUrl("http://intranet.example/")).toBe(true);
    expect(isBridgeUrl("mailto:hr@example.com?subject=Leave")).toBe(true);
    expect(isBridgeUrl("javascript:alert(1)")).toBe(false);
    expect(isBridgeUrl("data:text/html,hi")).toBe(false);
    expect(isBridgeUrl("blob:https://console.example/x")).toBe(false);
    expect(isBridgeUrl("file:///etc/passwd")).toBe(false);
    expect(isBridgeUrl("/projects/web")).toBe(false);
    expect(isBridgeUrl("forms.example/leave")).toBe(false);
    expect(isBridgeUrl("https://a b.example/")).toBe(false);
    expect(isBridgeUrl(`https://forms.example/${"a".repeat(2048)}`)).toBe(false);
    expect(isBridgeUrl("")).toBe(false);
    expect(isBridgeUrl(42)).toBe(false);
  });
});

describe("isOpenableFrom", () => {
  it("opens an address elsewhere for a frame, and never a page of the console's own (ADR-0067)", () => {
    const origin = "https://console.example";
    expect(isOpenableFrom("https://forms.example/leave", origin)).toBe(true);
    expect(isOpenableFrom("mailto:hr@example.com", origin)).toBe(true);
    expect(isOpenableFrom("https://console.example/settings/plugins/leave", origin)).toBe(false);
    expect(isOpenableFrom("https://CONSOLE.example:443/people", origin)).toBe(false);
    expect(isOpenableFrom("http://console.example/people", origin)).toBe(true);
    expect(isOpenableFrom("javascript:alert(1)", origin)).toBe(false);
  });
});

describe("isBridgePath", () => {
  it("takes a path of the console's and nothing else", () => {
    expect(isBridgePath("/")).toBe(true);
    expect(isBridgePath("/plugins/leave/mine/2026")).toBe(true);
    expect(isBridgePath("/a b")).toBe(false);
    expect(isBridgePath("javascript:alert(1)")).toBe(false);
    expect(isBridgePath(`/${"a".repeat(2048)}`)).toBe(false);
  });
});
