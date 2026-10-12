import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { getSchemaStatus, migrateDatabase } from "./migrate.js";
import {
  createCategory,
  findCategory,
  listCategories,
  removeCategory,
  updateCategory,
} from "./queries/categories.js";
import {
  answerDecision,
  DecisionError,
  getDecision,
  listDecisions,
  raiseDecision,
} from "./queries/decisions.js";
import { EVENTS_CHANNEL, latestEventId, listEventsAfter, type Scope } from "./queries/events.js";
import { createGoal, getGoal, listGoals, updateGoal } from "./queries/goals.js";
import { findPerson, listPeople, type PersonRecord, savePerson } from "./queries/people.js";
import {
  addMember,
  createProject,
  findProjectFor,
  listMembers,
  listProjectsFor,
  ProjectError,
  removeMember,
  updateMember,
  updateProject,
} from "./queries/projects.js";
import { endRun, excerptOf, listRuns, RunError, startRun } from "./queries/runs.js";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  deleteSessionsOf,
  findSession,
  touchSession,
} from "./queries/sessions.js";
import {
  createTask,
  getTask,
  listSubtasks,
  listTasks,
  TaskError,
  updateTask,
} from "./queries/tasks.js";
import {
  createToken,
  deleteExpiredTokens,
  deleteToken,
  findToken,
  listTokensOf,
  TokenError,
  touchToken,
} from "./queries/tokens.js";
import { ensureWorkspace } from "./queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let database: Database;
let workspaceId: string;
/** The project the board's tests work in. */
let scope: Scope;
let alice: PersonRecord;
let bob: PersonRecord;

const T0 = new Date("2026-01-01T00:00:00Z");
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

