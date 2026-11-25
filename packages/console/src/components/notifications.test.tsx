import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RestEvent, RestNotification, RestNotificationSettings } from "../api.js";
import { KOREAN, LanguageContext } from "../i18n/index.js";
import { matchRoute, PATHS } from "../router.js";
import {
  NotificationSettings,
  NotificationsMenu,
  type NotificationsMenuProps,
  TaskBell,
} from "./notifications.js";

// What a member is told of (ADR-0157), as the pages show it: a bell in the page's head with the
// list that opens under it, a notification a row said as the feed says the event, what they
// chose to be told of, and a task's own bell.

const alice = {
  id: "0195c0de-0000-7000-8000-000000000001",
  kind: "person",
  login: "alice",
  name: "Alice Example",
  avatarUrl: null,
  handle: null,
  title: null,
  avatar: null,
} as unknown as NonNullable<RestEvent["actor"]>;

const event = (over: Partial<RestEvent>): RestEvent => ({
  id: 7,
  kind: "task.commented",
  actor: alice,
  agent: null,
  projectId: "0195c0de-0000-7000-8000-00000000000a",
  taskId: "0195c0de-0000-7000-8000-00000000000b",
  decisionId: null,
  runId: null,
  documentId: null,
  goalId: null,
  plugin: null,
  data: { number: 12, title: "Fix the import", excerpt: "Is this still due?" },
  createdAt: "2026-11-24T02:58:00.000Z",
  ...over,
});

const notification = (over: Partial<RestNotification> = {}): RestNotification => ({
  id: "0195c0de-0000-7000-8000-0000000000aa",
  kind: "commented",
  followed: false,
  readAt: null,
  createdAt: "2026-11-24T02:58:00.000Z",
  event: event({}),
  project: { key: "ops", name: "Operations", color: null, symbol: null, icon: null },
  ...over,
});

/** The moment the list was read at when it opened. */
const SINCE = "2026-11-24T03:00:00.000Z";

