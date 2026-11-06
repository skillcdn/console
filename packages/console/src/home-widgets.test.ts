import { describe, expect, it } from "vitest";
import {
  addable,
  added,
  arrangementShown,
  defaultArrangement,
  moved,
  removed,
  resized,
} from "./home-widgets.js";
import type { RestPlugin } from "./schemas.js";

const plugin = (key: string, widgets: RestPlugin["widgets"]): RestPlugin =>
  ({
    key,
    name: { en: key },
    description: { en: "" },
    agentNote: null,
    version: "1.0.0",
    state: "enabled",
    problems: [],
    roles: [],
    declaredRoles: [],
    defaultRole: null,
    menu: null,
    pages: [],
    widgets,
    board: null,
    boardNeeds: "none",
    capabilities: [],
    consent: null,
    projects: null,
    requires: {},
    dataVersion: 1,
    enabledAt: null,
  }) as RestPlugin;

const hr = plugin("hr", [
  {
    key: "balance",
    name: { en: "My leave" },
    place: "home:top",
    size: "third",
    sizes: ["small", "medium"],
    defaultSize: "small",
  },
  {
    key: "today",
    name: { en: "Out today" },
    place: "home:top",
    size: "half",
    sizes: ["medium", "large", "wide"],
    defaultSize: "medium",
  },
]);
const balanceWidget = hr.widgets[0] as RestPlugin["widgets"][number];

/** A plugin of before, which names one size and nothing of the family. */
const hello = plugin("hello", [
  { key: "latest", name: { en: "Latest" }, place: "home:bottom", size: "full" },
]);

describe("the front page's widgets (ADR-0059)", () => {
  it("starts from the manifests: every widget at its place, at the size it starts at, the one size of before read as one of the family", () => {
    expect(defaultArrangement([hr, hello])).toEqual([
      { plugin: "hr", widget: "balance", size: "small", place: "home:top" },
      { plugin: "hr", widget: "today", size: "medium", place: "home:top" },
      { plugin: "hello", widget: "latest", size: "wide", place: "home:bottom" },
    ]);
    const shown = arrangementShown([hr, hello], null);
    expect(shown.map((widget) => [widget.widget.key, widget.size, widget.place])).toEqual([
      ["balance", "small", "home:top"],
      ["today", "medium", "home:top"],
      ["latest", "wide", "home:bottom"],
    ]);
    expect(shown[2]?.sizes).toEqual(["wide"]);
  });

  it("shows the person's arrangement, dropping what they may no longer see and a size the widget no longer comes in", () => {
    const shown = arrangementShown(
      [hr],
      [
        { plugin: "hr", widget: "today", size: "large", place: "home:top" },
        { plugin: "crm", widget: "deals", size: "small" },
        { plugin: "hr", widget: "balance", size: "full" },
        { plugin: "hr", widget: "today", size: "small" },
      ],
    );
    expect(shown.map((widget) => [widget.widget.key, widget.size, widget.place])).toEqual([
      ["today", "large", "home:top"],
      ["balance", "small", "home:top"],
    ]);
  });

  it("is changed a step at a time: a size, a widget out, one in, one moved before another or to the end", () => {
    const whole = defaultArrangement([hr, hello]);
    const [balance, today, latest] = whole as [
      (typeof whole)[number],
      (typeof whole)[number],
      (typeof whole)[number],
    ];
    expect(resized(whole, today, "wide")[1]).toEqual({ ...today, size: "wide" });
    expect(removed(whole, balance).map((entry) => entry.widget)).toEqual(["today", "latest"]);
    expect(
      added(removed(whole, balance), { plugin: hr, widget: balanceWidget }, "home:bottom"),
    ).toEqual([today, latest, { ...balance, place: "home:bottom" }]);
    expect(added(whole, { plugin: hr, widget: balanceWidget }, "home:top")).toEqual(whole);
    expect(moved(whole, today, balance).map((entry) => entry.widget)).toEqual([
      "today",
      "balance",
      "latest",
    ]);
    expect(moved(whole, balance, undefined).map((entry) => entry.widget)).toEqual([
      "today",
      "latest",
      "balance",
    ]);
    expect(addable([hr, hello], removed(whole, latest)).map((w) => w.widget.key)).toEqual([
      "latest",
    ]);
  });
});