/** A sign-in that was let in: nobody here is deactivated. */
function signedIn<T>(result: T | "deactivated"): T {
  if (result === "deactivated") {
    throw new Error("the person is deactivated");
  }
  return result;
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
  workspaceId = (await ensureWorkspace(database, { name: "Acme", now: T0 })).id;
  alice = signedIn(
    await savePerson(database, {
      workspaceId,
      host: "gh",
      source: "listed",
      account: {
        hostAccountId: "1001",
        login: "Alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice.png",
      },
      now: T0,
    }),
  ).person;
  bob = signedIn(
    await savePerson(database, {
      workspaceId,
      host: "gh",
      source: "listed",
      account: { hostAccountId: "1002", login: "bob", name: undefined, avatarUrl: undefined },
      now: T0,
    }),
  ).person;
  const project = await createProject(database, {
    workspaceId,
    actor: { id: alice.id },
    person: alice,
    project: { key: "web", name: "The web app", visibility: "workspace" },
    now: T0,
  });
  scope = { workspaceId, projectId: project.id };
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("migrations", () => {
  it("are applied, idempotently, and readiness sees the schema as current", async () => {
    const first = await migrateDatabase(testDatabase.connectionString);
    const second = await migrateDatabase(testDatabase.connectionString);
    // The latest migration this build ships, whichever it is: the names change with the schema.
    expect(first.latest).toMatch(/^\d{4}_\w+$/);
    expect(second.latest).toBe(first.latest);
    expect(await getSchemaStatus(database)).toEqual({ current: true, expected: first.latest });
    expect(await database.ping()).toBe(true);
  });
});

describe("the workspace", () => {
  it("is one row, renamed by configuration and never duplicated", async () => {
    const again = await ensureWorkspace(database, { name: "Acme Labs", now: minutes(1) });
    expect(again.id).toBe(workspaceId);
    expect(again.name).toBe("Acme Labs");
  });
});

describe("people", () => {
  it("join once, keyed by the host's id, and keep their id through a rename", async () => {
    const renamed = signedIn(
      await savePerson(database, {
        workspaceId,
        host: "gh",
        source: "listed",
        account: {
          hostAccountId: "1001",
          login: "alice-renamed",
          name: "Alice",
          avatarUrl: undefined,
        },
        now: minutes(2),
      }),
    );
    expect(renamed.joined).toBe(false);
    expect(renamed.person.id).toBe(alice.id);
    expect(renamed.person.login).toBe("alice-renamed");
    expect(renamed.person.avatarUrl).toBeUndefined();
    // Back to how the rest of the file knows her.
    alice = signedIn(
      await savePerson(database, {
        workspaceId,
        host: "gh",
        source: "listed",
        account: {
          hostAccountId: "1001",
          login: "Alice",
          name: "Alice Example",
          avatarUrl: "https://avatars.example/alice.png",
        },
        now: minutes(3),
      }),
    ).person;
    expect(await findPerson(database, workspaceId, alice.id)).toEqual(alice);
    expect(await findPerson(database, workspaceId, "0199c4d8-0000-7000-8000-000000000099")).toBe(
      undefined,
    );
    expect((await listPeople(database, workspaceId)).map((person) => person.login)).toEqual([
      "Alice",
      "bob",
    ]);
  });

  it("are told to the board when they join, and not again", async () => {
    const { items } = await listEventsAfter(database, { workspaceId, projectId: null }, 0, 100);
    const joined = items.filter((event) => event.kind === "person.joined");
    expect(joined.map((event) => event.actor?.id)).toEqual([alice.id, bob.id]);
  });
});

describe("sessions", () => {
  it("are found by the hash of their token while they last, and touched by use", async () => {
    await createSession(database, {
      personId: alice.id,
      tokenHash: "hash-a",
      expiresAt: minutes(60),
      now: T0,
    });
    const found = await findSession(database, "hash-a", minutes(30));
    expect(found?.person.id).toBe(alice.id);
    expect(found?.expiresAt).toEqual(minutes(60));
    expect(await findSession(database, "hash-a", minutes(60))).toBeUndefined();
    expect(await findSession(database, "hash-b", T0)).toBeUndefined();

    await touchSession(database, found?.id ?? "", { now: minutes(30), expiresAt: minutes(90) });
    const touched = await findSession(database, "hash-a", minutes(61));
    expect(touched?.lastSeenAt).toEqual(minutes(30));
    expect(touched?.expiresAt).toEqual(minutes(90));
  });

  it("end when deleted, when the person signs out of everything, and when time has ended them", async () => {
    await createSession(database, {
      personId: bob.id,
      tokenHash: "hash-bob-1",
      expiresAt: minutes(60),
      now: T0,
    });
    await createSession(database, {
      personId: bob.id,
      tokenHash: "hash-bob-2",
      expiresAt: minutes(5),
      now: T0,
    });
    expect(await deleteSession(database, "hash-bob-1")).toBe(true);
    expect(await deleteSession(database, "hash-bob-1")).toBe(false);
    expect(await deleteExpiredSessions(database, minutes(10))).toBe(1);
    await createSession(database, {
      personId: bob.id,
      tokenHash: "hash-bob-3",
      expiresAt: minutes(60),
      now: T0,
    });
    expect(await deleteSessionsOf(database, bob.id)).toBe(1);
    expect(await findSession(database, "hash-bob-3", T0)).toBeUndefined();
  });
});

describe("tasks", () => {
  it("are numbered in order, with defaults for what was not said", async () => {
    const first = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Write the release notes" },
      now: minutes(10),
    });
    const second = await createTask(database, {
      scope,
      actor: bob,
      task: {
        title: "Ship",
        body: "# Plan",
        state: "ready",
        priority: "high",
        assigneeId: alice.id,
        links: [{ url: "https://github.com/acme/app/pull/1", label: null }],
      },
      now: minutes(11),
    });
    expect([first.number, second.number]).toEqual([1, 2]);
    expect(first).toMatchObject({
      title: "Write the release notes",
      body: "",
      state: "idea",
      priority: "normal",
      owner: alice,
      assignee: undefined,
      parentId: undefined,
      links: [],
      openDecisions: 0,
      createdAt: minutes(10),
    });
    expect(second).toMatchObject({
      state: "ready",
      priority: "high",
      owner: bob,
      assignee: alice,
      links: [{ url: "https://github.com/acme/app/pull/1", label: null }],
    });
    expect(await getTask(database, scope, second.id)).toEqual(second);
    expect((await listTasks(database, scope, { limit: 10 })).items.map((t) => t.number)).toEqual([
      2, 1,
    ]);
    expect(
      (await listTasks(database, scope, { state: "ready", limit: 10 })).items.map((t) => t.number),
    ).toEqual([2]);
    // A page at a time: the next page begins where the last one ended, and says when nothing follows.
    const firstPage = await listTasks(database, scope, { limit: 1 });
    expect(firstPage.items.map((t) => t.number)).toEqual([2]);
    expect(firstPage.more).toBe(true);
    const secondPage = await listTasks(database, scope, { limit: 1, offset: 1 });
    expect(secondPage.items.map((t) => t.number)).toEqual([1]);
    expect(secondPage.more).toBe(false);
  });

  it("refuse an assignee who is not of the workspace, and a parent that is not a task", async () => {
    await expect(
      createTask(database, {
        scope,
        actor: alice,
        task: { title: "x", assigneeId: "0199c4d8-0000-7000-8000-000000000099" },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "task.invalid_assignee" });
    await expect(
      createTask(database, {
        scope,
        actor: alice,
        task: { title: "x", parentId: "0199c4d8-0000-7000-8000-000000000099" },
        now: T0,
      }),
    ).rejects.toBeInstanceOf(TaskError);
    // In a private project, only those listed may be assigned; and its tasks are numbered on their own.
    const own = await createProject(database, {
      workspaceId,
      actor: { id: alice.id },
      person: alice,
      project: { key: "own", name: "Alice's own" },
      now: T0,
    });
    const inOwn = { workspaceId, projectId: own.id };
    await expect(
      createTask(database, {
        scope: inOwn,
        actor: alice,
        task: { title: "x", assigneeId: bob.id },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "task.invalid_assignee" });
    const first = await createTask(database, {
      scope: inOwn,
      actor: alice,
      task: { title: "The first of its own", assigneeId: alice.id },
      now: T0,
    });
    expect(first.number).toBe(1);
    expect(await getTask(database, scope, first.id)).toBeUndefined();
    expect(await getTask(database, inOwn, first.id)).toMatchObject({ number: 1 });
  });

  it("record a move and an edit as the events they are, and nothing for no change", async () => {
    const task = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Review the design" },
      now: minutes(20),
    });
    const before = await latestEventId(database, workspaceId);

    const moved = await updateTask(database, {
      scope,
      actor: bob,
      taskId: task.id,
      patch: { state: "in_progress" },
      now: minutes(21),
    });
    expect(moved.state).toBe("in_progress");
    expect(moved.updatedAt).toEqual(minutes(21));

    const edited = await updateTask(database, {
      scope,
      actor: bob,
      taskId: task.id,
      patch: { title: "Review the design, again", assigneeId: bob.id, priority: "urgent" },
      now: minutes(22),
    });
    expect(edited).toMatchObject({ title: "Review the design, again", assignee: bob });

    const same = await updateTask(database, {
      scope,
      actor: bob,
      taskId: task.id,
      patch: { priority: "urgent" },
      now: minutes(23),
    });
    expect(same.updatedAt).toEqual(minutes(22));

    const { items } = await listEventsAfter(database, scope, before, 100);
    expect(items.map((event) => [event.kind, event.data])).toEqual([
      [
        "task.moved",
        { number: task.number, title: "Review the design", from: "idea", to: "in_progress" },
      ],
      [
        "task.updated",
        {
          number: task.number,
          title: "Review the design, again",
          fields: ["title", "priority", "assigneeId"],
        },
      ],
    ]);
    expect(items.every((event) => event.actor?.id === bob.id && event.taskId === task.id)).toBe(
      true,
    );
    await expect(
      updateTask(database, {
        scope,
        actor: bob,
        taskId: "0199c4d8-0000-7000-8000-000000000099",
        patch: { state: "done" },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "task.not_found" });
  });

  it("break down into subtasks, but never into a loop", async () => {
    const parent = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Launch" },
      now: minutes(30),
    });
    const child = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Write the announcement", parentId: parent.id },
      now: minutes(31),
    });
    const grandchild = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Draft it", parentId: child.id },
      now: minutes(32),
    });
    expect((await listSubtasks(database, scope, parent.id, 10)).map((t) => t.id)).toEqual([
      child.id,
    ]);
    for (const parentId of [parent.id, grandchild.id]) {
      await expect(
        updateTask(database, {
          scope,
          actor: alice,
          taskId: parent.id,
          patch: { parentId },
          now: minutes(33),
        }),
      ).rejects.toMatchObject({ code: "task.invalid_parent" });
    }
    const detached = await updateTask(database, {
      scope,
      actor: alice,
      taskId: grandchild.id,
      patch: { parentId: null },
      now: minutes(34),
    });
    expect(detached.parentId).toBeUndefined();
  });
});