describe("the bell a member's notifications open under", () => {
  const menu = (over: Partial<NotificationsMenuProps> = {}) =>
    renderToStaticMarkup(
      <NotificationsMenu
        unread={0}
        notifications={[]}
        href={() => undefined}
        settingsHref={PATHS.notificationSettings}
        onOpen={() => undefined}
        onNavigate={() => undefined}
        {...over}
      />,
    );
  const drawn = (items: readonly RestNotification[], href?: string) =>
    menu({ notifications: items, since: SINCE, href: () => href });

  it("is marked while something is not read, and says so to whoever does not see it", () => {
    const quiet = menu();
    expect(quiet).toContain('aria-label="Notifications"');
    expect(quiet).not.toContain("sc-nav-dot");
    const marked = menu({ unread: 3 });
    expect(marked).toContain('aria-label="Notifications, 3 new"');
    expect(marked).toMatch(
      /<summary[^>]*>.*<span class="sc-nav-dot" aria-hidden="true"><\/span><\/summary>/s,
    );
    expect(menu({ unread: 1 })).toContain('aria-label="Notifications, 1 new"');
  });

  it("leads to what the member chose to be told of, among the settings", () => {
    expect(menu()).toContain(
      '<a class="sc-menu-head-link" href="/settings/notifications">Settings</a>',
    );
  });

  it("says each as the feed says the event, with who did it, and why, where and when under it", () => {
    const seen = drawn([notification()], "/projects/ops/tasks/12");
    expect(seen).toContain('<ul class="sc-menu-rows" aria-label="Notifications">');
    expect(seen).toContain('<a class="sc-menu-row sc-menu-row-new" href="/projects/ops/tasks/12">');
    expect(seen).toContain('<span class="sc-menu-row-who">Alice Example</span>');
    expect(seen).toContain("commented on #12 Fix the import: Is this still due?");
    // Why and where, which give way where the row is narrow, then when, which does not.
    expect(seen).toContain(
      '<span class="sc-menu-row-facts"><span class="sc-menu-row-why">Comment · Operations</span><time',
    );
    expect(seen).toContain('dateTime="2026-11-24T02:58:00.000Z"');
  });

  it("marks what was new when the list opened, by when it was read, and nothing read before", () => {
    // Not read yet: it arrived as the list was being read.
    expect(drawn([notification()])).toContain('aria-label="New"');
    // Read at the moment the list opened: new until then.
    const opened = drawn([notification({ readAt: SINCE })]);
    expect(opened).toContain("sc-menu-row-new");
    expect(opened).toContain('aria-label="New"');
    // Read before: seen at an opening before this one.
    const before = drawn([notification({ readAt: "2026-11-24T02:59:59.999Z" })]);
    expect(before).not.toContain("sc-menu-row-new");
    expect(before).not.toContain('aria-label="New"');
    // With no moment of opening, only what is not read is new.
    expect(menu({ notifications: [notification({ readAt: SINCE })] })).not.toContain(
      "sc-menu-row-new",
    );
  });

  it("says a task the member turned on as one, a kind it has no word for as it came, and an agent's doing as its own", () => {
    expect(drawn([notification({ followed: true })])).toContain(
      "A task you turned on · Operations",
    );
    expect(drawn([notification({ kind: "mentioned", project: null })])).toContain(
      '<span class="sc-menu-row-why">mentioned</span>',
    );
    // What every object has is no word of the pack.
    expect(drawn([notification({ kind: "constructor", project: null })])).toContain(
      '<span class="sc-menu-row-why">constructor</span>',
    );
    const through = drawn([notification({ event: event({ agent: "Claude Code on a laptop" }) })]);
    expect(through).toContain("sc-feed-agent");
    // Where it leads nowhere the reader may go, it is a row and no link.
    expect(drawn([notification()])).toContain('<span class="sc-menu-row sc-menu-row-new">');
    // The console's own doing has nobody's picture, and is said as the console's.
    const own = drawn([notification({ event: event({ actor: null, kind: "task.archived" }) })]);
    expect(own).toContain("sc-menu-row-glyph");
    expect(own).toContain('<span class="sc-menu-row-who">The console</span>');
  });

  it("cuts a long title, comment or question short in the row, keeps it whole in the row's title, and never reads a text as markup", () => {
    const long = "x".repeat(300);
    const seen = drawn([
      notification({ event: event({ data: { number: 1, title: "t".repeat(90), excerpt: long } }) }),
    ]);
    expect(seen).toContain(`#1 ${"t".repeat(44)}…`);
    expect(seen).toContain(`${"x".repeat(72)}…`);
    // Whole where the pointer rests: the row's title.
    expect(seen).toContain(`title="commented on #1 ${"t".repeat(90)}: ${long}"`);
    const asked = drawn([
      notification({
        kind: "decision",
        event: event({ kind: "decision.raised", data: { question: "q".repeat(200) } }),
      }),
    ]);
    expect(asked).toContain(`${"q".repeat(72)}…`);
    const hostile = drawn([
      notification({
        event: event({ data: { number: 1, title: "<b>bold</b>", excerpt: "<script>x</script>" } }),
      }),
    ]);
    expect(hostile).not.toContain("<b>bold</b>");
    expect(hostile).not.toContain("<script>");
  });

  it("says that it is on its way, that there is nothing yet, what went wrong, and that there is more", () => {
    expect(menu({ notifications: undefined })).toContain("Loading your notifications");
    const empty = menu();
    expect(empty).toContain("No notifications yet");
    expect(empty).not.toContain("sc-menu-rows");
    expect(menu({ problem: "The notifications could not be loaded." })).toContain(
      '<p class="sc-menu-note" role="alert">The notifications could not be loaded.</p>',
    );
    const more = menu({ notifications: [notification()], more: true, onMore: () => undefined });
    expect(more).toContain('<button type="button" class="sc-menu-link">Show more</button>');
    expect(menu({ notifications: [notification()] })).not.toContain("Show more");
  });

  it("reads in Korean", () => {
    const seen = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <NotificationsMenu
          unread={2}
          notifications={[notification()]}
          href={() => undefined}
          settingsHref={PATHS.notificationSettings}
          onOpen={() => undefined}
          onNavigate={() => undefined}
        />
      </LanguageContext.Provider>,
    );
    expect(seen).toContain('aria-label="알림, 새 알림 2개"');
    expect(seen).toContain(">알림 설정</a>");
    expect(seen).toContain(">댓글 · Operations</span><time");
    expect(seen).toContain('aria-label="새 알림"');
  });
});

