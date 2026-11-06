import { describe, expect, it } from "vitest";
import {
  legacyWidgetSize,
  localizedText,
  parsePluginManifest,
  RESERVED_PLUGIN_KEYS,
  widgetSizesOf,
} from "./manifest.js";

const LEAVE = {
  key: "leave",
  name: { en: "Leave", ko: "연차" },
  description: { en: "Leave requests, approvals and balances." },
  agentNote: { en: "Records leave requests and raises their approval as decisions." },
  pluginApi: 1,
  server: "dist/server/index.js",
  web: "dist/web",
  skills: "skills",
  capabilities: [
    "people:read",
    "board:decisions",
    "events:console",
    "jobs",
    "outbound:api.example.com",
  ],
  roles: {
    employee: { name: { en: "Employee" }, description: { en: "Requests leave." } },
    approver: { name: { en: "Approver" }, description: { en: "Sees every request." } },
  },
  defaultRole: "employee",
  board: {
    needs: "required",
    defaults: {
      key: "people-ops",
      name: { en: "People" },
      description: { en: "Leave and the people's matters." },
    },
  },
  settings: [
    {
      key: "daysPerYear",
      type: "number",
      name: { en: "Days per year" },
      default: 15,
      min: 0,
      max: 365,
    },
    { key: "approver", type: "person", name: { en: "Approver" }, required: true },
    { key: "token", type: "secret", name: { en: "Token" } },
    {
      key: "kinds",
      type: "list",
      of: "enum",
      name: { en: "Kinds" },
      options: [{ value: "paid", name: { en: "Paid" } }],
    },
  ],
  menu: { group: "people", order: 10 },
  pages: [
    { key: "mine", name: { en: "My leave" }, level: "workspace", roles: ["employee"] },
    {
      key: "requests",
      name: { en: "Requests" },
      level: "workspace",
      roles: ["approver"],
      wide: true,
    },
  ],
  widgets: [
    {
      key: "balance",
      name: { en: "Leave left" },
      place: "home:top",
      size: "third",
      roles: ["employee"],
    },
  ],
  dataVersion: 1,
};

function problemsOf(changes: Record<string, unknown>): readonly string[] {
  const result = parsePluginManifest({ ...LEAVE, ...changes });
  return result.ok ? [] : result.problems;
}