describe("decisions", () => {
  it("are raised with numbered options, about a task or not, and counted on the task", async () => {
    const task = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Choose a database" },
      now: minutes(40),
    });
    const raised = await raiseDecision(database, {
      scope,
      actor: alice,
      decision: {
        question: "Which one?",
        body: "Both work.",
        options: ["The first", "The second"],
        taskId: task.id,
      },
      now: minutes(41),
    });
    expect(raised).toMatchObject({
      question: "Which one?",
      body: "Both work.",
      options: [
        { id: "1", label: "The first" },
        { id: "2", label: "The second" },
      ],
      taskId: task.id,
      raisedBy: alice,
      answer: undefined,
    });
    expect((await getTask(database, scope, task.id))?.openDecisions).toBe(1);
    const alone = await raiseDecision(database, {
      scope,
      actor: bob,
      decision: { question: "Lunch?", options: ["Now", "Later"] },
      now: minutes(42),
    });
    expect(alone.taskId).toBeUndefined();
    expect(await getDecision(database, scope, alone.id)).toEqual(alone);
    await expect(
      raiseDecision(database, {
        scope,
        actor: bob,
        decision: {
          question: "About nothing?",
          options: ["a", "b"],
          taskId: "0199c4d8-0000-7000-8000-000000000099",
        },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "decision.invalid_task" });

    const event = (await listEventsAfter(database, scope, 0, 200)).items.find(
      (candidate) => candidate.decisionId === raised.id,
    );
    expect(event).toMatchObject({
      kind: "decision.raised",
      taskId: task.id,
      data: { question: "Which one?", number: task.number, title: "Choose a database" },
    });
  });

  it("are answered once, with one of their options, and the task's count goes down", async () => {
    const task = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Pick a name" },
      now: minutes(50),
    });
    const raised = await raiseDecision(database, {
      scope,
      actor: alice,
      decision: { question: "Name?", options: ["Console", "Board"], taskId: task.id },
      now: minutes(51),
    });
    await expect(
      answerDecision(database, {
        scope,
        actor: bob,
        decisionId: raised.id,
        option: "3",
        note: undefined,
        now: minutes(52),
      }),
    ).rejects.toMatchObject({ code: "decision.no_such_option" });
    const answered = await answerDecision(database, {
      scope,
      actor: bob,
      decisionId: raised.id,
      option: "2",
      note: "Shorter.",
      now: minutes(52),
    });
    expect(answered.answer).toEqual({ option: "2", note: "Shorter.", by: bob, at: minutes(52) });
    expect(answered.updatedAt).toEqual(minutes(52));
    expect((await getTask(database, scope, task.id))?.openDecisions).toBe(0);
    await expect(
      answerDecision(database, {
        scope,
        actor: alice,
        decisionId: raised.id,
        option: "1",
        note: undefined,
        now: minutes(53),
      }),
    ).rejects.toBeInstanceOf(DecisionError);
    await expect(
      answerDecision(database, {
        scope,
        actor: alice,
        decisionId: "0199c4d8-0000-7000-8000-000000000099",
        option: "1",
        note: undefined,
        now: minutes(53),
      }),
    ).rejects.toMatchObject({ code: "decision.not_found" });

    const event = (await listEventsAfter(database, scope, 0, 200)).items.find(
      (candidate) => candidate.kind === "decision.answered" && candidate.decisionId === raised.id,
    );
    expect(event?.data).toEqual({ question: "Name?", option: "Board" });
  });

  it("list the ones that wait first, newest first within each", async () => {
    const all = (await listDecisions(database, scope, { limit: 100 })).items;
    const waiting = all.filter((decision) => decision.answer === undefined);
    const done = all.filter((decision) => decision.answer !== undefined);
    expect(all.slice(0, waiting.length)).toEqual(waiting);
    expect(all.slice(waiting.length)).toEqual(done);
    for (const group of [waiting, done]) {
      for (let index = 1; index < group.length; index += 1) {
        const previous = group[index - 1];
        const current = group[index];
        expect(previous !== undefined && current !== undefined).toBe(true);
        if (previous !== undefined && current !== undefined) {
          expect(previous.createdAt.getTime()).toBeGreaterThanOrEqual(current.createdAt.getTime());
        }
      }
    }
    expect((await listDecisions(database, scope, { open: true, limit: 100 })).items).toEqual(
      waiting,
    );
  });
});

