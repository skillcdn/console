import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsoleClient, ProjectClient } from "./api.js";
import { createConsole, DEFAULT_COMPONENTS } from "./console.js";
import {
  matchRoute,
  projectHref,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
} from "./router.js";

describe("matchRoute", () => {
  it("knows the workspace's pages, a project's under its key, and nothing else", () => {
    expect(matchRoute("/")).toEqual({ name: "projects" });
    expect(matchRoute("/tokens")).toEqual({ name: "tokens" });
    expect(matchRoute("/people/")).toEqual({ name: "people" });
    expect(matchRoute("/p/web")).toEqual({ name: "board", project: "web" });
    expect(matchRoute("/p/web/")).toEqual({ name: "board", project: "web" });
    expect(matchRoute("/p/web/decisions/")).toEqual({ name: "decisions", project: "web" });
    expect(matchRoute("/p/web-2/feed")).toEqual({ name: "feed", project: "web-2" });
    expect(matchRoute("/p/web/skills")).toEqual({ name: "skills", project: "web" });
    expect(matchRoute("/p/web/members")).toEqual({ name: "members", project: "web" });
    expect(matchRoute("/p/web/settings")).toEqual({ name: "settings", project: "web" });
    expect(matchRoute(taskHref("web", "0199c4d8-0000-7000-8000-000000000010"))).toEqual({
      name: "task",
      project: "web",
      id: "0199c4d8-0000-7000-8000-000000000010",
    });
    expect(projectHref("web")).toBe("/p/web");
    expect(projectHref("web", "feed")).toBe("/p/web/feed");
    for (const path of [
      "/p",
      "/p/",
      "/p/Web",
      "/p/-web",
      "/p/web/tasks",
      "/p/web/tasks/not-an-id",
      "/p/web/tasks/0199c4d8-0000-7000-8000-000000000010/more",
      "/p/web/nothing",
      "/p/web/feed/x",
      "/tasks/0199c4d8-0000-7000-8000-000000000010",
      "/elsewhere",
    ]) {
      expect(matchRoute(path), path).toEqual({ name: "not-found" });
    }
  });

  it("reads why a sign-in did not complete off the page, and drops it afterwards", () => {
    expect(signInFailureOf("?sign_in=denied")).toBe("denied");
    expect(signInFailureOf("?sign_in=nonsense")).toBeUndefined();
    expect(signInFailureOf("")).toBeUndefined();
    expect(withoutSignInParam("/p/web/decisions", "?open=true&sign_in=denied")).toBe(
      "/p/web/decisions?open=true",
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
  });
  const client: ConsoleClient = {
    me: never,
    people: never,
    updatePerson: never,
    projects: never,
    createProject: never,
    project,
    events: never,
    tokens: never,
    createToken: never,
    revokeToken: never,
    signOut: never,
  };

  it("assembles an app from the default components, and the ones a team replaces", () => {
    const { App } = createConsole({ client, title: "Acme" });
    const html = renderToStaticMarkup(<App initialPath="/p/web" />);
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
