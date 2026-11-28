import { agentPath, projectPath, REST_ROUTES, restMeSchema } from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import { PluginBoard } from "./board.js";

// The people a plugin reads through `ctx.console` (docs/specs/plugins.md, "The board"), where the
// console keeps its people apart (ADR-0035): a plugin that holds the whole directory reads the
// people its caller may see when it asks for them (ADR-0168), by the policy that decides the
// console's own listing. The board is called as the plugins' host calls it, with a caller of
// each kind, over people, projects and a team made through the API. On a database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let board: PluginBoard;
let alice: string;
const ids = new Map<string, string>();

const send = (cookie: string, method: string, path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const made = async (response: Response) => {
  expect(response.status, await response.clone().text()).toBeLessThan(300);
};
const idOf = (login: string): string => {
  const id = ids.get(login);
  if (id === undefined) {
    throw new Error(`nobody signed in as ${login}`);
  }
  return id;
};

const ALL = ["people:read", "people:read:all"];
/** A person's own call: from a page, or through their agent where one is named. */
const person = (login: string, agent: string | null = null) => ({
  kind: "person",
  person: { id: idOf(login), login, name: null, language: "en", admin: login === "alice" },
  agent,
  roles: ["member"],
  run: null,
  project: null,
});
/** A call another plugin makes: as itself, or for a person who did something elsewhere. */
const plugin = (login: string | null) => ({
  kind: "plugin",
  plugin: "audit",
  roles: ["member"],
  for: login === null ? null : { id: idOf(login), login, name: null, language: "en", admin: false },
  project: null,
});
/** The console itself: what a hook and a job are called as. */
const CONSOLE = { kind: "console", roles: ["member", "hr"], project: null };

/** One call on the board, as the plugins' host makes it for a plugin enabled by alice. */
const call = (
  caller: unknown,
  member: string,
  method: string,
  args: readonly unknown[],
  consent: readonly string[] = ALL,
) =>
  board.call(
    {
      key: "hr",
      manifest: { roles: { member: {}, hr: {} }, defaultRole: "member" },
      install: { projects: "all", boardProjectId: undefined, enabledBy: idOf("alice") },
      collections: [],
      caller,
      consent,
    } as never,
    member,
    method,
    args,
  );
const logins = (people: unknown): string[] =>
  (people as { login: string }[]).map((one) => one.login).toSorted();
const listed = async (caller: unknown, options?: unknown, consent?: readonly string[]) =>
  logins(
    await call(caller, "console.people", "list", options === undefined ? [] : [options], consent),
  );
const SEEN = { seenByCaller: true };
const EVERYONE = ["Alice", "acme-mira", "bob", "carol", "dana"];

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice", "bob", "carol", "dana"],
  });
  const cookies = new Map<string, string>();
  for (const login of ["alice", "bob", "carol", "dana"]) {
    const cookie = await h.signIn(login);
    cookies.set(login, cookie);
    const me = restMeSchema.parse(
      await (await h.request(REST_ROUTES.me, { headers: { cookie } })).json(),
    );
    ids.set(login, me.person?.id ?? "");
  }
  alice = cookies.get("alice") ?? "";
  // Two private projects: bob and carol work in one, dana in the other, alone.
  await h.project(alice, { key: "alpha", name: "Alpha", visibility: "private" });
  await h.project(alice, { key: "beta", name: "Beta", visibility: "private" });
  for (const [key, login] of [
    ["alpha", "bob"],
    ["alpha", "carol"],
    ["beta", "dana"],
  ] as const) {
    await made(
      await send(alice, "POST", projectPath(key, "members"), {
        personId: idOf(login),
        role: "member",
      }),
    );
  }
  // An agent account that starts in alpha, and reports to alice, who made it.
  await made(
    await send(alice, "POST", REST_ROUTES.agents, {
      host: "gh",
      login: "acme-mira",
      handle: "mira",
      name: "Mira",
      project: "alpha",
    }),
  );
  const mira = await h.signIn("acme-mira");
  const account = restMeSchema.parse(
    await (await h.request(REST_ROUTES.me, { headers: { cookie: mira } })).json(),
  );
  ids.set("mira", account.person?.id ?? "");
  expect((await h.request(agentPath("mira"), { headers: { cookie: alice } })).status).toBe(200);
  // Alice is listed in neither project from here on: hers to see as an administrator alone.
  for (const key of ["alpha", "beta"]) {
    await made(await send(alice, "DELETE", projectPath(key, "members", idOf("alice"))));
  }
  // A team across the two projects.
  await made(await send(alice, "POST", REST_ROUTES.teams, { key: "crew", name: "Crew" }));
  for (const login of ["bob", "dana"]) {
    await made(
      await send(alice, "POST", `${REST_ROUTES.teams}/crew/members`, { personId: idOf(login) }),
    );
  }
  // The console keeps its people apart.
  await made(
    await send(alice, "PATCH", REST_ROUTES.workspace, { peopleVisibility: "shared_projects" }),
  );
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  board = new PluginBoard({
    database: testDatabase.database,
    workspace: async () => workspace,
    clock: { now: () => new Date() },
  });
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

