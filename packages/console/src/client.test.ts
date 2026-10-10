import { describe, expect, it } from "vitest";
import { ApiError, createClient, type FetchLike } from "./client.js";

const PERSON = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: null,
  avatar: null,
  role: "member",
};

const PROJECT = {
  id: "0199c4d8-0000-7000-8000-000000000050",
  key: "web",
  name: "The web app",
  description: "",
  visibility: "private",
  skillsAddress: null,
  role: "owner",
  openDecisions: 0,
  openRuns: 0,
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
};

/** A fetch that answers from a table of routes and remembers what it was sent. */
function fakeFetch(answers: Record<string, { status?: number; body?: unknown }>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const send: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url}`;
    const answer = answers[key];
    if (answer === undefined) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: "Nothing." } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { send, calls };
}

describe("createClient", () => {
  it("asks under the base URL, parses the answer, and sends the cookie along", async () => {
    const { send, calls } = fakeFetch({
      "GET https://console.test/api/v1/me": {
        body: {
          workspace: { name: "Acme" },
          person: PERSON,
          signIn: [{ key: "gh", label: "GitHub" }],
        },
      },
    });
    const client = createClient({ baseUrl: "https://console.test/", fetch: send });
    const me = await client.me();
    expect(me.person?.login).toBe("alice");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
  });

  it("sends what changes as JSON, and names the project and the task in the path", async () => {
    const task = {
      id: "0199c4d8-0000-7000-8000-000000000010",
      number: 1,
      title: "Ship",
      body: "",
      state: "ready",
      priority: "normal",
      owner: PERSON,
      assignee: null,
      parentId: null,
      links: [],
      openDecisions: 0,
      openRuns: 0,
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    };
    const { send, calls } = fakeFetch({
      [`PATCH /api/v1/projects/web/tasks/${task.id}`]: { body: { ...task, state: "done" } },
    });
    const client = createClient({ fetch: send });
    const updated = await client.project("web").updateTask(task.id, { state: "done" });
    expect(updated.state).toBe("done");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ state: "done" }));
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
  });

  it("turns an error body into an ApiError with its code", async () => {
    const { send } = fakeFetch({
      "GET /api/v1/projects/web/tasks?state=done": {
        status: 401,
        body: { error: { code: "auth.required", message: "Sign in to continue." } },
      },
    });
    const client = createClient({ fetch: send });
    await expect(client.project("web").tasks({ state: "done" })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "auth.required",
    });
  });

  it("says when the server could not be reached, and when it answered nonsense", async () => {
    const down = createClient({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(down.me()).rejects.toMatchObject({ status: 0, code: "network" });

    const odd = createClient({ fetch: async () => new Response("<html>", { status: 200 }) });
    await expect(odd.me()).rejects.toMatchObject({ code: "invalid_response" });
    const wrong = createClient({
      fetch: async () => new Response(JSON.stringify({ person: 1 }), { status: 200 }),
    });
    await expect(wrong.me()).rejects.toBeInstanceOf(ApiError);
  });

  it("names where a project's feed is subscribed to, after a number, and narrows a read of it", async () => {
    const { send, calls } = fakeFetch({
      "GET https://console.test/api/v1/projects/web/events?after=0&task=0199c4d8-0000-7000-8000-000000000010":
        { body: { items: [], more: false } },
      "GET https://console.test/api/v1/events?after=7": { body: { items: [], more: false } },
    });
    const client = createClient({ baseUrl: "https://console.test", fetch: send });
    expect(client.project("web").eventStreamUrl(42)).toBe(
      "https://console.test/api/v1/projects/web/events/stream?after=42",
    );
    await client.project("web").events(0, { task: "0199c4d8-0000-7000-8000-000000000010" });
    await client.events(7);
    expect(calls.map((call) => call.url)).toEqual([
      "https://console.test/api/v1/projects/web/events?after=0&task=0199c4d8-0000-7000-8000-000000000010",
      "https://console.test/api/v1/events?after=7",
    ]);
  });

  it("names a document by its path as one segment of the URL, with the ways to its versions and files", async () => {
    const document = {
      id: "0199c4d8-0000-7000-8000-000000000060",
      path: "guides/onboarding",
      title: "Onboarding",
      version: 1,
      updatedBy: PERSON,
      agent: null,
      archivedAt: "2026-10-10T10:00:00.000Z",
      createdAt: "2026-10-10T10:00:00.000Z",
      updatedAt: "2026-10-10T10:00:00.000Z",
      body: "",
      createdBy: PERSON,
      links: [],
      backlinks: [],
      files: [],
    };
    const { send, calls } = fakeFetch({
      "GET /api/v1/projects/web/docs?folder=guides": {
        body: { folder: "guides", folders: [], items: [] },
      },
      "GET /api/v1/projects/web/docs?q=onboarding&archived=true": {
        body: { folder: "", folders: [], items: [] },
      },
      "GET /api/v1/projects/web/docs/guides%2Fonboarding/versions/2": {
        body: {
          number: 2,
          title: "Onboarding",
          author: PERSON,
          agent: null,
          createdAt: "2026-10-10T10:00:00.000Z",
          body: "# Hi",
        },
      },
      "POST /api/v1/projects/web/docs/guides%2Fonboarding/archive": { body: document },
      "PUT /api/v1/projects/web/docs/plan": { status: 201, body: { ...document, path: "plan" } },
    });
    const project = createClient({ fetch: send }).project("web");
    await project.documents({ folder: "guides" });
    // Words given, the folder is not looked at.
    await project.documents({ q: "onboarding", archived: true, folder: "guides" });
    expect((await project.documentVersion("guides/onboarding", 2)).body).toBe("# Hi");
    expect((await project.archiveDocument("guides/onboarding")).archivedAt).not.toBeNull();
    await project.writeDocument("plan", { title: "The plan", body: "" });
    expect(calls.map((call) => call.url)).toEqual([
      "/api/v1/projects/web/docs?folder=guides",
      "/api/v1/projects/web/docs?q=onboarding&archived=true",
      "/api/v1/projects/web/docs/guides%2Fonboarding/versions/2",
      "/api/v1/projects/web/docs/guides%2Fonboarding/archive",
      "/api/v1/projects/web/docs/plan",
    ]);
    expect(calls[4]?.init?.method).toBe("PUT");
    expect(project.documentFileUrl("guides/onboarding", "f1")).toBe(
      "/api/v1/projects/web/docs/guides%2Fonboarding/files/f1",
    );
  });

  it("lets an abort through as it is", async () => {
    const controller = new AbortController();
    const client = createClient({
      fetch: async (_url, init) => {
        controller.abort();
        throw init?.signal?.reason ?? new Error("aborted without a reason");
      },
    });
    await expect(client.me(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("presents a token as a bearer, leaves the cookies at home, and manages tokens", async () => {
    const token = {
      id: "0199c4d8-0000-7000-8000-000000000030",
      name: "ci",
      createdAt: "2026-10-09T10:00:00.000Z",
      expiresAt: "2027-01-07T10:00:00.000Z",
      lastUsedAt: null,
    };
    const { send, calls } = fakeFetch({
      "GET https://console.test/api/v1/tokens": { body: { items: [token] } },
      "POST https://console.test/api/v1/tokens": {
        status: 201,
        body: { token, secret: "cns_t_secret" },
      },
      [`DELETE https://console.test/api/v1/tokens/${token.id}`]: { status: 204 },
    });
    const client = createClient({
      baseUrl: "https://console.test",
      fetch: send,
      token: "cns_t_mine",
    });
    expect((await client.tokens()).items[0]?.name).toBe("ci");
    expect((await client.createToken({ name: "ci", expiresInDays: 90 })).secret).toBe(
      "cns_t_secret",
    );
    await client.revokeToken(token.id);
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer cns_t_mine");
      expect(call.init?.credentials).toBe("omit");
    }
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ name: "ci", expiresInDays: 90 }));
    expect(calls[2]?.init?.method).toBe("DELETE");
  });

  it("hands in a file as a form, named and typed, and says where its bytes are read", async () => {
    const run = {
      id: "0199c4d8-0000-7000-8000-000000000040",
      taskId: "0199c4d8-0000-7000-8000-000000000010",
      taskNumber: 1,
      person: PERSON,
      agent: "Claude Code",
      status: "running",
      startedAt: "2026-10-09T10:00:00.000Z",
      endedAt: null,
      summary: null,
      reports: [],
      artifacts: [
        {
          id: "0199c4d8-0000-7000-8000-000000000041",
          kind: "file",
          url: null,
          label: null,
          file: {
            name: "report.md",
            size: 5,
            contentType: "text/markdown",
            sha256: "ab".repeat(32),
          },
          createdAt: "2026-10-09T10:01:00.000Z",
        },
      ],
      waitingFor: null,
    };
    const { send, calls } = fakeFetch({
      [`POST https://console.test/api/v1/projects/web/runs/${run.id}/files`]: {
        status: 201,
        body: run,
      },
    });
    const client = createClient({ baseUrl: "https://console.test", fetch: send, token: "cns_t_x" });
    const project = client.project("web");
    const handed = await project.handInFile(run.id, {
      name: "report.md",
      bytes: new TextEncoder().encode("hello"),
      contentType: "text/markdown",
      label: "the report",
    });
    expect(handed.artifacts[0]?.file?.name).toBe("report.md");
    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    const part = form.get("file");
    expect(part).toBeInstanceOf(File);
    expect((part as File).name).toBe("report.md");
    expect((part as File).type).toBe("text/markdown");
    expect(await (part as File).text()).toBe("hello");
    expect(form.get("label")).toBe("the report");
    // The form names its own type, with the boundary in it; nothing else is said.
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBeNull();
    expect(project.fileUrl(run.artifacts[0]?.id ?? "")).toBe(
      "https://console.test/api/v1/projects/web/files/0199c4d8-0000-7000-8000-000000000041",
    );
  });

  it("names the person whose role changes", async () => {
    const { send, calls } = fakeFetch({
      [`PATCH /api/v1/people/${PERSON.id}`]: { body: { ...PERSON, role: "admin" } },
    });
    const client = createClient({ fetch: send });
    expect((await client.updatePerson(PERSON.id, { role: "admin" })).role).toBe("admin");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ role: "admin" }));
  });

  it("lists the projects, makes one, and manages one's settings and members", async () => {
    const member = { person: PERSON, role: "member", addedAt: "2026-10-09T10:00:00.000Z" };
    const { send, calls } = fakeFetch({
      "GET /api/v1/projects": { body: { items: [PROJECT] } },
      "POST /api/v1/projects": { status: 201, body: PROJECT },
      "GET /api/v1/projects/web": { body: PROJECT },
      "PATCH /api/v1/projects/web": { body: { ...PROJECT, name: "Web" } },
      "GET /api/v1/projects/web/members": { body: { items: [member] } },
      "POST /api/v1/projects/web/members": { status: 201, body: member },
      [`PATCH /api/v1/projects/web/members/${PERSON.id}`]: { body: { ...member, role: "owner" } },
      [`DELETE /api/v1/projects/web/members/${PERSON.id}`]: { status: 204 },
    });
    const client = createClient({ fetch: send });
    expect((await client.projects()).items[0]?.key).toBe("web");
    expect((await client.createProject({ key: "web", name: "The web app" })).id).toBe(PROJECT.id);
    const project = client.project("web");
    expect(project.key).toBe("web");
    expect((await project.get()).role).toBe("owner");
    expect((await project.update({ name: "Web" })).name).toBe("Web");
    expect((await project.members()).items[0]?.person.login).toBe("alice");
    expect((await project.addMember({ personId: PERSON.id, role: "member" })).role).toBe("member");
    expect((await project.updateMember(PERSON.id, { role: "owner" })).role).toBe("owner");
    await project.removeMember(PERSON.id);
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ key: "web", name: "The web app" }));
    expect(calls[5]?.init?.body).toBe(JSON.stringify({ personId: PERSON.id, role: "member" }));
    expect(calls[7]?.init?.method).toBe("DELETE");
  });
});
