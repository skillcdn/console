import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsoleClient, ProjectClient, RestMe } from "./api.js";
import {
  type CustomPage,
  createConsole,
  customPageLabel,
  DEFAULT_COMPONENTS,
  languageToKeep,
  onlyOnOwnPages,
} from "./console.js";
import { ENGLISH, KOREAN } from "./i18n/index.js";
import {
  agentHref,
  agentsHref,
  agentWorkHref,
  boardHref,
  calendarHref,
  connectHref,
  customPageHref,
  decisionHref,
  decisionsHref,
  docHref,
  goalHref,
  matchRoute,
  movedFrom,
  myDecisionHref,
  newDecisionHref,
  newGoalHref,
  newTaskHref,
  personAgentsHref,
  personWorkHref,
  pluginHref,
  pluginSettingsHref,
  projectHref,
  projectSettingsHref,
  roadmapHref,
  settingsHref,
  setupHref,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
  workHref,
} from "./router.js";

const ID = "0199c4d8-0000-7000-8000-000000000010";

describe("matchRoute", () => {
  it("knows the workspace's pages, a project's under its key, and nothing else", () => {
    expect(matchRoute("/")).toEqual({ name: "projects" });
    expect(matchRoute("/projects/new")).toEqual({ name: "new-project" });
    expect(matchRoute("/people/")).toEqual({ name: "people" });
    expect(matchRoute("/people/new")).toEqual({ name: "new-listing" });
    // The teams are a view of the people's page (ADR-0073), with the form that makes one.
    expect(matchRoute("/people/teams")).toEqual({ name: "teams" });
    expect(matchRoute("/people/teams/new")).toEqual({ name: "new-team" });
    expect(matchRoute("/people/teams/other")).toEqual({ name: "not-found" });
    // The agents' page opens on the accounts that report to whoever looks; its other views are
    // named in the query, where no account's handle is taken for one.
    expect(matchRoute("/agents")).toEqual({ name: "agents", view: "mine" });
    expect(matchRoute("/agents", "?view=all")).toEqual({ name: "agents", view: "all" });
    expect(matchRoute("/agents", "?view=connected")).toEqual({ name: "agents", view: "connected" });
    expect(matchRoute("/agents", "?view=other")).toEqual({ name: "not-found" });
    expect(agentsHref()).toBe("/agents");
    expect(agentsHref("all")).toBe("/agents?view=all");
    expect(agentsHref("connected")).toBe("/agents?view=connected");
    expect(matchRoute("/agents/new")).toEqual({ name: "new-token" });
    // The form for an agent account (ADR-0084), under `new`, which no account's handle may be.
    expect(matchRoute("/agents/new/account")).toEqual({ name: "new-agent" });
    expect(matchRoute("/settings", "?services")).toEqual({
      name: "workspace-settings",
      form: "services",
    });
    expect(settingsHref("services")).toBe("/settings?services");
    // An agent account's page, by its handle, and its views.
    const agent = { name: "agent", handle: "mira", session: undefined, week: undefined };
    expect(matchRoute("/agents/mira")).toEqual({ ...agent, tab: "live" });
    expect(matchRoute("/agents/mira/")).toEqual({ ...agent, tab: "live" });
    expect(matchRoute("/agents/mira/sessions")).toEqual({ ...agent, tab: "sessions" });
    expect(matchRoute(`/agents/mira/sessions/${ID}`)).toEqual({
      ...agent,
      tab: "sessions",
      session: ID,
    });
    expect(matchRoute("/agents/mira/work", "?week=2026-11-09")).toEqual({
      ...agent,
      tab: "work",
      week: "2026-11-09",
    });
    expect(matchRoute("/agents/mira/settings")).toEqual({ ...agent, tab: "settings" });
    for (const path of [
      "/agents/Mira",
      "/agents/-mira",
      "/agents/me",
      "/agents/secrets",
      "/agents/mira/sessions/not-an-id",
      "/agents/mira/settings/more",
      "/agents/mira/work/more",
      "/agents/mira/elsewhere",
      `/agents/mira/sessions/${ID}/more`,
    ]) {
      expect(matchRoute(path), path).toEqual({ name: "not-found" });
    }
    expect(matchRoute("/agents/mira/work", "?week=soon")).toEqual({ name: "not-found" });
    expect(agentHref("mira")).toBe("/agents/mira");
    expect(agentHref("mira", "settings")).toBe("/agents/mira/settings");
    expect(agentHref("mira", "sessions", ID)).toBe(`/agents/mira/sessions/${ID}`);
    expect(agentWorkHref("mira", "2026-11-09")).toBe("/agents/mira/work?week=2026-11-09");
    expect(matchRoute("/projects/web")).toEqual({ name: "board", project: "web", filter: {} });
    expect(matchRoute("/projects/web/")).toEqual({ name: "board", project: "web", filter: {} });
    expect(matchRoute("/work")).toEqual({ name: "work", week: undefined });
    expect(matchRoute("/work", "?week=2026-10-12")).toEqual({ name: "work", week: "2026-10-12" });
    expect(matchRoute("/work", "?week=next")).toEqual({ name: "not-found" });
    expect(workHref()).toBe("/work");
    expect(matchRoute("/decisions")).toEqual({ name: "my-decisions" });
    // One decision wherever it is (ADR-0068), by its id alone.
    expect(matchRoute("/decisions/0199c4d8-0000-7000-8000-000000000030")).toEqual({
      name: "my-decision",
      id: "0199c4d8-0000-7000-8000-000000000030",
    });
    expect(matchRoute("/decisions/new")).toEqual({ name: "not-found" });
    expect(myDecisionHref("0199c4d8-0000-7000-8000-000000000030")).toBe(
      "/decisions/0199c4d8-0000-7000-8000-000000000030",
    );
    expect(workHref("2026-10-12")).toBe("/work?week=2026-10-12");
    expect(matchRoute("/categories")).toEqual({ name: "categories" });
    expect(matchRoute("/projects/web/roadmap")).toEqual({ name: "roadmap", project: "web" });
    expect(matchRoute("/projects/web/roadmap", "?from=2026-10")).toEqual({
      name: "roadmap",
      project: "web",
      from: "2026-10",
    });
    expect(matchRoute("/projects/web/roadmap", "?from=nope")).toEqual({ name: "not-found" });
    expect(roadmapHref("web", "2026-10")).toBe("/projects/web/roadmap?from=2026-10");
    expect(roadmapHref("web")).toBe("/projects/web/roadmap");
    expect(matchRoute("/projects/web/calendar")).toEqual({
      name: "calendar",
      project: "web",
      month: undefined,
      filter: {},
    });
    expect(matchRoute("/projects/web/decisions/")).toEqual({
      name: "decisions",
      project: "web",
      page: undefined,
    });
    // The record's page is in the address; the first has none, and a page that is not one is nothing.
    expect(matchRoute("/projects/web/decisions", "?page=3")).toEqual({
      name: "decisions",
      project: "web",
      page: 3,
    });
    expect(matchRoute("/projects/web/decisions", "?page=0")).toEqual({ name: "not-found" });
    expect(matchRoute("/projects/web/decisions", "?page=two")).toEqual({ name: "not-found" });
    expect(decisionsHref("web", 3)).toBe("/projects/web/decisions?page=3");
    expect(decisionsHref("web", 1)).toBe("/projects/web/decisions");
    expect(decisionsHref("web")).toBe("/projects/web/decisions");
    expect(matchRoute("/projects/web-2/feed")).toEqual({ name: "feed", project: "web-2" });
    expect(matchRoute("/projects/web/archive")).toEqual({ name: "archive", project: "web" });
    expect(projectHref("web", "archive")).toBe("/projects/web/archive");
    expect(matchRoute("/projects/web/skills")).toEqual({ name: "skills", project: "web" });
    expect(matchRoute("/projects/web/members")).toEqual({ name: "members", project: "web" });
    expect(matchRoute("/projects/web/settings")).toEqual({
      name: "settings",
      project: "web",
      form: undefined,
    });
    expect(matchRoute("/projects/web/settings", "?edit")).toEqual({
      name: "settings",
      project: "web",
      form: "edit",
    });
    expect(matchRoute("/projects/web/settings", "?rules")).toEqual({
      name: "settings",
      project: "web",
      form: "rules",
    });
    expect(projectSettingsHref("web")).toBe("/projects/web/settings");
    expect(projectSettingsHref("web", "pack-token")).toBe("/projects/web/settings?pack-token");
    expect(matchRoute("/projects/web/settings", "?pack-token")).toEqual({
      name: "settings",
      project: "web",
      form: "pack-token",
    });
    expect(projectSettingsHref("web", "rules")).toBe("/projects/web/settings?rules");
    expect(matchRoute("/settings")).toEqual({ name: "workspace-settings", form: undefined });
    expect(matchRoute("/settings", "?rules")).toEqual({
      name: "workspace-settings",
      form: "rules",
    });
    expect(matchRoute("/settings/rules")).toEqual({ name: "not-found" });
    expect(settingsHref()).toBe("/settings");
    expect(settingsHref("rules")).toBe("/settings?rules");
    expect(projectHref("web")).toBe("/projects/web");
    expect(projectHref("web", "feed")).toBe("/projects/web/feed");
    expect(matchRoute("/connect")).toEqual({ name: "connect", code: undefined });
    expect(matchRoute("/connect/abcd-efgh")).toEqual({ name: "connect", code: "abcd-efgh" });
    expect(connectHref("ABCD-EFGH")).toBe("/connect/ABCD-EFGH");
    // What an invitation's code opens (ADR-0088).
    expect(matchRoute("/setup/abcd-efgh")).toEqual({ name: "setup", code: "abcd-efgh" });
    expect(setupHref("ABCD-EFGH")).toBe("/setup/ABCD-EFGH");
    expect(matchRoute("/setup")).toEqual({ name: "not-found" });
    expect(matchRoute("/setup/a/b")).toEqual({ name: "not-found" });
    expect(matchRoute(`/people/${ID}/agents`)).toEqual({ name: "person-agents", id: ID });
    expect(personAgentsHref(ID)).toBe(`/people/${ID}/agents`);
    expect(matchRoute(`/people/${ID}/work`)).toEqual({
      name: "person-work",
      id: ID,
      week: undefined,
    });
    expect(matchRoute(`/people/${ID}/work`, "?week=2026-10-12")).toEqual({
      name: "person-work",
      id: ID,
      week: "2026-10-12",
    });
    expect(matchRoute(`/people/${ID}/work`, "?week=soon")).toEqual({ name: "not-found" });
    expect(personWorkHref(ID)).toBe(`/people/${ID}/work`);
    expect(personWorkHref(ID, "2026-10-12")).toBe(`/people/${ID}/work?week=2026-10-12`);
    for (const path of [
      "/connect/a/b",
      "/connect/not-a-code-at-all-too-long",
      "/people/x/agents",
      `/people/${ID}`,
      `/people/${ID}/work/x`,
      `/people/${ID}/plate`,
      "/projects/Web",
      "/projects/-web",
      "/projects/web/tasks",
      "/projects/web/tasks/not-an-id",
      "/projects/web/tasks/0",
      "/projects/web/tasks/42/more",
      "/projects/web/decisions/x",
      "/projects/web/nothing",
      "/projects/web/feed/x",
      "/projects/web/archive/x",
      "/projects/web/roadmap/x",
      "/projects/web/roadmap/new/x",
      "/projects/web/calendar/x",
      "/work/x",
      `/tasks/${ID}`,
      "/agents/x",
      "/elsewhere",
    ]) {
      expect(matchRoute(path), path).toEqual({ name: "not-found" });
    }
  });

  it("gives every form an address, and reads how a page is shown off the query", () => {
    expect(matchRoute(newTaskHref("web"))).toEqual({ name: "new-task", project: "web" });
    expect(taskHref("web", 42)).toBe("/projects/web/tasks/42");
    expect(taskHref("web", 42, "edit")).toBe("/projects/web/tasks/42?edit");
    expect(matchRoute("/projects/web/tasks/42")).toEqual({
      name: "task",
      project: "web",
      number: 42,
      id: undefined,
      form: undefined,
    });
    expect(matchRoute("/projects/web/tasks/42", "?ask")).toMatchObject({ number: 42, form: "ask" });
    // A link by id, as shared before: the page takes it to the number's address.
    expect(matchRoute(`/projects/web/tasks/${ID}`, "?edit")).toEqual({
      name: "task",
      project: "web",
      number: undefined,
      id: ID,
      form: "edit",
    });
    expect(matchRoute(newDecisionHref("web"))).toEqual({ name: "new-decision", project: "web" });
    expect(matchRoute(decisionHref("web", ID))).toEqual({
      name: "decision",
      project: "web",
      id: ID,
    });
    expect(matchRoute("/projects/web/docs")).toEqual({
      name: "docs",
      project: "web",
      path: "",
      view: { kind: "read" },
    });
    expect(matchRoute("/projects/web/docs/guides/onboarding/")).toMatchObject({
      path: "guides/onboarding",
      view: { kind: "read" },
    });
    expect(matchRoute("/projects/web/docs/guides/onboarding", "?version=3")).toMatchObject({
      view: { kind: "read", version: 3 },
    });
    expect(matchRoute("/projects/web/docs/guides/onboarding", "?edit")).toMatchObject({
      view: { kind: "edit" },
    });
    expect(matchRoute("/projects/web/docs/guides", "?new")).toMatchObject({
      path: "guides",
      view: { kind: "new" },
    });
    expect(matchRoute("/projects/web/docs", "?q=onboarding+steps")).toMatchObject({
      path: "",
      view: { kind: "search", q: "onboarding steps" },
    });
    // The root is no page: it is neither edited nor versioned.
    expect(matchRoute("/projects/web/docs", "?edit")).toEqual({ name: "not-found" });
    expect(matchRoute("/projects/web/docs", "?version=1")).toEqual({ name: "not-found" });
    expect(matchRoute("/projects/web/docs/Guides")).toEqual({ name: "not-found" });
    expect(docHref("web", "")).toBe("/projects/web/docs");
    expect(docHref("web", "guides/onboarding")).toBe("/projects/web/docs/guides/onboarding");
    expect(docHref("web", "guides/onboarding", { kind: "edit" })).toBe(
      "/projects/web/docs/guides/onboarding?edit",
    );
    expect(docHref("web", "guides", { kind: "new" })).toBe("/projects/web/docs/guides?new");
    expect(docHref("web", "", { kind: "search", q: "a b" })).toBe("/projects/web/docs?q=a%20b");
    expect(docHref("web", "plan", { kind: "read", version: 2 })).toBe(
      "/projects/web/docs/plan?version=2",
    );
  });

  it("reads the board's filters, the calendar's month and a goal's form off the query", () => {
    expect(matchRoute("/projects/web", "?category=engineering&mine")).toEqual({
      name: "board",
      project: "web",
      filter: { category: "engineering", mine: true },
    });
    expect(matchRoute("/projects/web", `?goal=${ID}&person=${ID}`)).toMatchObject({
      filter: { goal: ID, person: ID },
    });
    // A value that is not one is left out, never carried.
    expect(matchRoute("/projects/web", "?category=Not%20A%20Key&person=bob&goal=7")).toMatchObject({
      filter: {},
    });
    expect(matchRoute("/projects/web", "?category=&goal=")).toMatchObject({
      filter: { category: "", goal: "" },
    });
    // The words typed travel as they are, bounded; blank ones are no narrowing.
    expect(matchRoute("/projects/web", "?q=alice%20%235")).toMatchObject({
      filter: { words: "alice #5" },
    });
    expect(matchRoute("/projects/web", "?q=%20%20")).toMatchObject({ filter: {} });
    expect(
      matchRoute("/projects/web", `?q=${"x".repeat(300)}`) as { filter: { words: string } },
    ).toMatchObject({ filter: { words: "x".repeat(200) } });
    expect(boardHref("web", { words: "alice #5" })).toBe("/projects/web?q=alice%20%235");
    expect(boardHref("web", {})).toBe("/projects/web");
    expect(boardHref("web", { category: "engineering", mine: true })).toBe(
      "/projects/web?category=engineering&mine",
    );
    expect(boardHref("web", { goal: "", person: ID })).toBe(`/projects/web?goal=&person=${ID}`);
    const [narrowedPath = "", narrowedQuery = ""] = boardHref("web", {
      category: "",
      person: ID,
    }).split("?");
    expect(matchRoute(narrowedPath, `?${narrowedQuery}`)).toMatchObject({
      filter: { category: "", person: ID },
    });
    expect(matchRoute("/projects/web/calendar", "?month=2026-10")).toEqual({
      name: "calendar",
      project: "web",
      month: "2026-10",
      filter: {},
    });
    expect(matchRoute("/projects/web/calendar", "?month=2026-13")).toEqual({ name: "not-found" });
    expect(calendarHref("web")).toBe("/projects/web/calendar");
    expect(calendarHref("web", "2026-10")).toBe("/projects/web/calendar?month=2026-10");
    expect(calendarHref("web", "2026-10", { category: "design", mine: true })).toBe(
      "/projects/web/calendar?month=2026-10&category=design&mine",
    );
    expect(calendarHref("web", undefined, { goal: "" })).toBe("/projects/web/calendar?goal=");
    expect(matchRoute("/projects/web/calendar", "?month=2026-10&category=design&mine")).toEqual({
      name: "calendar",
      project: "web",
      month: "2026-10",
      filter: { category: "design", mine: true },
    });
    expect(matchRoute(newGoalHref("web"))).toEqual({ name: "new-goal", project: "web" });
    expect(goalHref("web", ID)).toBe(`/projects/web/roadmap/${ID}`);
    expect(goalHref("web", ID, { form: "edit" })).toBe(`/projects/web/roadmap/${ID}?edit`);
    expect(matchRoute(`/projects/web/roadmap/${ID}`, "?edit")).toEqual({
      name: "goal",
      project: "web",
      id: ID,
      form: "edit",
      view: "board",
      month: undefined,
    });
    // The views of a goal's tasks: the board without a word, the others named, the calendar on a month.
    expect(goalHref("web", ID, { view: "board" })).toBe(`/projects/web/roadmap/${ID}`);
    expect(goalHref("web", ID, { view: "calendar", month: "2026-11" })).toBe(
      `/projects/web/roadmap/${ID}?view=calendar&month=2026-11`,
    );
    expect(matchRoute(`/projects/web/roadmap/${ID}`, "?view=list")).toMatchObject({
      name: "goal",
      view: "list",
      month: undefined,
    });
    expect(matchRoute(`/projects/web/roadmap/${ID}`, "?view=calendar&month=2026-11")).toMatchObject(
      { view: "calendar", month: "2026-11" },
    );
    expect(matchRoute(`/projects/web/roadmap/${ID}`, "?view=nope")).toEqual({ name: "not-found" });
    expect(matchRoute(`/projects/web/roadmap/${ID}`, "?month=nope")).toEqual({ name: "not-found" });
  });

  it("knows the pages a console adds of its own, on the workspace and on a project, and the words of their tabs", () => {
    expect(matchRoute("/pages/reports")).toEqual({
      name: "custom",
      level: "workspace",
      page: "reports",
    });
    expect(matchRoute("/projects/web/pages/reports")).toEqual({
      name: "custom",
      level: "project",
      project: "web",
      page: "reports",
    });
    expect(matchRoute("/pages/Not-A-Key")).toEqual({ name: "not-found" });
    expect(matchRoute("/pages/reports/more")).toEqual({ name: "not-found" });
    expect(matchRoute("/projects/web/pages")).toEqual({ name: "not-found" });
    expect(customPageHref("reports")).toBe("/pages/reports");
    expect(customPageHref("reports", "web")).toBe("/projects/web/pages/reports");
    const page: CustomPage = {
      key: "reports",
      label: { en: "Reports", fr: "Rapports" },
      level: "workspace",
      render: () => null,
    };
    expect(customPageLabel(page, "fr-CA")).toBe("Rapports");
    expect(customPageLabel(page, "ko")).toBe("Reports");
    expect(customPageLabel({ ...page, label: "Reports" }, "fr")).toBe("Reports");
    expect(customPageLabel({ ...page, label: { de: "Berichte" } }, "fr")).toBe("Berichte");
    expect(customPageLabel({ ...page, label: {} }, "fr")).toBe("reports");
  });

  it("knows the plugins' pages and settings (ADR-0054): the first page, a page, what follows it, on a project too", () => {
    expect(matchRoute("/plugins/leave")).toEqual({
      name: "plugin",
      level: "workspace",
      plugin: "leave",
      page: undefined,
      rest: "",
    });
    expect(matchRoute("/plugins/leave/requests/2026/11")).toEqual({
      name: "plugin",
      level: "workspace",
      plugin: "leave",
      page: "requests",
      rest: "/2026/11",
    });
    expect(matchRoute("/projects/web/plugins/leave/board")).toEqual({
      name: "plugin",
      level: "project",
      project: "web",
      plugin: "leave",
      page: "board",
      rest: "",
    });
    expect(matchRoute("/plugins/Leave")).toEqual({ name: "not-found" });
    expect(matchRoute("/plugins/leave/Nope")).toEqual({ name: "not-found" });
    expect(pluginHref("leave")).toBe("/plugins/leave");
    expect(pluginHref("leave", "requests", undefined, "/2026")).toBe(
      "/plugins/leave/requests/2026",
    );
    expect(pluginHref("leave", "board", "web")).toBe("/projects/web/plugins/leave/board");
    expect(matchRoute("/settings/plugins")).toEqual({
      name: "plugins-settings",
      plugin: undefined,
    });
    expect(matchRoute("/settings/plugins/leave")).toEqual({
      name: "plugins-settings",
      plugin: "leave",
    });
    expect(matchRoute("/settings/plugins/leave/more")).toEqual({ name: "not-found" });
    expect(pluginSettingsHref()).toBe("/settings/plugins");
    expect(pluginSettingsHref("leave")).toBe("/settings/plugins/leave");
    // The person's own sessions, a view of the settings (board #309).
    expect(matchRoute("/settings/sessions")).toEqual({ name: "sessions" });
    expect(matchRoute("/settings/sessions/more")).toEqual({ name: "not-found" });
  });

  it("takes the addresses of the line before to the new ones", () => {
    expect(movedFrom("/p/web/decisions")).toBe("/projects/web/decisions");
    expect(movedFrom("/tokens")).toBe("/agents");
    expect(movedFrom("/projects")).toBe("/");
    expect(movedFrom("/people")).toBeUndefined();
    expect(matchRoute(`/p/web/tasks/${ID}`, "?edit")).toEqual({
      name: "moved",
      to: `/projects/web/tasks/${ID}?edit`,
    });
    expect(matchRoute("/p/web/")).toEqual({ name: "moved", to: "/projects/web" });
    expect(matchRoute("/tokens")).toEqual({ name: "moved", to: "/agents" });
    expect(matchRoute("/projects/")).toEqual({ name: "moved", to: "/" });
  });

  it("reads why a sign-in did not complete off the page, and drops it afterwards", () => {
    expect(signInFailureOf("?sign_in=denied")).toBe("denied");
    expect(signInFailureOf("?sign_in=nonsense")).toBeUndefined();
    expect(signInFailureOf("")).toBeUndefined();
    expect(withoutSignInParam("/projects/web/decisions", "?open=true&sign_in=denied")).toBe(
      "/projects/web/decisions?open=true",
    );
    expect(withoutSignInParam("/", "?sign_in=denied")).toBe("/");
  });
});

