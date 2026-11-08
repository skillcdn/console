import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsoleClient } from "../client.js";
import { en } from "../i18n/en.js";
import { KOREAN, LanguageContext } from "../i18n/index.js";
import type { RestPerson, RestPlugin, RestPluginDetail, RestProject } from "../schemas.js";
import { capabilityText, PluginSettingsView } from "./plugin-settings.js";

// The plugins' settings page (docs/specs/plugins.md, "The settings pages") as an administrator
// reads it, rendered in Korean: the capabilities by name with what each opens, the roles with
// who holds them, a secret with when it was set, the purge offered once the plugin is disabled.

const BOB = "0199c4d8-0000-7000-8000-000000000002";
const CAROL = "0199c4d8-0000-7000-8000-000000000003";
const DAVE = "0199c4d8-0000-7000-8000-000000000004";
const WEB = "0199c4d8-0000-7000-8000-000000000011";

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
      key: "botToken",
      type: "secret",
      name: { en: "Bot token" },
      description: null,
      required: false,
      default: null,
      min: null,
      max: null,
      options: null,
      of: null,
      set: true,
      value: null,
      setAt: "2026-11-02T02:00:00.000Z",
      expiresAt: "2026-11-02T14:00:00.000Z",
      source: "api.example.test",
      hosts: ["api.example.test"],
      use: null,
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
    {
      key: "hrContact",
      type: "person",
      name: { en: "HR contact" },
      description: null,
      required: false,
      default: null,
      min: null,
      max: null,
      options: null,
      of: null,
      set: true,
      value: BOB,
      setAt: null,
    },
    {
      key: "archive",
      type: "project",
      name: { en: "Archive project" },
      description: null,
      required: false,
      default: null,
      min: null,
      max: null,
      options: null,
      of: null,
      set: true,
      value: WEB,
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
    {
      id: "0199c4d8-0000-7000-8000-000000000032",
      role: "approver",
      person: null,
      project: null,
      everyone: false,
      plugin: "messenger",
      createdAt: "2026-11-02T01:00:00.000Z",
    },
  ],
  events: "/api/v1/plugins/leave/events",
  asks: [
    {
      plugin: "messenger",
      role: "carrier",
      why: { en: "To carry approvals out." },
      state: "ungranted",
    },
    { plugin: "crm", role: "reader", why: { en: "To read accounts." }, state: "unavailable" },
  ],
};

const PLUGINS = [
  { key: "messenger", name: { en: "Messenger" }, state: "enabled" },
  { key: "crm", name: { en: "CRM" }, state: "enabled" },
  { key: "leave", name: { en: "Leave" }, state: "enabled" },
  { key: "gate", name: { en: "Gate" }, state: "disabled" },
] as unknown as readonly RestPlugin[];

