import { describe, expect, it } from "vitest";
import { currentTab, tabTitle } from "./tab-title.js";

describe("the browser tab's title", () => {
  it("names the page, the project and the workspace, the nearest first", () => {
    expect(tabTitle(["Board", "Ledger", "Acme"])).toBe("Board · Ledger · Acme");
  });

  it("says nothing for a part that is not there", () => {
    expect(tabTitle([undefined, undefined, "Acme"])).toBe("Acme");
    expect(tabTitle(["Settings", undefined, "Acme"])).toBe("Settings · Acme");
    expect(tabTitle(["  ", "", "Acme"])).toBe("Acme");
  });

  it("says a word once where a project is named as its workspace is", () => {
    expect(tabTitle(["Board", "Acme", "Acme"])).toBe("Board · Acme");
  });

  it("is empty where nothing is known yet", () => {
    expect(tabTitle([undefined])).toBe("");
  });
});

describe("the tab a page is under", () => {
  const tab = (label: string, current: boolean) => ({ href: `/${label}`, label, current });

  it("is the one marked current", () => {
    expect(currentTab([tab("Board", false), tab("Calendar", true)])).toBe("Calendar");
  });

  it("is the page of a group, where the group holds the current one", () => {
    const group = {
      ...tab("Operations", true),
      children: [tab("Leave", false), tab("Rooms", true)],
    };
    expect(currentTab([tab("Board", false), group])).toBe("Rooms");
  });

  it("is the group itself where none of its pages is marked", () => {
    const group = { ...tab("Operations", true), children: [tab("Leave", false)] };
    expect(currentTab([group])).toBe("Operations");
  });

  it("is nothing where no tab is current", () => {
    expect(currentTab([tab("Board", false)])).toBeUndefined();
    expect(currentTab([])).toBeUndefined();
  });
});
