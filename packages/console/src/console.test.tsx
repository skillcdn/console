import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsoleClient, ProjectClient } from "./api.js";
import {
  type CustomPage,
  createConsole,
  customPageLabel,
  DEFAULT_COMPONENTS,
  onlyOnOwnPages,
} from "./console.js";
import {
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
  newDecisionHref,
  newGoalHref,
  newTaskHref,
  personAgentsHref,
  personWorkHref,
  projectHref,
  projectSettingsHref,
  roadmapHref,
  settingsHref,
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
    expect(matchRoute("/agents")).toEqual({ name: "agents" });
    expect(matchRoute("/agents/new")).toEqual({ name: "new-token" });
    expect(matchRoute("/projects/web")).toEqual({ name: "board", project: "web", filter: {} });
    expect(matchRoute("/projects/web/")).toEqual({ name: "board", project: "web", filter: {} });
    expect(matchRoute("/work")).toEqual({ name: "work", week: undefined });
    expect(matchRoute("/work", "?week=2026-10-12")).toEqual({ name: "work", week: "2026-10-12" });
    expect(matchRoute("/work", "?week=next")).toEqual({ name: "not-found" });
    expect(workHref()).toBe("/work");
    expect(matchRoute("/decisions")).toEqual({ name: "my-decisions" });
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
    cancelWorkspacePackTokenConnection: never,
    people: never,
    findPerson: never,
    updatePerson: never,
    createListing: never,
    removeListing: never,
    projects: never,
    createProject: never,
    project,
    events: never,
    tokens: never,
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
    personWork: never,
    myDecisions: never,
  };

  it("assembles an app from the default components, and the ones a team replaces", () => {
    const { App } = createConsole({ client, title: "Acme" });
    const html = renderToStaticMarkup(<App initialPath="/projects/web" />);
    // Before the server has answered who is signed in, the page waits.
    expect(html).toContain("sc-loading");

    const custom = createConsole({
      client,
      components: { ...DEFAULT_COMPONENTS, SignIn: () => <p>custom sign-in</p> },
    });
    expect(typeof custom.App).toBe("function");
    expect(typeof custom.mount).toBe("function");
  });

  it("knows which pages a console that holds a token does not offer", () => {
    // The tokens themselves, and an agent's approval, are a person's own doing on the console's
    // own pages; configuring is the token's too, as its person's (ADR-0021).
    for (const path of ["/agents", "/agents/new"]) {
      expect(onlyOnOwnPages(matchRoute(path)), path).toBe(true);
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