describe("events", () => {
  it("are read from a number on, a page at a time", async () => {
    const latest = await latestEventId(database, workspaceId);
    const first = await listEventsAfter(database, scope, 0, 3);
    expect(first.items).toHaveLength(3);
    expect(first.more).toBe(true);
    expect(first.items.map((event) => event.id)).toEqual(
      [...first.items.map((event) => event.id)].sort((a, b) => a - b),
    );
    const rest = await listEventsAfter(database, scope, first.items[2]?.id ?? 0, 1000);
    expect(rest.more).toBe(false);
    expect(rest.items.at(-1)?.id).toBe(latest);
    expect((await listEventsAfter(database, scope, latest, 10)).items).toEqual([]);
  });

  it("nudge whoever listens on the channel when one is written", async () => {
    const listener = new Client({ connectionString: testDatabase.connectionString });
    await listener.connect();
    try {
      await listener.query(`listen ${EVENTS_CHANNEL}`);
      const nudged = new Promise<string>((resolve) => {
        listener.once("notification", (message) => resolve(message.channel));
      });
      await createTask(database, {
        scope,
        actor: alice,
        task: { title: "Wake the feed" },
        now: minutes(60),
      });
      expect(await nudged).toBe(EVENTS_CHANNEL);
    } finally {
      await listener.end();
    }
  });
});

describe("tokens", () => {
  it("are found by their hash while they last, noted when used, and listed newest first", async () => {
    const first = await createToken(database, {
      personId: alice.id,
      name: "first",
      tokenHash: "tok-a",
      expiresAt: minutes(60),
      now: T0,
      limit: 3,
    });
    expect(first.lastUsedAt).toBeUndefined();
    const second = await createToken(database, {
      personId: alice.id,
      name: "second",
      tokenHash: "tok-b",
      expiresAt: minutes(5),
      now: minutes(1),
      limit: 3,
    });
    // One without an expiry is good whenever.
    const forever = await createToken(database, {
      personId: alice.id,
      name: "forever",
      tokenHash: "tok-c",
      expiresAt: undefined,
      now: minutes(2),
      limit: 3,
    });
    expect(forever.expiresAt).toBeUndefined();
    expect((await findToken(database, "tok-c", minutes(100_000)))?.token.id).toBe(forever.id);
    const found = await findToken(database, "tok-a", minutes(30));
    expect(found?.person.id).toBe(alice.id);
    expect(found?.token.id).toBe(first.id);
    expect(await findToken(database, "tok-a", minutes(60))).toBeUndefined();
    expect(await findToken(database, "tok-nothing", T0)).toBeUndefined();
    await touchToken(database, first.id, minutes(30));
    expect((await findToken(database, "tok-a", minutes(31)))?.token.lastUsedAt).toEqual(
      minutes(30),
    );
    const live = await listTokensOf(database, alice.id, minutes(2));
    expect(live.map((token) => token.id)).toEqual([forever.id, second.id, first.id]);
    const later = await listTokensOf(database, alice.id, minutes(10));
    expect(later.map((token) => token.id)).toEqual([forever.id, first.id]);
  });

  it("are bounded per person, counting only what lasts, and go with time or on request", async () => {
    const token = (name: string, hash: string, expiresAt: Date, now: Date) =>
      createToken(database, { personId: bob.id, name, tokenHash: hash, expiresAt, now, limit: 2 });
    await token("one", "tok-bob-1", minutes(60), T0);
    await token("two", "tok-bob-2", minutes(5), T0);
    await expect(token("three", "tok-bob-3", minutes(60), T0)).rejects.toBeInstanceOf(TokenError);
    // Once the second has ended, there is room again.
    const third = await token("three", "tok-bob-3", minutes(60), minutes(10));
    expect(await deleteToken(database, alice.id, third.id)).toBe(false);
    expect(await deleteToken(database, bob.id, third.id)).toBe(true);
    expect(await deleteToken(database, bob.id, third.id)).toBe(false);
    // Alice's second and Bob's second have ended by now; the one without an expiry never does.
    expect(await deleteExpiredTokens(database, minutes(10))).toBe(2);
    expect(await findToken(database, "tok-c", minutes(10))).toBeDefined();
  });
});

