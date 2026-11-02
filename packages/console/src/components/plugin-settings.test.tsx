import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsoleClient } from "../client.js";
import { en } from "../i18n/en.js";
import { KOREAN, LanguageContext } from "../i18n/index.js";
import type { RestPerson, RestPluginDetail, RestProject } from "../schemas.js";
import { capabilityText, PluginSettingsView } from "./plugin-settings.js";

// The plugins' settings page (docs/specs/plugins.md, "The settings pages") as an administrator
// reads it, rendered in Korean: the capabilities by name with what each opens, the roles with
// who holds them, a secret with when it was set, the purge offered once the plugin is disabled.

const BOB = "0199c4d8-0000-7000-8000-000000000002";
const CAROL = "0199c4d8-0000-7000-8000-000000000003";
const DAVE = "0199c4d8-0000-7000-8000-000000000004";

const DETAIL: RestPluginDetail = {
  key: "leave",
  name: { en: "Leave", ko: "연차" },
  description: { en: "Leave requests and their approval." },
  agentNote: { en: "Requests leave with the command request." },
  version: "1.2.0",
  state: "enabled",
  problems: [],
  roles: ["employee", "approver"],
  declaredRoles: [
    {
      key: "employee",
      name: { en: "Employee", ko: "직원" },
      description: { en: "Requests leave.", ko: "연차를 신청합니다." },
    },
    {
      key: "approver",
      name: { en: "Approver", ko: "승인자" },
      description: { en: "Approves leave.", ko: "연차를 승인합니다." },
    },
  ],
  defaultRole: "employee",
  menu: null,
  pages: [],
  widgets: [],
  board: { key: "leave-board", name: "Leave" },
  boardNeeds: "required",
  capabilities: ["board:read", "board:decisions", "outbound:api.example.com"],
  consent: ["board:read", "board:decisions", "outbound:api.example.com"],
  projects: "all",
  requires: {},
  dataVersion: 1,
  enabledAt: "2026-11-02T01:00:00.000Z",
  operations: [
    { name: "request", kind: "command", about: "Requests leave.", args: {}, roles: ["employee"] },
  ],
  skills: null,
  boardDefaults: { key: "leave-board", name: { en: "Leave" }, description: { en: "" } },
  settings: [
    {
      key: "apiToken",
      type: "secret",
      name: { en: "API token" },
      description: null,
      required: false,
      default: null,
      min: null,
      max: null,
      options: null,
      of: null,
      set: true,
      value: null,
      setAt: "2026-11-02T01:00:00.000Z",
    },
    {
      key: "daysPerYear",
      type: "number",
      name: { en: "Days a year", ko: "연간 일수" },
      description: null,
      required: true,
      default: 15,
      min: 0,
      max: 60,
      options: null,
      of: null,
      set: true,
      value: 20,
      setAt: null,
    },
  ],
  grants: [
    {
      id: "0199c4d8-0000-7000-8000-000000000031",
      role: "approver",
      person: { id: BOB, login: "bob", name: "Bob" },
      project: null,
      everyone: false,
      createdAt: "2026-11-02T01:00:00.000Z",
    },
  ],
  events: "/api/v1/plugins/leave/events",
};

const PROJECTS = [
  { key: "web", name: "Web" },
  { key: "ops", name: "Ops" },
] as unknown as readonly RestProject[];

const PEOPLE = [
  { id: BOB, login: "bob", name: "Bob", status: "active" },
  { id: CAROL, login: "carol", name: null, status: "active" },
  { id: DAVE, login: "dave", name: "Dave", status: "deactivated" },
] as unknown as readonly RestPerson[];

const client = {
  plugin: () => ({ events: () => Promise.resolve({ items: [], more: false }) }),
} as unknown as ConsoleClient;

const count = (html: string, piece: string): number => html.split(piece).length - 1;

function render(detail: RestPluginDetail): string {
  return renderToStaticMarkup(
    <LanguageContext.Provider value={KOREAN}>
      <PluginSettingsView
        detail={detail}
        projects={PROJECTS}
        people={PEOPLE}
        language="ko"
        client={client}
        onChanged={() => Promise.resolve()}
        onPurged={() => undefined}
      />
    </LanguageContext.Provider>,
  );
}