/** A sign-in page a team puts in place of the default one; a component of its own, not one made in the test. */
const CustomSignIn = () => <p>custom sign-in</p>;

describe("createConsole", () => {
  const never = (): Promise<never> => new Promise(() => undefined);
  const project = (key: string): ProjectClient => ({
    key,
    get: never,
    update: never,
    setIcon: never,
    removeIcon: never,
    setPackToken: never,
    removePackToken: never,
    connectPackToken: never,
    packTokenConnection: never,
    claimPackTokenConnection: never,
    cancelPackTokenConnection: never,
    skill: never,
    skillFile: never,
    skillBrowse: never,
    skillFind: never,
    members: never,
    addMember: never,
    updateMember: never,
    removeMember: never,
    tasks: never,
    task: never,
    createTask: never,
    updateTask: never,
    archiveTask: never,
    restoreTask: never,
    archiveTasksOfGoal: never,
    decisions: never,
    decision: never,
    awaitDecision: never,
    raiseDecision: never,
    answerDecision: never,
    runs: never,
    run: never,
    startRun: never,
    report: never,
    handIn: never,
    handInFile: never,
    fileUrl: (id: string) => `/api/v1/projects/${key}/files/${id}`,
    readFile: never,
    comments: never,
    comment: never,
    endRun: never,
    events: never,
    eventStreamUrl: () => `/api/v1/projects/${key}/events/stream`,
    skills: never,
    rules: never,
    updateDecision: never,
    addressDecision: never,
    documents: never,
    document: never,
    writeDocument: never,
    archiveDocument: never,
    restoreDocument: never,
    documentVersions: never,
    documentVersion: never,
    attachFile: never,
    documentFileUrl: (path: string, id: string) =>
      `/api/v1/projects/${key}/docs/${encodeURIComponent(path)}/files/${id}`,
    goals: never,
    goal: never,
    createGoal: never,
    updateGoal: never,
  });
  const client: ConsoleClient = {
    me: never,
    updateMe: never,
    updateWorkspace: never,
    setWorkspacePackToken: never,
    removeWorkspacePackToken: never,
    connectWorkspacePackToken: never,
    workspacePackTokenConnection: never,
    claimWorkspacePackTokenConnection: never,
    pictureUrl: (url: string) => `/api/v1/pictures?src=${encodeURIComponent(url)}`,
    cancelWorkspacePackTokenConnection: never,
    people: never,
    findPerson: never,
    updatePerson: never,
    createListing: never,
    removeListing: never,
    agents: never,
    agent: never,
    createAgent: never,
    updateAgent: never,
    agentProposals: never,
    manager: never,
    sendSignal: never,
    agentInvitation: never,
    inviteAgent: never,
    revokeAgentInvitation: never,
    agentSetup: never,
    signalFileUrl: () => "",
    readSignalFile: never,
    signals: never,
    runnerHeartbeat: never,
    raiseWake: never,
    signalStream: () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    }),
    beginAgentSession: never,
    sendTranscript: never,
    uploadTranscriptFile: never,
    endAgentSession: never,
    agentSessions: never,
    agentSession: never,
    transcript: never,
    transcriptStreamUrl: () => "",
    transcriptText: never,
    transcriptFileUrl: () => "",
    sealTranscriptEvent: never,
    agentSignIns: never,
    endAgentSignIn: never,
    secrets: never,
    secret: never,
    setSecret: never,
    removeSecret: never,
    agentSecrets: never,
    seedAgentSecret: never,
    removeAgentSecret: never,
    agentSecretAccesses: never,
    teams: never,
    createTeam: never,
    renameTeam: never,
    removeTeam: never,
    addTeamMember: never,
    removeTeamMember: never,
    projects: never,
    createProject: never,
    project,
    events: never,
    tokens: never,
    sessions: never,
    endSession: never,
    endOtherSessions: never,
    createToken: never,
    revokeToken: never,
    personTokens: never,
    revokePersonToken: never,
    connect: never,
    connectRequest: never,
    approveConnection: never,
    denyConnection: never,
    claimConnection: never,
    signOut: never,
    categories: never,
    createCategory: never,
    updateCategory: never,
    removeCategory: never,
    rules: never,
    writeRules: never,
    archiveRules: never,
    rulesVersions: never,
    giveUpToken: never,
    work: never,
    plate: never,
    personWork: never,
    personPlate: never,
    myDecisions: never,
    decision: never,
    awaitDecision: never,
    answerDecision: never,
    decisionFileUrl: (decisionId: string, fileId: string) =>
      `/api/v1/decisions/${decisionId}/files/${fileId}`,
    readDecisionFile: never,
    plugins: never,
    plugin: () => {
      throw new Error("no plugins in this test");
    },
  };

  it("assembles an app from the default components, and the ones a team replaces", () => {
    const { App } = createConsole({ client, title: "Acme" });
    const html = renderToStaticMarkup(<App initialPath="/projects/web" />);
    // Before the server has answered who is signed in, the page waits.
    expect(html).toContain("sc-loading");

    const custom = createConsole({
      client,
      components: { ...DEFAULT_COMPONENTS, SignIn: CustomSignIn },
    });
    expect(typeof custom.App).toBe("function");
    expect(typeof custom.mount).toBe("function");
  });

  it("keeps the language a person is first seen in, and never one over theirs (ADR-0065)", () => {
    const me = (fields: Partial<RestMe>) =>
      ({ person: { id: ID }, language: null, ...fields }) as RestMe;
    const both = [ENGLISH, KOREAN];
    expect(languageToKeep(me({}), ["ko-KR", "en"], both)).toBe("ko");
    expect(languageToKeep(me({ language: "en" }), ["ko"], both)).toBeUndefined();
    expect(languageToKeep(me({ person: null }), ["ko"], both)).toBeUndefined();
    expect(languageToKeep(undefined, ["ko"], both)).toBeUndefined();
    // What the console falls back on is not what the person's browser asked for.
    expect(languageToKeep(me({}), ["fr"], both)).toBeUndefined();
    expect(languageToKeep(me({}), ["ko"], [ENGLISH])).toBeUndefined();
  });

  it("knows which pages a console that holds a token does not offer", () => {
    // The tokens themselves, and an agent's approval, are a person's own doing on the console's
    // own pages; configuring is the token's too, as its person's (ADR-0021).
    for (const path of ["/agents/new", "/settings/sessions"]) {
      expect(onlyOnOwnPages(matchRoute(path)), path).toBe(true);
    }
    // The agent accounts are members anyone reads, with a token too (ADR-0084); the page then
    // shows them alone, and making one is an administrator's on a token as on a session.
    for (const path of ["/agents", "/agents/new/account"]) {
      expect(onlyOnOwnPages(matchRoute(path)), path).toBe(false);
    }
    expect(onlyOnOwnPages(matchRoute(`/people/${ID}/agents`))).toBe(true);
    expect(onlyOnOwnPages(matchRoute("/connect/abcd-efgh"))).toBe(true);
    // The board and everything on it is the token's to work, as its person.
    for (const path of [
      "/",
      "/people",
      "/people/new",
      "/work",
      "/categories",
      "/projects/web",
      "/projects/web/tasks/new",
      "/projects/web/members",
      "/projects/web/roadmap",
      "/projects/web/calendar",
      "/projects/new",
      "/projects/web/settings",
      "/settings",
    ]) {
      expect(onlyOnOwnPages(matchRoute(path)), path).toBe(false);
    }
  });
});