describe("projects", () => {
  it("are made with their maker as owner, keyed once per workspace, and seen as each person may", async () => {
    const made = await createProject(database, {
      workspaceId,
      actor: { id: bob.id },
      person: bob,
      project: {
        key: "ops",
        name: "Ops",
        description: "What we run.",
        skillsAddress: "/gh/acme/ops",
      },
      now: minutes(200),
    });
    expect(made).toMatchObject({
      key: "ops",
      name: "Ops",
      description: "What we run.",
      visibility: "private",
      skillsAddress: "/gh/acme/ops",
      role: "owner",
      openDecisions: 0,
      openRuns: 0,
    });
    await expect(
      createProject(database, {
        workspaceId,
        actor: { id: bob.id },
        person: bob,
        project: { key: "ops", name: "Again" },
        now: minutes(201),
      }),
    ).rejects.toMatchObject({ code: "project.key_taken" });
    // Bob is listed; Alice is not, and a private project she is not in is not there for her.
    expect(
      (await listMembers(database, made.id)).map((member) => [member.person.id, member.role]),
    ).toEqual([[bob.id, "owner"]]);
    expect(await findProjectFor(database, workspaceId, "ops", alice)).toBeUndefined();
    expect((await findProjectFor(database, workspaceId, "ops", bob))?.role).toBe("owner");
    // The open project is everyone's, as a member; an administrator is an owner everywhere.
    expect((await findProjectFor(database, workspaceId, "web", bob))?.role).toBe("member");
    expect((await findProjectFor(database, workspaceId, "web", alice))?.role).toBe("owner");
    const administrator = { ...bob, role: "admin" as const };
    expect((await findProjectFor(database, workspaceId, "own", administrator))?.role).toBe("owner");
    expect(
      (await listProjectsFor(database, workspaceId, bob)).map((project) => project.key),
    ).toEqual(["ops", "web"]);
    expect(
      (await listProjectsFor(database, workspaceId, alice)).map((project) => project.key),
    ).toEqual(["own", "web"]);
    expect(await findProjectFor(database, workspaceId, "nothing", administrator)).toBeUndefined();
  });

  it("list people with a role each, change them, and tell the board of all of it", async () => {
    const ops = await findProjectFor(database, workspaceId, "ops", bob);
    if (ops === undefined) {
      throw new Error("ops is bob's");
    }
    const inOps = { workspaceId, projectId: ops.id };
    const before = await latestEventId(database, workspaceId);
    const added = await addMember(database, {
      ...inOps,
      actor: { id: bob.id },
      personId: alice.id,
      role: "member",
      now: minutes(210),
    });
    expect(added).toMatchObject({ role: "member", addedAt: minutes(210) });
    expect(added.person.id).toBe(alice.id);
    expect((await findProjectFor(database, workspaceId, "ops", alice))?.role).toBe("member");
    await expect(
      addMember(database, {
        ...inOps,
        actor: { id: bob.id },
        personId: alice.id,
        role: "owner",
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "member.exists" });
    await expect(
      addMember(database, {
        ...inOps,
        actor: { id: bob.id },
        personId: "0199c4d8-0000-7000-8000-000000000099",
        role: "member",
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "member.invalid_person" });
    const promoted = await updateMember(database, {
      ...inOps,
      actor: { id: bob.id },
      personId: alice.id,
      role: "owner",
      now: minutes(211),
    });
    expect(promoted.role).toBe("owner");
    // Said again, nothing is written.
    await updateMember(database, {
      ...inOps,
      actor: { id: bob.id },
      personId: alice.id,
      role: "owner",
      now: minutes(212),
    });
    await removeMember(database, {
      ...inOps,
      actor: { id: bob.id },
      personId: alice.id,
      now: minutes(213),
    });
    expect(await findProjectFor(database, workspaceId, "ops", alice)).toBeUndefined();
    await expect(
      removeMember(database, { ...inOps, actor: { id: bob.id }, personId: alice.id, now: T0 }),
    ).rejects.toBeInstanceOf(ProjectError);
    const renamed = await updateProject(database, {
      projectId: ops.id,
      actor: { id: bob.id, agent: "a script" },
      person: bob,
      patch: { name: "Operations", visibility: "workspace", skillsAddress: null },
      now: minutes(214),
    });
    expect(renamed).toMatchObject({
      name: "Operations",
      visibility: "workspace",
      skillsAddress: undefined,
    });
    expect((await findProjectFor(database, workspaceId, "ops", alice))?.role).toBe("member");
    const { items } = await listEventsAfter(database, inOps, before, 100);
    expect(items.map((event) => [event.kind, event.agent, event.data])).toEqual([
      [
        "project.member_added",
        undefined,
        { key: "ops", name: "Ops", login: "Alice", role: "member" },
      ],
      [
        "project.member_changed",
        undefined,
        { key: "ops", name: "Ops", login: "Alice", role: "owner" },
      ],
      ["project.member_removed", undefined, { key: "ops", name: "Ops", login: "Alice" }],
      [
        "project.updated",
        "a script",
        { key: "ops", name: "Operations", fields: ["name", "visibility", "skillsAddress"] },
      ],
    ]);
  });
});

describe("runs", () => {
  it("take a task for a person, taking over a run still open on it, and not a closed one", async () => {
    const task = await createTask(database, {
      scope,
      actor: bob,
      task: { title: "Index the docs", state: "ready" },
      now: minutes(100),
    });
    let run = await startRun(database, {
      scope,
      actor: alice,
      tokenId: undefined,
      taskId: task.id,
      agent: "Codex",
      now: minutes(101),
    });
    expect(run).toMatchObject({ status: "running", agent: "Codex", reports: [], artifacts: [] });
    expect(run.person.id).toBe(alice.id);
    const ofRun = (await listEventsAfter(database, { ...scope, runId: run.id }, 0, 100)).items;
    expect(ofRun.map((event) => [event.kind, event.agent])).toEqual([["run.started", "Codex"]]);
    const ofTask = (await listEventsAfter(database, { ...scope, taskId: task.id }, 0, 100)).items;
    expect(ofTask.map((event) => [event.kind, event.agent])).toEqual([
      ["task.created", undefined],
      ["run.started", "Codex"],
      ["task.moved", "Codex"],
      ["task.updated", "Codex"],
    ]);
    const taken = await getTask(database, scope, task.id);
    expect(taken).toMatchObject({ state: "in_progress", openRuns: 1 });
    expect(taken?.assignee?.id).toBe(alice.id);
    expect(run.lastHeardAt).toEqual(minutes(101));
    // The board cannot know whether Codex still runs: a second take takes the task over, and
    // the first run ends as abandoned, with a word that says so and an event that says who.
    const second = await startRun(database, {
      scope,
      actor: bob,
      tokenId: undefined,
      taskId: task.id,
      agent: "another",
      now: minutes(102),
    });
    expect(second).toMatchObject({ status: "running", agent: "another" });
    const first = (await listRuns(database, scope, { taskId: task.id, limit: 10 })).items.find(
      (candidate) => candidate.id === run.id,
    );
    expect(first).toMatchObject({
      status: "abandoned",
      summary: "Taken over by another.",
      endedAt: minutes(102),
    });
    expect((await getTask(database, scope, task.id))?.openRuns).toBe(1);
    const takeover = (await listEventsAfter(database, { ...scope, runId: run.id }, 0, 100)).items;
    expect(takeover.map((event) => [event.kind, event.agent, event.data.agent])).toEqual([
      ["run.started", "Codex", "Codex"],
      ["run.taken_over", "another", "Codex"],
    ]);
    // Alice takes it back for the rest: Bob's run is over in its turn.
    run = await startRun(database, {
      scope,
      actor: alice,
      tokenId: undefined,
      taskId: task.id,
      agent: "Codex",
      now: minutes(102),
    });
    expect(
      (await listRuns(database, scope, { taskId: task.id, open: true, limit: 10 })).items.map(
        (candidate) => candidate.id,
      ),
    ).toEqual([run.id]);
    // Only its person ends it, unless an administrator does; a finished run puts the task up for review.
    await expect(
      endRun(database, {
        scope,
        actor: bob,
        runId: run.id,
        status: "finished",
        summary: undefined,
        now: minutes(103),
      }),
    ).rejects.toBeInstanceOf(RunError);
    const ended = await endRun(database, {
      scope,
      actor: bob,
      runId: run.id,
      status: "abandoned",
      summary: undefined,
      anyone: true,
      now: minutes(103),
    });
    expect(ended).toMatchObject({ status: "abandoned", endedAt: minutes(103) });
    expect((await getTask(database, scope, task.id))?.openRuns).toBe(0);
    const closed = await createTask(database, {
      scope,
      actor: bob,
      task: { title: "Old", state: "done" },
      now: minutes(104),
    });
    await expect(
      startRun(database, {
        scope,
        actor: alice,
        tokenId: undefined,
        taskId: closed.id,
        agent: "Codex",
        now: minutes(105),
      }),
    ).rejects.toMatchObject({ code: "run.task_closed" });
  });

  it("say the first words of a report, in one line, bounded", () => {
    expect(excerptOf("# Found it\n\nThe parser trusts its input.")).toBe("Found it");
    expect(excerptOf("\n\n- first   point\nsecond")).toBe("first point");
    expect(excerptOf("")).toBe("");
    expect(excerptOf("x".repeat(300))).toHaveLength(140);
  });
});

describe("the schedule", () => {
  it("keeps the plan in days, and what happened in moments the board sets itself", async () => {
    const task = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Plan the launch", startsOn: "2026-10-20", dueOn: "2026-10-24" },
      now: minutes(40),
    });
    expect(task).toMatchObject({
      startsOn: "2026-10-20",
      dueOn: "2026-10-24",
      startedAt: undefined,
      doneAt: undefined,
    });
    const move = (state: "ready" | "in_progress" | "in_review" | "done", at: number) =>
      updateTask(database, {
        scope,
        actor: bob,
        taskId: task.id,
        patch: { state },
        now: minutes(at),
      });
    // The first move past ready is the start, and it stays.
    const started = await move("in_progress", 41);
    expect(started.startedAt).toEqual(minutes(41));
    expect(started.doneAt).toBeUndefined();
    const reviewed = await move("in_review", 42);
    expect(reviewed.startedAt).toEqual(minutes(41));
    // The move to done is the end; a move back out of done takes it away; done again is now.
    const done = await move("done", 43);
    expect(done.doneAt).toEqual(minutes(43));
    const reopened = await move("ready", 44);
    expect(reopened.doneAt).toBeUndefined();
    expect(reopened.startedAt).toEqual(minutes(41));
    const doneAgain = await move("done", 45);
    expect(doneAgain.doneAt).toEqual(minutes(45));
    // A task written past ready has been started; one written done is done now.
    const written = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Done already", state: "done" },
      now: minutes(46),
    });
    expect(written).toMatchObject({ startedAt: minutes(46), doneAt: minutes(46) });
    // A change of the plan is named on the wire as the API takes it.
    const before = await latestEventId(database, workspaceId);
    const replanned = await updateTask(database, {
      scope,
      actor: alice,
      taskId: task.id,
      patch: { startsOn: null, dueOn: "2026-10-30" },
      now: minutes(47),
    });
    expect(replanned).toMatchObject({ startsOn: undefined, dueOn: "2026-10-30" });
    const { items } = await listEventsAfter(database, scope, before, 10);
    expect(items.map((event) => [event.kind, event.data.fields])).toEqual([
      ["task.updated", ["startsOn", "dueOn"]],
    ]);
  });

  it("refuses a due day before the start, a category that is not one, and a goal that is not the project's", async () => {
    const write = (task: Parameters<typeof createTask>[1]["task"]) =>
      createTask(database, { scope, actor: alice, task, now: T0 });
    await expect(
      write({ title: "x", startsOn: "2026-10-24", dueOn: "2026-10-20" }),
    ).rejects.toMatchObject({ code: "task.invalid_dates" });
    await expect(write({ title: "x", category: "nothing" })).rejects.toMatchObject({
      code: "task.invalid_category",
    });
    await expect(
      write({ title: "x", goalId: "0199c4d8-0000-7000-8000-000000000099" }),
    ).rejects.toMatchObject({ code: "task.invalid_goal" });
    const planned = await write({ title: "x", startsOn: "2026-10-20" });
    await expect(
      updateTask(database, {
        scope,
        actor: alice,
        taskId: planned.id,
        patch: { dueOn: "2026-10-01" },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "task.invalid_dates" });
  });
});