describe("a plugin's settings page", () => {
  it("reads an enabled plugin at a glance: what it holds, who holds its roles, and the purge kept for later", () => {
    const html = render(DETAIL);
    // The head: the name in the person's language, the key and the version, the way to disable.
    expect(html).toContain('<h1 class="sc-page-title">연차</h1>');
    expect(html).toContain("<code>leave</code> 1.2.0");
    expect(html).toContain(">끄기</button>");
    // The rows: the board project, every project, the capabilities by name with what each opens.
    expect(html).toContain('Leave <span class="sc-muted">leave-board</span>');
    expect(html).toContain("모든 프로젝트");
    expect(html).toContain("보드 읽기");
    expect(html).toContain("api.example.com로 요청");
    expect(html).toContain("api.example.com에 https 요청을 보냅니다.");
    expect(html).toContain("<code>request</code>");
    expect(html).not.toContain("능력");
    // The settings: the number as it stands; the secret with when it was set and never its value.
    expect(html).toContain("연간 일수");
    expect(html).toContain('value="20"');
    expect(html).toContain("설정됨");
    expect(html).toContain('type="password"');
    // The roles: the default one is every member's; a grant is a chip with the way to revoke it.
    expect(html).toContain("직원");
    expect(html).toContain("모든 멤버");
    expect(html).toContain(">기본</span>");
    expect(html).toContain('aria-label="회수: Bob"');
    // Whoever holds a role is not offered it again; the deactivated are not offered at all.
    expect(count(html, `value="person:${BOB}"`)).toBe(1);
    expect(count(html, `value="person:${CAROL}"`)).toBe(2);
    expect(html).not.toContain(`value="person:${DAVE}"`);
    expect(html).toContain("carol</option>");
    // The purge waits for the plugin to be disabled.
    expect(html).toContain("끈 뒤에 지울 수 있습니다.");
    expect(html).not.toContain('placeholder="leave 입력"');
    // Nothing explains itself in a paragraph.
    expect(html).not.toContain("악의적");
  });

  it("offers a disabled plugin the form that enables it, what was consented to before ticked, and the purge", () => {
    const html = render({ ...DETAIL, state: "disabled", consent: ["board:read"], board: null });
    expect(html).not.toContain(">끄기</button>");
    // One box per capability, the one consented to before ticked; the button waits for the rest.
    expect(count(html, 'type="checkbox"')).toBe(3);
    expect(count(html, 'type="checkbox" checked=""')).toBe(1);
    expect(html).toContain(
      '<button disabled="" type="submit" class="sc-button sc-button-primary">켜기</button>',
    );
    // A required board: a new project from the defaults, or an existing one; never none.
    expect(count(html, 'name="board"')).toBe(2);
    expect(html).toContain('value="leave-board"');
    // The purge, once the key is typed.
    expect(html).toContain('placeholder="leave 입력"');
    expect(html).not.toContain("끈 뒤에 지울 수 있습니다.");
  });

  it("says why a plugin cannot run, and that a plugin without roles is every member's", () => {
    const html = render({
      ...DETAIL,
      state: "failed",
      problems: ["the server did not start"],
      declaredRoles: [],
      defaultRole: null,
      grants: [],
    });
    expect(html).toContain("실행할 수 없는 이유");
    expect(html).toContain("the server did not start");
    expect(html).toContain("역할이 없어 모든 멤버가 쓸 수 있습니다.");
    expect(html).not.toContain(">켜기</button>");
  });
});

describe("capabilityText", () => {
  it("names a capability of the catalogue, one with its parameter, and one it does not know by its key", () => {
    expect(capabilityText(en, "board:tasks")).toEqual({
      name: "Tasks",
      opens: "Creates tasks in its projects; changes, closes and comments on its own.",
    });
    expect(capabilityText(en, "outbound:api.example.com").name).toBe("Requests to api.example.com");
    expect(capabilityText(en, "plugins:crm").name).toBe("Plugin crm");
    expect(capabilityText(en, "weird:thing")).toEqual({ name: "weird:thing", opens: "" });
  });
});