describe("the people a plugin with the whole directory reads for its caller (ADR-0168)", () => {
  it("answers everyone as it did where the read asks nothing, in a person's call and in the console's", async () => {
    expect(await listed(person("bob"))).toEqual(EVERYONE);
    expect(await listed(person("dana"), {})).toEqual(EVERYONE);
    expect(await listed(person("dana"), { seenByCaller: false })).toEqual(EVERYONE);
    expect(await listed(CONSOLE)).toEqual(EVERYONE);
    expect(await listed(plugin(null))).toEqual(EVERYONE);
    // A search narrows by words as before, with the option and without it.
    expect(await listed(person("bob"), { q: "dan" })).toEqual(["dana"]);
    expect(await listed(person("bob"), { q: "dan", ...SEEN })).toEqual([]);
    expect(await listed(person("bob"), { q: "car", ...SEEN })).toEqual(["carol"]);
  });

  it("answers the people the caller may see where the read asks for them: those of a shared project, themselves and the administrators", async () => {
    // Bob shares alpha with carol and the agent account; dana is in beta, which he is not in.
    expect(await listed(person("bob"), SEEN)).toEqual(["Alice", "acme-mira", "bob", "carol"]);
    // Dana shares a project with nobody: herself, and the administrator anyone may turn to.
    expect(await listed(person("dana"), SEEN)).toEqual(["Alice", "dana"]);
    // An administrator sees everyone, whatever the workspace says.
    expect(await listed(person("alice"), SEEN)).toEqual(EVERYONE);
    // An agent account is a member under the same rule: those of its project, and its manager.
    expect(await listed(person("mira"), SEEN)).toEqual(["Alice", "acme-mira", "bob", "carol"]);
    // A person's agent, with their token, reads what the person reads.
    expect(await listed(person("bob", "Codex on a laptop"), SEEN)).toEqual([
      "Alice",
      "acme-mira",
      "bob",
      "carol",
    ]);
    // It is the listing the console's own page of people shows that member.
    for (const login of ["bob", "dana"]) {
      const cookie = await h.signIn(login);
      const shown = (await (
        await h.request(REST_ROUTES.people, { headers: { cookie } })
      ).json()) as { items: { login: string }[] };
      expect(await listed(person(login), SEEN)).toEqual(logins(shown.items));
    }
  });

  it("answers a plugin that acts for a person what that person sees as a member, whatever they administer", async () => {
    expect(await listed(plugin("bob"), SEEN)).toEqual(["Alice", "acme-mira", "bob", "carol"]);
    // Alice as a member is in no project: herself, an administrator, and the account that
    // reports to her, whom a manager sees whatever the projects say.
    expect(await listed(plugin("alice"), SEEN)).toEqual(["Alice", "acme-mira"]);
  });

  it("refuses the read where there is no caller whose view it could be, and never answers everyone in its place", async () => {
    // A hook and a job are the console's own calls; a plugin as itself is nobody either.
    for (const caller of [CONSOLE, plugin(null)]) {
      for (const [member, method, args] of [
        ["console.people", "list", [SEEN]],
        ["console.people", "list", [{ q: "bob", ...SEEN }]],
        ["console.people", "get", [idOf("bob"), SEEN]],
        ["console.people", "granted", ["member", SEEN]],
        ["console.teams", "list", [SEEN]],
        ["console.teams", "get", ["crew", SEEN]],
      ] as const) {
        await expect(
          call(caller, member, method, args),
          `${member}.${method}`,
        ).rejects.toMatchObject({ code: "plugin.forbidden" });
      }
    }
    // A caller who is no person of the workspace any more is nobody: nothing is listed.
    const gone = {
      ...person("bob"),
      person: { ...person("bob").person, id: "0199c4d8-0000-7000-8000-00000000dead" },
    };
    await expect(call(gone, "console.people", "list", [SEEN])).rejects.toMatchObject({
      code: "plugin.forbidden",
    });
    // A value meant to narrow the read that is neither true nor false leaves it refused, not whole.
    for (const said of ["true", 1, null, {}, ["x"]]) {
      await expect(
        call(person("dana"), "console.people", "list", [{ seenByCaller: said }]),
        JSON.stringify(said),
      ).rejects.toMatchObject({ code: "plugin.invalid_args" });
    }
  });

  it("reads one person, who holds a role and the members of a team the same way", async () => {
    const got = async (caller: unknown, login: string, options?: unknown) =>
      (
        (await call(
          caller,
          "console.people",
          "get",
          options === undefined ? [idOf(login)] : [idOf(login), options],
        )) as { login: string } | null
      )?.login ?? null;
    expect(await got(person("bob"), "dana")).toBe("dana");
    expect(await got(person("bob"), "dana", SEEN)).toBeNull();
    expect(await got(person("bob"), "carol", SEEN)).toBe("carol");
    expect(await got(person("alice"), "dana", SEEN)).toBe("dana");
    // The default role is everyone's: among everyone, or among whom the caller sees.
    expect(logins(await call(person("dana"), "console.people", "granted", ["member"]))).toEqual(
      EVERYONE,
    );
    expect(
      logins(await call(person("dana"), "console.people", "granted", ["member", SEEN])),
    ).toEqual(["Alice", "dana"]);
    // A team's members are those among the people read.
    const members = async (caller: unknown, options?: unknown) =>
      (
        (await call(caller, "console.teams", "list", options === undefined ? [] : [options])) as {
          key: string;
          memberIds: string[];
        }[]
      ).map((team) => [team.key, team.memberIds.toSorted()]);
    const both = [idOf("bob"), idOf("dana")].toSorted();
    expect(await members(person("bob"))).toEqual([["crew", both]]);
    expect(await members(person("bob"), SEEN)).toEqual([["crew", [idOf("bob")]]]);
    expect(await members(person("dana"), SEEN)).toEqual([["crew", [idOf("dana")]]]);
    const crew = (await call(person("bob"), "console.teams", "get", ["crew", SEEN])) as {
      memberIds: string[];
    };
    expect(crew.memberIds).toEqual([idOf("bob")]);
    expect(
      (
        (await call(person("bob"), "console.teams", "get", ["crew"])) as { memberIds: string[] }
      ).memberIds.toSorted(),
    ).toEqual(both);
  });

  it("changes nothing for a plugin with people:read alone, whose reads are the caller's view already", async () => {
    const READ = ["people:read"];
    expect(await listed(person("bob"), undefined, READ)).toEqual([
      "Alice",
      "acme-mira",
      "bob",
      "carol",
    ]);
    expect(await listed(person("bob"), SEEN, READ)).toEqual(["Alice", "acme-mira", "bob", "carol"]);
    expect(await listed(person("dana"), SEEN, READ)).toEqual(["Alice", "dana"]);
    // A job reads nobody without the whole directory, with the option or without it.
    await expect(call(CONSOLE, "console.people", "list", [], READ)).rejects.toMatchObject({
      code: "plugin.forbidden",
    });
    await expect(call(CONSOLE, "console.people", "list", [SEEN], READ)).rejects.toMatchObject({
      code: "plugin.forbidden",
    });
  });

  it("says whether the console keeps its people apart, and answers everyone to everyone where it does not", async () => {
    const said = async () =>
      ((await call(CONSOLE, "console.workspace", "get", [])) as { peopleVisibility: string })
        .peopleVisibility;
    expect(await said()).toBe("shared_projects");
    await made(await send(alice, "PATCH", REST_ROUTES.workspace, { peopleVisibility: "everyone" }));
    try {
      expect(await said()).toBe("everyone");
      expect(await listed(person("dana"), SEEN)).toEqual(EVERYONE);
      // Still a person's view: a hook asks for nobody's.
      await expect(call(CONSOLE, "console.people", "list", [SEEN])).rejects.toMatchObject({
        code: "plugin.forbidden",
      });
    } finally {
      await made(
        await send(alice, "PATCH", REST_ROUTES.workspace, { peopleVisibility: "shared_projects" }),
      );
    }
  });
});