describe("categories", () => {
  it("start as the usual kinds of work, listed by name", async () => {
    const listed = await listCategories(database, workspaceId);
    expect(listed.map((category) => category.key)).toEqual([
      "design",
      "engineering",
      "marketing",
      "operations",
      "product",
    ]);
    expect(listed.find((category) => category.key === "engineering")).toMatchObject({
      name: "Engineering",
      color: "blue",
    });
  });

  it("are made, changed and removed by key, told to the workspace, and kept while tasks use them", async () => {
    const before = await latestEventId(database, workspaceId);
    const actor = { id: alice.id };
    const made = await createCategory(database, {
      workspaceId,
      actor,
      category: { key: "research", name: "Research" },
      now: minutes(50),
    });
    expect(made).toMatchObject({ key: "research", name: "Research", color: "gray" });
    await expect(
      createCategory(database, {
        workspaceId,
        actor,
        category: { key: "research", name: "Again" },
        now: minutes(50),
      }),
    ).rejects.toMatchObject({ code: "category.key_taken" });
    const changed = await updateCategory(database, {
      workspaceId,
      actor,
      key: "research",
      patch: { name: "Research and insight", color: "yellow" },
      now: minutes(51),
    });
    expect(changed).toMatchObject({ name: "Research and insight", color: "yellow" });
    const same = await updateCategory(database, {
      workspaceId,
      actor,
      key: "research",
      patch: { color: "yellow" },
      now: minutes(52),
    });
    expect(same.updatedAt).toEqual(minutes(51));
    // Sorted into it, a task keeps it there; moved out, the category may go.
    const task = await createTask(database, {
      scope,
      actor: alice,
      task: { title: "Interview users", category: "research" },
      now: minutes(53),
    });
    expect(task.category).toEqual({
      key: "research",
      name: "Research and insight",
      color: "yellow",
    });
    await expect(
      removeCategory(database, { workspaceId, actor, key: "research", now: minutes(54) }),
    ).rejects.toMatchObject({ code: "category.in_use" });
    const moved = await updateTask(database, {
      scope,
      actor: alice,
      taskId: task.id,
      patch: { category: null },
      now: minutes(55),
    });
    expect(moved.category).toBeUndefined();
    await removeCategory(database, { workspaceId, actor, key: "research", now: minutes(56) });
    expect(await findCategory(database, workspaceId, "research")).toBeUndefined();
    await expect(
      removeCategory(database, { workspaceId, actor, key: "research", now: minutes(57) }),
    ).rejects.toMatchObject({ code: "category.not_found" });
    const { items } = await listEventsAfter(database, { workspaceId, projectId: null }, before, 10);
    expect(items.map((event) => [event.kind, event.data])).toEqual([
      ["category.created", { key: "research", name: "Research" }],
      [
        "category.updated",
        { key: "research", name: "Research and insight", fields: ["name", "color"] },
      ],
      ["category.removed", { key: "research", name: "Research and insight" }],
    ]);
  });
});