describe("parsePluginManifest", () => {
  it("reads the example of the specification and fills what is left out", () => {
    const result = parsePluginManifest(LEAVE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.requires).toEqual({});
      expect(result.manifest.capabilities).toContain("outbound:api.example.com");
    }
  });

  it("fills the defaults of the smallest manifest", () => {
    const result = parsePluginManifest({
      key: "hi",
      name: { en: "Hi" },
      description: { en: "Says hi." },
      pluginApi: 1,
      server: "dist/server/index.js",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toMatchObject({
        capabilities: [],
        roles: {},
        board: { needs: "none" },
        settings: [],
        pages: [],
        widgets: [],
        dataVersion: 1,
      });
    }
  });

  it("takes the consoles the plugin runs on as a semver range, and nothing else", () => {
    const result = parsePluginManifest({ ...LEAVE, console: ">=0.4.3 <0.6" });
    expect(result.ok && result.manifest.console).toBe(">=0.4.3 <0.6");
    expect(problemsOf({})).toEqual([]);
    expect(problemsOf({ console: ">=0.4.3 && <0.6" })[0]).toMatch(/^console: /);
    expect(problemsOf({ console: 7 })[0]).toMatch(/^console: /);
  });

  it("refuses a key that is malformed or reserved", () => {
    expect(problemsOf({ key: "Leave" })[0]).toMatch(/^key: /);
    expect(problemsOf({ key: "a" })[0]).toMatch(/^key: /);
    for (const reserved of ["plugins", "settings", "api", "frame"]) {
      expect(RESERVED_PLUGIN_KEYS).toContain(reserved);
      expect(problemsOf({ key: reserved })).toEqual(["key: is a word the console reserves"]);
    }
  });

  it("needs an English name within the bound", () => {
    expect(problemsOf({ name: { ko: "연차" } })).toEqual(["name: needs an English text under en"]);
    expect(problemsOf({ name: { en: "x".repeat(41) } })[0]).toMatch(/^name\.en: /);
    expect(problemsOf({ name: { en: `a${String.fromCodePoint(0x200b)}b` } })[0]).toMatch(
      /control characters/,
    );
  });

  it("takes a time of day, a list of an enum with a default, and groups the settings into those declared", () => {
    const grouped = {
      settings: [
        {
          key: "requestBy",
          type: "time",
          name: { en: "Request by" },
          default: "18:00",
          group: "policy",
        },
        {
          key: "workdays",
          type: "list",
          of: "enum",
          name: { en: "Workdays" },
          options: [
            { value: "mon", name: { en: "Mon" } },
            { value: "tue", name: { en: "Tue" } },
          ],
          default: ["mon", "tue"],
        },
      ],
      settingGroups: [{ key: "policy", name: { en: "Policy" } }],
    };
    expect(problemsOf(grouped)).toEqual([]);
    expect(
      problemsOf({ ...grouped, settings: [{ ...grouped.settings[0], default: "25:00" }] }),
    ).toEqual(["settings.0: the default is not a time"]);
    expect(problemsOf({ ...grouped, settingGroups: [] })).toEqual([
      "settings.requestBy names the group policy, which settingGroups does not declare",
    ]);
    expect(
      problemsOf({
        ...grouped,
        settingGroups: [
          { key: "policy", name: { en: "Policy" } },
          { key: "policy", name: { en: "Again" } },
        ],
      }),
    ).toEqual(["settingGroups: policy is declared twice"]);
  });

  it("holds the parts to each other", () => {
    expect(problemsOf({ defaultRole: "owner" })).toEqual([
      "defaultRole owner is not a declared role",
    ]);
    expect(problemsOf({ capabilities: ["people:read", "people:read"] })).toEqual([
      "capabilities: people:read is declared twice",
    ]);
    expect(problemsOf({ capabilities: ["network"] })).toEqual([
      "capabilities: network is not one the console knows",
    ]);
    expect(problemsOf({ capabilities: ["outbound:localhost"] })).toEqual([
      "capabilities: outbound:localhost is not one the console knows",
    ]);
    expect(
      problemsOf({
        pages: [{ key: "mine", name: { en: "Mine" }, level: "workspace", roles: ["boss"] }],
      }),
    ).toEqual(["pages.mine names the role boss, which is not declared"]);
    expect(problemsOf({ web: undefined })).toEqual([
      "pages and widgets need web, the directory of the bundle",
    ]);
    expect(problemsOf({ migrations: "migrations" })).toEqual([
      "migrations need the capability storage:sql",
    ]);
    expect(problemsOf({ menu: undefined })).toEqual(["pages need menu, the tab they are under"]);
    expect(problemsOf({ menu: { group: "custom" } })[0]).toMatch(
      /^menu: a group the console does not know needs a name/,
    );
    expect(problemsOf({ board: { needs: "none", defaults: LEAVE.board.defaults } })[0]).toMatch(
      /^board: /,
    );
  });

  it("gives a widget the sizes it comes in, and reads the one size of before as one of them", () => {
    const widget = (changes: Record<string, unknown>) =>
      problemsOf({ widgets: [{ key: "wid", name: { en: "W" }, place: "home:top", ...changes }] });
    expect(widget({ sizes: ["small", "medium"], defaultSize: "medium" })).toEqual([]);
    expect(widget({ size: "half" })).toEqual([]);
    expect(widget({})[0]).toMatch(/needs sizes/);
    expect(widget({ sizes: ["small", "small"] })[0]).toMatch(/names a size twice/);
    expect(widget({ sizes: ["small"], defaultSize: "wide" })[0]).toMatch(
      /defaultSize is not one of sizes/,
    );
    expect(widget({ sizes: ["huge"] })[0]).toMatch(/^widgets\.0\.sizes/);
    expect(widgetSizesOf({ size: "third" })).toEqual({ sizes: ["small"], defaultSize: "small" });
    expect(widgetSizesOf({ size: "full" })).toEqual({ sizes: ["wide"], defaultSize: "wide" });
    expect(widgetSizesOf({ sizes: ["large", "full"] })).toEqual({
      sizes: ["large", "full"],
      defaultSize: "large",
    });
    expect(legacyWidgetSize("large")).toBe("half");
    expect(legacyWidgetSize("full")).toBe("full");
  });

  it("refuses a page keyed as a route, and keys declared twice", () => {
    expect(
      problemsOf({ pages: [{ key: "frame", name: { en: "Frame" }, level: "workspace" }] })[0],
    ).toMatch(/^pages\.0\.key: /);
    expect(
      problemsOf({
        widgets: [
          { key: "aa", name: { en: "A" }, place: "home:top", size: "third" },
          { key: "aa", name: { en: "A" }, place: "home:bottom", size: "full" },
        ],
      }),
    ).toEqual(["widgets: aa is declared twice"]);
  });

  it("holds each setting to its type", () => {
    const setting = (changes: Record<string, unknown>) =>
      problemsOf({ settings: [{ key: "s", type: "text", name: { en: "S" }, ...changes }] })[0];
    expect(setting({ default: 3 })).toMatch(/the default is not a text/);
    expect(setting({ type: "boolean", min: 1 })).toMatch(/takes no min or max/);
    expect(setting({ type: "enum" })).toMatch(/an enum needs options/);
    expect(setting({ type: "list" })).toMatch(/a list needs of/);
    expect(setting({ type: "list", of: "list" })).toMatch(/^settings\.0\.of: /);
    expect(setting({ type: "person", default: "x" })).toMatch(/takes no default/);
    expect(setting({ type: "secret", default: "x" })).toMatch(/takes no default/);
    expect(setting({ type: "day", default: "2026-13-01" })).toMatch(/the default is not a day/);
    expect(setting({ type: "list", of: "number", default: [1, "2"] })).toMatch(
      /not a list of number/,
    );
    expect(setting({ type: "list", of: "number", default: [1, 2] })).toBeUndefined();
  });

  it("refuses what is not a manifest at all, and unknown fields", () => {
    expect(parsePluginManifest(null).ok).toBe(false);
    expect(parsePluginManifest("leave").ok).toBe(false);
    expect(problemsOf({ color: "red" })[0]).toMatch(/color/);
  });

  it("refuses a path that climbs out of the package", () => {
    expect(problemsOf({ server: "../other/index.js" })[0]).toMatch(/^server: /);
    expect(problemsOf({ server: "/etc/passwd" })[0]).toMatch(/^server: /);
  });
});

describe("localizedText", () => {
  it("answers the person's language, then English, then anything", () => {
    expect(localizedText({ en: "Leave", ko: "연차" }, "ko")).toBe("연차");
    expect(localizedText({ en: "Leave", ko: "연차" }, "ko-KR")).toBe("연차");
    expect(localizedText({ en: "Leave", ko: "연차" }, "fr")).toBe("Leave");
    expect(localizedText({ de: "Urlaub" }, "fr")).toBe("Urlaub");
    expect(localizedText({}, "en")).toBe("");
  });
});
