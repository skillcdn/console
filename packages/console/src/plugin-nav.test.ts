import { describe, expect, it } from "vitest";
import { en } from "./i18n/en.js";
import { pluginNavItems } from "./plugin-nav.js";
import type { RestPlugin } from "./schemas.js";

const plugin = (
  key: string,
  extra: Partial<RestPlugin> & { readonly pages?: RestPlugin["pages"] } = {},
): RestPlugin => ({
  key,
  name: { en: key[0]?.toUpperCase() + key.slice(1), ko: `${key}-ko` },
  description: { en: "" },
  agentNote: null,
  version: "0.1.0",
  state: "enabled",
  problems: [],
  roles: ["user"],
  declaredRoles: [],
  defaultRole: null,
  menu: null,
  pages: [{ key: "home", name: { en: "Home" }, level: "workspace", wide: false }],
  widgets: [],
  board: null,
  boardNeeds: "none",
  capabilities: [],
  consent: null,
  projects: null,
  requires: {},
  dataVersion: 1,
  enabledAt: null,
  ...extra,
});

describe("pluginNavItems", () => {
  it("makes a tab of a plugin alone in its group, and a group tab with children for several", () => {
    const items = pluginNavItems({
      plugins: [
        plugin("leave", { menu: { group: "people", order: 10, name: null } }),
        plugin("crm", { menu: { group: "customers", order: 100, name: null } }),
        plugin("deals", { menu: { group: "customers", order: 50, name: null } }),
        plugin("off", { state: "disabled" }),
        plugin("nopage", { pages: [] }),
      ],
      level: "workspace",
      current: { plugin: "crm" },
      words: en,
      language: "en",
    });
    expect(items).toEqual([
      { href: "/plugins/leave/home", label: "Leave", current: false },
      {
        href: "/plugins/deals/home",
        label: "Customers",
        current: true,
        children: [
          { href: "/plugins/deals/home", label: "Deals", current: false },
          { href: "/plugins/crm/home", label: "Crm", current: true },
        ],
      },
    ]);
  });

  it("names a group the console does not know by the plugin's own name for it, in the person's language", () => {
    const items = pluginNavItems({
      plugins: [
        plugin("a", {
          menu: { group: "legal", order: 1, name: { en: "Legal", ko: "법무" } },
          description: { en: "Contracts", ko: "계약" },
        }),
        plugin("b", { menu: { group: "legal", order: 2, name: { en: "Legal", ko: "법무" } } }),
      ],
      level: "workspace",
      current: { plugin: undefined },
      words: en,
      language: "ko",
    });
    expect(items.map((item) => item.label)).toEqual(["법무"]);
    expect(items[0]?.children?.map((child) => child.label)).toEqual(["a-ko", "b-ko"]);
    // What each is, as its list says it under its name: none where the manifest says nothing.
    expect(items[0]?.children?.map((child) => child.description)).toEqual(["계약", undefined]);
  });

  it("shows on a project the plugins bound to it that have a project page, and nothing else", () => {
    const pages: RestPlugin["pages"] = [
      { key: "home", name: { en: "Home" }, level: "workspace", wide: false },
      { key: "board", name: { en: "On the board" }, level: "project", wide: true },
    ];
    const items = pluginNavItems({
      plugins: [plugin("leave", { pages }), plugin("audit", { pages })],
      level: "project",
      project: {
        key: "web",
        plugins: [
          {
            key: "leave",
            name: { en: "Leave" },
            agentNote: null,
            description: {},
            roles: ["user"],
          },
        ],
      },
      current: { plugin: undefined },
      words: en,
      language: "en",
    });
    expect(items).toEqual([
      { href: "/projects/web/plugins/leave/board", label: "Leave", current: false },
    ]);
  });
});