describe("what a member chose to be told of", () => {
  const settings = (over: Partial<RestNotificationSettings> = {}): RestNotificationSettings => {
    const defaults = {
      assigned: false,
      ready: false,
      moved: false,
      changed: false,
      commented: false,
      archived: false,
      decision: false,
      answered: false,
      agent: true,
    };
    return {
      kinds: defaults,
      defaults,
      projectsOff: [],
      ownAgents: false,
      ...over,
    };
  };
  const projects = [
    { key: "ops", name: "Operations" },
    { key: "lab", name: "Lab" },
  ];
  const drawn = (value: RestNotificationSettings, agent = false) =>
    renderToStaticMarkup(
      <NotificationSettings
        settings={value}
        projects={projects}
        agent={agent}
        onChange={() => undefined}
      />,
    );
  const chip = (label: string, checked: boolean) =>
    `<label class="sc-toggle-chip"><input type="checkbox"${checked ? ' checked=""' : ""}/>${label}</label>`;

  it("offers each kind as a choice that is lit while on, by what it is of", () => {
    const seen = drawn(settings({ kinds: { ...settings().kinds, commented: true } }));
    expect(seen).toContain(chip("Comment", true));
    expect(seen).toContain(chip("Given to you", false));
    expect(seen).toContain(chip("Your agent account", true));
    expect(seen.indexOf("Tasks")).toBeLessThan(seen.indexOf("Decisions"));
    expect(seen.indexOf("Decisions")).toBeLessThan(seen.indexOf("Agent accounts"));
  });

  it("has a row for each group of kinds, the projects and one's own agents, and none for a plugin", () => {
    const seen = drawn(settings({ kinds: { ...settings().kinds, commented: true } }));
    expect(seen.match(/class="sc-settings-row"/g)).toHaveLength(5);
    // What a plugin sends on of this is the plugin's own setting: nothing here names one.
    expect(seen).not.toMatch(/plugin|messenger/i);
  });

  it("offers each project on unless it was turned off, and nothing to reset where nothing was chosen", () => {
    const untouched = drawn(settings());
    expect(untouched).toContain(chip("Operations", true));
    expect(untouched).toMatch(/<button[^>]*disabled=""[^>]*>Back to the defaults<\/button>/);
    const off = drawn(settings({ projectsOff: [{ key: "lab", name: "Lab" }] }));
    expect(off).toContain(chip("Lab", false));
    expect(off).not.toMatch(/<button[^>]*disabled=""[^>]*>Back to the defaults<\/button>/);
  });

  it("offers a kind a newer console adds under its own name, and an agent account no choice of its own agents", () => {
    const newer = drawn(settings({ kinds: { ...settings().kinds, mentioned: true } }));
    expect(newer).toContain(chip("mentioned", true));
    expect(drawn(settings())).toContain("Tell me of what my agents do as me");
    const account = drawn(settings(), true);
    expect(account).not.toContain("Tell me of what my agents do as me");
    expect(account).toContain("wakes the account");
  });
});

describe("a task's own bell", () => {
  it("is lit while the task tells the reader something, struck through while it does not, and says what a press does", () => {
    const on = renderToStaticMarkup(<TaskBell on onChange={() => undefined} />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('aria-label="Turn this task&#x27;s notifications off"');
    expect(on).toContain('title="Notifications of this task are on"');
    const off = renderToStaticMarkup(<TaskBell on={false} onChange={() => undefined} />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('aria-label="Turn this task&#x27;s notifications on"');
    // Two glyphs, told apart by their lines: the bell that is off is struck through, and has
    // no tinted part.
    const STRUCK = '<path d="M3.5 3.5l13 13"></path>';
    expect(off).toContain(STRUCK);
    expect(on).not.toContain(STRUCK);
    expect(on).toContain("sc-icon-tint");
    expect(off).not.toContain("sc-icon-tint");
    expect(renderToStaticMarkup(<TaskBell on busy onChange={() => undefined} />)).toContain(
      'disabled=""',
    );
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <TaskBell on={false} onChange={() => undefined} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain('aria-label="이 작업의 알림 활성화"');
  });
});

describe("the address of what a member chose to be told of", () => {
  it("is a view of the settings, and the list has no page of its own", () => {
    expect(PATHS.notificationSettings).toBe("/settings/notifications");
    expect(matchRoute("/settings/notifications", "")).toEqual({ name: "notification-settings" });
    expect(matchRoute("/notifications", "")).toMatchObject({ name: "not-found" });
  });
});
