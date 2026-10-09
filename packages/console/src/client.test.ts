import { describe, expect, it } from "vitest";
import { ApiError, createClient, type FetchLike } from "./client.js";

const PERSON = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: null,
  avatar: null,
  role: "member",
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
        body: { workspace: { name: "Acme" }, person: PERSON, signIn: "gh" },
      },
    });
    const client = createClient({ baseUrl: "https://console.test/", fetch: send });
    const me = await client.me();
    expect(me.person?.login).toBe("alice");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
  });

  it("sends what changes as JSON, and names the task in the path", async () => {
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
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    };
    const { send, calls } = fakeFetch({
      [`PATCH /api/v1/tasks/${task.id}`]: { body: { ...task, state: "done" } },
    });
    const client = createClient({ fetch: send });
    const updated = await client.updateTask(task.id, { state: "done" });
    expect(updated.state).toBe("done");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ state: "done" }));
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
  });

  it("turns an error body into an ApiError with its code", async () => {
    const { send } = fakeFetch({
      "GET /api/v1/tasks?state=done": {
        status: 401,
        body: { error: { code: "auth.required", message: "Sign in to continue." } },
      },
    });
    const client = createClient({ fetch: send });
    await expect(client.tasks({ state: "done" })).rejects.toMatchObject({
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

  it("names where the feed is subscribed to, after a number", () => {
    const client = createClient({ baseUrl: "https://console.test" });
    expect(client.eventStreamUrl(42)).toBe("https://console.test/api/v1/events/stream?after=42");
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

  it("names the person whose role changes", async () => {
    const { send, calls } = fakeFetch({
      [`PATCH /api/v1/people/${PERSON.id}`]: { body: { ...PERSON, role: "admin" } },
    });
    const client = createClient({ fetch: send });
    expect((await client.updatePerson(PERSON.id, { role: "admin" })).role).toBe("admin");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ role: "admin" }));
  });
});