describe("goals", () => {
  it("are set on the roadmap, read in order, counted from their tasks, and changed", async () => {
    const later = await createGoal(database, {
      scope,
      actor: alice,
      goal: { title: "Launch v2", dueOn: "2026-12-31" },
      now: minutes(60),
    });
    expect(later).toMatchObject({
      state: "planned",
      dueOn: "2026-12-31",
      body: "",
      createdBy: alice,
      taskCounts: { idea: 0, ready: 0, in_progress: 0, in_review: 0, done: 0, dropped: 0 },
    });
    const ship = await createGoal(database, {
      scope,
      actor: alice,
      goal: { title: "Ship v1", body: "What it means.", state: "active", dueOn: "2026-11-15" },
      now: minutes(61),
    });
    const hire = await createGoal(database, {
      scope,
      actor: alice,
      goal: { title: "Hire", state: "active" },
      now: minutes(62),
    });
    // The active first, the sooner due first among them, and a goal with no day last.
    expect((await listGoals(database, scope, 10)).map((goal) => goal.title)).toEqual([
      "Ship v1",
      "Hire",
      "Launch v2",
    ]);
    for (const [title, state] of [
      ["Define it", "done"],
      ["Build it", "in_progress"],
      ["Doubt it", "dropped"],
    ] as const) {
      await createTask(database, {
        scope,
        actor: bob,
        task: { title, state, goalId: ship.id },
        now: minutes(63),
      });
    }
    expect((await getGoal(database, scope, ship.id))?.taskCounts).toEqual({
      idea: 0,
      ready: 0,
      in_progress: 1,
      in_review: 0,
      done: 1,
      dropped: 1,
    });
    const before = await latestEventId(database, workspaceId);
    const reached = await updateGoal(database, {
      scope,
      actor: alice,
      goalId: ship.id,
      patch: { title: "Shipped v1", state: "done" },
      now: minutes(64),
    });
    expect(reached).toMatchObject({ title: "Shipped v1", state: "done" });
    const same = await updateGoal(database, {
      scope,
      actor: alice,
      goalId: ship.id,
      patch: { state: "done" },
      now: minutes(65),
    });
    expect(same.updatedAt).toEqual(minutes(64));
    const { items } = await listEventsAfter(database, { ...scope, goalId: ship.id }, 0, 10);
    expect(items.map((event) => [event.kind, event.data])).toEqual([
      ["goal.created", { title: "Ship v1" }],
      ["goal.updated", { title: "Shipped v1", fields: ["title", "state"] }],
    ]);
    expect((await listEventsAfter(database, scope, before, 10)).items).toHaveLength(1);
    await expect(
      updateGoal(database, {
        scope,
        actor: alice,
        goalId: "0199c4d8-0000-7000-8000-000000000099",
        patch: { state: "done" },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "goal.not_found" });
    // Another project does not find it, nor may its tasks work towards it.
    const other = await createProject(database, {
      workspaceId,
      actor: { id: alice.id },
      person: alice,
      project: { key: "other", name: "Another" },
      now: T0,
    });
    const elsewhere = { workspaceId, projectId: other.id };
    expect(await getGoal(database, elsewhere, ship.id)).toBeUndefined();
    expect(hire.projectId).toBe(scope.projectId);
    await expect(
      createTask(database, {
        scope: elsewhere,
        actor: alice,
        task: { title: "x", goalId: ship.id },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "task.invalid_goal" });
  });
});
