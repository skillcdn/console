import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsoleClient } from "./api.js";
import { createConsole, DEFAULT_COMPONENTS } from "./console.js";
import { matchRoute, signInFailureOf, taskHref, withoutSignInParam } from "./router.js";

describe("matchRoute", () => {
  it("knows the few pages there are, and nothing else", () => {
    expect(matchRoute("/")).toEqual({ name: "board" });
    expect(matchRoute("/decisions/")).toEqual({ name: "decisions" });
    expect(matchRoute("/feed")).toEqual({ name: "feed" });
    expect(matchRoute("/tokens")).toEqual({ name: "tokens" });
    expect(matchRoute("/people")).toEqual({ name: "people" });
    expect(matchRoute(taskHref("0199c4d8-0000-7000-8000-000000000010"))).toEqual({
      name: "task",
      id: "0199c4d8-0000-7000-8000-000000000010",
    });
    expect(matchRoute("/tasks/not-an-id")).toEqual({ name: "not-found" });
    expect(matchRoute("/elsewhere")).toEqual({ name: "not-found" });
  });

  it("reads why a sign-in did not complete off the page, and drops it afterwards", () => {
    expect(signInFailureOf("?sign_in=denied")).toBe("denied");
    expect(signInFailureOf("?sign_in=nonsense")).toBeUndefined();
    expect(signInFailureOf("")).toBeUndefined();
    expect(withoutSignInParam("/decisions", "?open=true&sign_in=denied")).toBe(
      "/decisions?open=true",
    );
    expect(withoutSignInParam("/", "?sign_in=denied")).toBe("/");
  });
});

describe("createConsole", () => {
  const never = (): Promise<never> => new Promise(() => undefined);
  const client: ConsoleClient = {
    me: never,
    people: never,
    updatePerson: never,
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
    fileUrl: (id) => `/api/v1/files/${id}`,
    endRun: never,
    events: never,
    eventStreamUrl: () => "/api/v1/events/stream",
    tokens: never,
    createToken: never,
    revokeToken: never,
    signOut: never,
  };

  it("assembles an app from the default components, and the ones a team replaces", () => {
    const { App } = createConsole({ client, title: "Acme" });
    const html = renderToStaticMarkup(<App initialPath="/" />);
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
