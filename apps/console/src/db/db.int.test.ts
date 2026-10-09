import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { getSchemaStatus, migrateDatabase } from "./migrate.js";
import {
  answerDecision,
  DecisionError,
  getDecision,
  listDecisions,
  raiseDecision,
} from "./queries/decisions.js";
import { EVENTS_CHANNEL, latestEventId, listEventsAfter } from "./queries/events.js";
import { findPerson, listPeople, type PersonRecord, savePerson } from "./queries/people.js";
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
import { ensureWorkspace } from "./queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let database: Database;
let workspaceId: string;
let alice: PersonRecord;
let bob: PersonRecord;

const T0 = new Date("2026-01-01T00:00:00Z");
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
  workspaceId = (await ensureWorkspace(database, { name: "Acme", now: T0 })).id;
  alice = (
    await savePerson(database, {
      workspaceId,
      host: "gh",
      account: {
        hostAccountId: "1001",
        login: "Alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice.png",
      },
      now: T0,
    })
  ).person;
  bob = (
    await savePerson(database, {
      workspaceId,
      host: "gh",
      account: { hostAccountId: "1002", login: "bob", name: undefined, avatarUrl: undefined },
      now: T0,
    })
  ).person;
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("migrations", () => {
  it("are applied, idempotently, and readiness sees the schema as current", async () => {
    const first = await migrateDatabase(testDatabase.connectionString);
    const second = await migrateDatabase(testDatabase.connectionString);
    expect(first.latest).toBe("0000_initial");
    expect(second.latest).toBe(first.latest);
    expect(await getSchemaStatus(database)).toEqual({ current: true, expected: "0000_initial" });
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
    const renamed = await savePerson(database, {
      workspaceId,
      host: "gh",
      account: {
        hostAccountId: "1001",
        login: "alice-renamed",
        name: "Alice",
        avatarUrl: undefined,
      },
      now: minutes(2),
    });
    expect(renamed.joined).toBe(false);
    expect(renamed.person.id).toBe(alice.id);
    expect(renamed.person.login).toBe("alice-renamed");
    expect(renamed.person.avatarUrl).toBeUndefined();
    // Back to how the rest of the file knows her.
    alice = (
      await savePerson(database, {
        workspaceId,
        host: "gh",
        account: {
          hostAccountId: "1001",
          login: "Alice",
          name: "Alice Example",
          avatarUrl: "https://avatars.example/alice.png",
        },
        now: minutes(3),
      })
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
    const { items } = await listEventsAfter(database, workspaceId, 0, 100);
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
      workspaceId,
      actorId: alice.id,
      task: { title: "Write the release notes" },
      now: minutes(10),
    });
    const second = await createTask(database, {
      workspaceId,
      actorId: bob.id,
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
    expect(await getTask(database, workspaceId, second.id)).toEqual(second);
    expect((await listTasks(database, workspaceId, { limit: 10 })).map((t) => t.number)).toEqual([
      2, 1,
    ]);
    expect(
      (await listTasks(database, workspaceId, { state: "ready", limit: 10 })).map((t) => t.number),
    ).toEqual([2]);
  });

  it("refuse an assignee who is not of the workspace, and a parent that is not a task", async () => {
    await expect(
      createTask(database, {
        workspaceId,
        actorId: alice.id,
        task: { title: "x", assigneeId: "0199c4d8-0000-7000-8000-000000000099" },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "task.invalid_assignee" });
    await expect(
      createTask(database, {
        workspaceId,
        actorId: alice.id,
        task: { title: "x", parentId: "0199c4d8-0000-7000-8000-000000000099" },
        now: T0,
      }),
    ).rejects.toBeInstanceOf(TaskError);
  });

  it("record a move and an edit as the events they are, and nothing for no change", async () => {
    const task = await createTask(database, {
      workspaceId,
      actorId: alice.id,
      task: { title: "Review the design" },
      now: minutes(20),
    });
    const before = await latestEventId(database, workspaceId);

    const moved = await updateTask(database, {
      workspaceId,
      actorId: bob.id,
      taskId: task.id,
      patch: { state: "in_progress" },
      now: minutes(21),
    });
    expect(moved.state).toBe("in_progress");
    expect(moved.updatedAt).toEqual(minutes(21));

    const edited = await updateTask(database, {
      workspaceId,
      actorId: bob.id,
      taskId: task.id,
      patch: { title: "Review the design, again", assigneeId: bob.id, priority: "urgent" },
      now: minutes(22),
    });
    expect(edited).toMatchObject({ title: "Review the design, again", assignee: bob });

    const same = await updateTask(database, {
      workspaceId,
      actorId: bob.id,
      taskId: task.id,
      patch: { priority: "urgent" },
      now: minutes(23),
    });
    expect(same.updatedAt).toEqual(minutes(22));

    const { items } = await listEventsAfter(database, workspaceId, before, 100);
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
        workspaceId,
        actorId: bob.id,
        taskId: "0199c4d8-0000-7000-8000-000000000099",
        patch: { state: "done" },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "task.not_found" });
  });

  it("break down into subtasks, but never into a loop", async () => {
    const parent = await createTask(database, {
      workspaceId,
      actorId: alice.id,
      task: { title: "Launch" },
      now: minutes(30),
    });
    const child = await createTask(database, {
      workspaceId,
      actorId: alice.id,
      task: { title: "Write the announcement", parentId: parent.id },
      now: minutes(31),
    });
    const grandchild = await createTask(database, {
      workspaceId,
      actorId: alice.id,
      task: { title: "Draft it", parentId: child.id },
      now: minutes(32),
    });
    expect((await listSubtasks(database, workspaceId, parent.id, 10)).map((t) => t.id)).toEqual([
      child.id,
    ]);
    for (const parentId of [parent.id, grandchild.id]) {
      await expect(
        updateTask(database, {
          workspaceId,
          actorId: alice.id,
          taskId: parent.id,
          patch: { parentId },
          now: minutes(33),
        }),
      ).rejects.toMatchObject({ code: "task.invalid_parent" });
    }
    const detached = await updateTask(database, {
      workspaceId,
      actorId: alice.id,
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
      workspaceId,
      actorId: alice.id,
      task: { title: "Choose a database" },
      now: minutes(40),
    });
    const raised = await raiseDecision(database, {
      workspaceId,
      actorId: alice.id,
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
    expect((await getTask(database, workspaceId, task.id))?.openDecisions).toBe(1);
    const alone = await raiseDecision(database, {
      workspaceId,
      actorId: bob.id,
      decision: { question: "Lunch?", options: ["Now", "Later"] },
      now: minutes(42),
    });
    expect(alone.taskId).toBeUndefined();
    expect(await getDecision(database, workspaceId, alone.id)).toEqual(alone);
    await expect(
      raiseDecision(database, {
        workspaceId,
        actorId: bob.id,
        decision: {
          question: "About nothing?",
          options: ["a", "b"],
          taskId: "0199c4d8-0000-7000-8000-000000000099",
        },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: "decision.invalid_task" });

    const event = (await listEventsAfter(database, workspaceId, 0, 200)).items.find(
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
      workspaceId,
      actorId: alice.id,
      task: { title: "Pick a name" },
      now: minutes(50),
    });
    const raised = await raiseDecision(database, {
      workspaceId,
      actorId: alice.id,
      decision: { question: "Name?", options: ["Console", "Board"], taskId: task.id },
      now: minutes(51),
    });
    await expect(
      answerDecision(database, {
        workspaceId,
        actorId: bob.id,
        decisionId: raised.id,
        option: "3",
        note: undefined,
        now: minutes(52),
      }),
    ).rejects.toMatchObject({ code: "decision.no_such_option" });
    const answered = await answerDecision(database, {
      workspaceId,
      actorId: bob.id,
      decisionId: raised.id,
      option: "2",
      note: "Shorter.",
      now: minutes(52),
    });
    expect(answered.answer).toEqual({ option: "2", note: "Shorter.", by: bob, at: minutes(52) });
    expect(answered.updatedAt).toEqual(minutes(52));
    expect((await getTask(database, workspaceId, task.id))?.openDecisions).toBe(0);
    await expect(
      answerDecision(database, {
        workspaceId,
        actorId: alice.id,
        decisionId: raised.id,
        option: "1",
        note: undefined,
        now: minutes(53),
      }),
    ).rejects.toBeInstanceOf(DecisionError);
    await expect(
      answerDecision(database, {
        workspaceId,
        actorId: alice.id,
        decisionId: "0199c4d8-0000-7000-8000-000000000099",
        option: "1",
        note: undefined,
        now: minutes(53),
      }),
    ).rejects.toMatchObject({ code: "decision.not_found" });

    const event = (await listEventsAfter(database, workspaceId, 0, 200)).items.find(
      (candidate) => candidate.kind === "decision.answered" && candidate.decisionId === raised.id,
    );
    expect(event?.data).toEqual({ question: "Name?", option: "Board" });
  });

  it("list the ones that wait first, newest first within each", async () => {
    const all = await listDecisions(database, workspaceId, { limit: 100 });
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
    expect(await listDecisions(database, workspaceId, { open: true, limit: 100 })).toEqual(waiting);
  });
});

describe("events", () => {
  it("are read from a number on, a page at a time", async () => {
    const latest = await latestEventId(database, workspaceId);
    const first = await listEventsAfter(database, workspaceId, 0, 3);
    expect(first.items).toHaveLength(3);
    expect(first.more).toBe(true);
    expect(first.items.map((event) => event.id)).toEqual(
      [...first.items.map((event) => event.id)].sort((a, b) => a - b),
    );
    const rest = await listEventsAfter(database, workspaceId, first.items[2]?.id ?? 0, 1000);
    expect(rest.more).toBe(false);
    expect(rest.items.at(-1)?.id).toBe(latest);
    expect((await listEventsAfter(database, workspaceId, latest, 10)).items).toEqual([]);
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
        workspaceId,
        actorId: alice.id,
        task: { title: "Wake the feed" },
        now: minutes(60),
      });
      expect(await nudged).toBe(EVENTS_CHANNEL);
    } finally {
      await listener.end();
    }
  });
});
