import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsoleClient, ProjectClient } from "./api.js";
import { createConsole, DEFAULT_COMPONENTS } from "./console.js";
import {
  connectHref,
  decisionHref,
  docHref,
  matchRoute,
  movedFrom,
  newDecisionHref,
  newTaskHref,
  personAgentsHref,
  projectHref,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
} from "./router.js";

const ID = "0199c4d8-0000-7000-8000-000000000010";

describe("matchRoute", () => {
  it("knows the workspace's pages, a project's under its key, and nothing else", () => {
    expect(matchRoute("/")).toEqual({ name: "projects" });
    expect(matchRoute("/projects/new")).toEqual({ name: "new-project" });
    expect(matchRoute("/people/")).toEqual({ name: "people" });
    expect(matchRoute("/agents")).toEqual({ name: "agents" });
    expect(matchRoute("/agents/new")).toEqual({ name: "new-token" });
    expect(matchRoute("/projects/web")).toEqual({ name: "board", project: "web" });
    expect(matchRoute("/projects/web/")).toEqual({ name: "board", project: "web" });
    expect(matchRoute("/projects/web/decisions/")).toEqual({ name: "decisions", project: "web" });
    expect(matchRoute("/projects/web-2/feed")).toEqual({ name: "feed", project: "web-2" });
    expect(matchRoute("/projects/web/skills")).toEqual({ name: "skills", project: "web" });
    expect(matchRoute("/projects/web/members")).toEqual({ name: "members", project: "web" });
    expect(matchRoute("/projects/web/settings")).toEqual({ name: "settings", project: "web" });
    expect(projectHref("web")).toBe("/projects/web");
    expect(projectHref("web", "feed")).toBe("/projects/web/feed");
    expect(matchRoute("/connect")).toEqual({ name: "connect", code: undefined });
    expect(matchRoute("/connect/abcd-efgh")).toEqual({ name: "connect", code: "abcd-efgh" });
    expect(connectHref("ABCD-EFGH")).toBe("/connect/ABCD-EFGH");
    expect(matchRoute(`/people/${ID}/agents`)).toEqual({ name: "person-agents", id: ID });
    expect(personAgentsHref(ID)).toBe(`/people/${ID}/agents`);
    for (const path of [
      "/connect/a/b",
      "/connect/not-a-code-at-all-too-long",
      "/people/x/agents",
      `/people/${ID}`,
      "/projects/Web",
      "/projects/-web",
      "/projects/web/tasks",
      "/projects/web/tasks/not-an-id",
      "/projects/web/tasks/0",
      "/projects/web/tasks/42/more",
      "/projects/web/decisions/x",
      "/projects/web/nothing",
      "/projects/web/feed/x",
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
    members: never,
    addMember: never,
    updateMember: never,
    removeMember: never,
    tasks: never,
    task: never,
    createTask: never,
    updateTask: never,
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
    endRun: never,
    events: never,
    eventStreamUrl: () => `/api/v1/projects/${key}/events/stream`,
    skills: never,
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
  });
  const client: ConsoleClient = {
    me: never,
    updateMe: never,
    people: never,
    updatePerson: never,
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
});