const PROJECTS = [
  { id: WEB, key: "web", name: "Web" },
  { id: "0199c4d8-0000-7000-8000-000000000012", key: "ops", name: "Ops" },
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
        plugins={PLUGINS}
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
    expect(html).toContain(">비활성화</button>");
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
    // A secret sealed from an answer says from where, until when, and where alone it goes.
    expect(html).toMatch(/api\.example\.test에서 받아 저장됨 · [^<]*만료/);
    expect(html).toContain("api.example.test에만 보냅니다.");
    // A person and a project are searched for (ADR-0037) and stand in the field's place, held as ids.
    expect(html).toMatch(/sc-picker-chosen[\s\S]*?Bob \(bob\)/);
    expect(html).toMatch(/sc-picker-chosen[\s\S]*?Web \(web\)/);
    expect(html).not.toContain(`<option value="${BOB}"`);
    // The roles: the default one is every member's; a grant is a chip with the way to revoke it.
    expect(html).toContain("직원");
    expect(html).toContain("모든 멤버");
    expect(html).toContain(">기본</span>");
    expect(html).toContain('aria-label="회수: Bob"');
    // A plugin holds a role as itself (ADR-0072): a chip of its own; the enabled plugins are
    // offered a role they do not hold, never the plugin itself or one that is off.
    expect(html).toContain('aria-label="회수: 플러그인 messenger"');
    // Whom to grant is searched for, one field per role (ADR-0037).
    expect(count(html, 'placeholder="부여할 대상…"')).toBe(2);
    // What it asks of other plugins: granted now where the plugin is enabled, waited for where not.
    expect(html).toContain("다른 플러그인에 요청한 역할");
    expect(html).toContain("지금 부여");
    expect(html).toContain("crm이(가) 꺼져 있습니다.");
    // The purge waits for the plugin to be disabled.
    expect(html).toContain("삭제하려면 먼저 비활성화하세요.");
    expect(html).not.toContain('placeholder="leave 입력"');
    // Nothing explains itself in a paragraph.
    expect(html).not.toContain("악의적");
  });

  it("draws a control per kind of setting, and divides the form into the groups declared", () => {
    const field = (extra: Record<string, unknown>) => ({
      description: null,
      required: false,
      default: null,
      min: null,
      max: null,
      options: null,
      of: null,
      set: false,
      value: null,
      setAt: null,
      ...extra,
    });
    const html = render({
      ...DETAIL,
      settings: [
        field({ key: "notice", type: "text", name: { en: "Notice" } }),
        field({
          key: "workdays",
          type: "list",
          of: "enum",
          name: { en: "Workdays", ko: "근무일" },
          options: [
            { value: "mon", name: { en: "Mon", ko: "월" } },
            { value: "tue", name: { en: "Tue", ko: "화" } },
            { value: "sat", name: { en: "Sat", ko: "토" } },
          ],
          value: ["mon", "tue"],
          set: true,
          group: "calendar",
        }),
        field({
          key: "approvers",
          type: "list",
          of: "person",
          name: { en: "Approvers" },
          value: [BOB],
          set: true,
          group: "policy",
        }),
        field({
          key: "holidays",
          type: "list",
          of: "day",
          name: { en: "Holidays" },
          group: "calendar",
        }),
        field({
          key: "requestBy",
          type: "time",
          name: { en: "Request by" },
          value: "18:00",
          set: true,
          group: "policy",
        }),
      ],
      settingGroups: [
        {
          key: "policy",
          name: { en: "Policy", ko: "규정" },
          description: { en: "How leave is approved." },
        },
        { key: "calendar", name: { en: "Calendar", ko: "달력" }, description: null },
      ],
    } as unknown as RestPluginDetail);
    // The groups, in order, after the ungrouped setting; each with its name in the person's language.
    const notice = html.indexOf("Notice");
    const policy = html.indexOf('<h3 class="sc-settings-group-title">규정</h3>');
    const calendar = html.indexOf('<h3 class="sc-settings-group-title">달력</h3>');
    expect(notice).toBeGreaterThan(-1);
    expect(policy).toBeGreaterThan(notice);
    expect(calendar).toBeGreaterThan(policy);
    expect(html).toContain("How leave is approved.");
    // A list of an enum: a pill per choice, the chosen ticked, named in the person's language.
    expect(count(html, 'class="sc-toggle-chip"')).toBe(3);
    expect(count(html, 'type="checkbox" checked=""')).toBe(2);
    expect(html).toContain("월");
    expect(html).not.toContain("mon, tue");
    // A list of people: the chosen as a chip, the rest searched for (ADR-0037) from a field at
    // the end of the row, a chip itself.
    expect(html).toContain('class="sc-chip-label">Bob (bob)');
    expect(html).toMatch(/class="sc-picker sc-picker-add"><input[^>]*placeholder="추가…"/);
    expect(html).not.toContain(`<option value="${CAROL}">carol</option>`);
    // A list of days: a date field that adds one; a time, with the time zone said.
    expect(html).toContain('type="date"');
    expect(html).toContain('type="time"');
    expect(html).toContain('value="18:00"');
    expect(html).toContain("워크스페이스 시간대 기준입니다.");
  });

  it("offers a disabled plugin the form that enables it: what it requires on and locked, the optional off until chosen, and the purge", () => {
    const html = render({
      ...DETAIL,
      state: "disabled",
      capabilities: ["board:read", "people:read"],
      optionalCapabilities: ["jobs", "files"],
      consent: ["board:read", "files"],
      board: null,
    });
    expect(html).not.toContain(">비활성화</button>");
    // What it requires is on and not the administrator's; of the optional, what was consented
    // to before is on; and the button does not wait for a tick.
    expect(html).toContain(">필수<");
    expect(html).toContain(">선택<");
    // Two more ticks: the roles the plugin asks of other plugins (ADR-0072), off until ticked,
    // the one whose plugin is not enabled locked off.
    expect(count(html, 'type="checkbox"')).toBe(6);
    expect(html).toContain("다른 플러그인에 요청한 역할");
    expect(html).toContain("crm이(가) 꺼져 있습니다.");
    expect(count(html, 'disabled="" checked=""')).toBe(2);
    expect(count(html, 'type="checkbox" checked=""')).toBe(1);
    expect(html).toContain(
      '<button type="submit" class="sc-button sc-button-primary">활성화</button>',
    );
    // A required board: a new project from the defaults, or an existing one; never none.
    expect(count(html, 'name="board"')).toBe(2);
    expect(html).toContain('value="leave-board"');
    // The purge, once the key is typed.
    expect(html).toContain('placeholder="leave 입력"');
    expect(html).not.toContain("삭제하려면 먼저 비활성화하세요.");
  });

  it("says that a role which follows the reporting line is held by whoever someone reports to (ADR-0068)", () => {
    const html = render({
      ...DETAIL,
      declaredRoles: [
        ...DETAIL.declaredRoles,
        {
          key: "manager",
          name: { en: "Manager", ko: "매니저" },
          description: { en: "Approves their people's leave.", ko: "팀원의 연차를 승인합니다." },
          follows: "reports",
        },
      ],
    });
    expect(html).toContain('<span class="sc-badge sc-badge-accent">보고 라인</span>');
    expect(html).toContain("누군가의 매니저인 사람");
  });

  it("says what the plugin keeps for a while only, and for how long", () => {
    const html = render({ ...DETAIL, keeps: [{ collection: "deliveries", days: 90 }] });
    expect(html).toContain("deliveries: 90일이 지나면 삭제");
    expect(render(DETAIL)).not.toContain("보관 기간");
  });

  it("tells an administrator when the plugin reads a time of day and the workspace has no time zone", () => {
    const html = render({ ...DETAIL, needsTimeZone: true });
    expect(html).toContain(
      "워크스페이스에 시간대가 없어서, 시간대를 정하기 전까지 이 플러그인의 시각은 UTC 기준으로 실행됩니다.",
    );
    expect(html).toContain('href="/settings?workspace"');
    expect(render(DETAIL)).not.toContain("UTC 기준으로 실행됩니다");
  });

  it("marks what a new version requires, and keeps what an enabled plugin can go without a choice", () => {
    const waiting = render({
      ...DETAIL,
      state: "needs_consent",
      capabilities: ["board:read", "people:read"],
      consent: ["board:read"],
    });
    expect(count(waiting, ">새 권한<")).toBe(1);
    const enabled = render({
      ...DETAIL,
      capabilities: ["board:read"],
      optionalCapabilities: ["jobs", "files"],
      consent: ["board:read", "files"],
    });
    expect(count(enabled, 'type="checkbox"')).toBe(2);
    expect(count(enabled, 'type="checkbox" checked=""')).toBe(1);
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
    expect(html).not.toContain(">활성화</button>");
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
