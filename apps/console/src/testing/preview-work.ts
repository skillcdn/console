import {
  CLAIM_PATH,
  type ConsoleClient,
  connectPath,
  createClient,
  type FileUpload,
  REST_ROUTES,
  type RestHome,
  restClaimSchema,
  restConnectionSchema,
} from "@skillcdn/console/api";
import { sql } from "drizzle-orm";
import { drizzleOf } from "../db/client.js";
import { APP_VERSION } from "../version.js";
import type { Harness } from "./harness.js";
import {
  AGENTS,
  type Agent,
  ANSWERED,
  CATEGORIES,
  COMMENTS,
  CONFIRMATION_LINK,
  type DecisionData,
  FIELD_ERRORS,
  FULL_TASK,
  type GoalData,
  HANDBOOK,
  HANDBOOK_GOALS,
  HANDBOOK_PAGES,
  HANDBOOK_TASKS,
  JOINING,
  LAB,
  LAPTOP_AGENT,
  LEAVING,
  LISTED_ONLY,
  MEMBERS,
  type Member,
  OPS,
  OPS_DECISIONS,
  OPS_GOALS,
  OPS_TASKS,
  type PageData,
  PROJECTS,
  type PreviewFile,
  RUNS,
  SESSION_SCRIPT,
  type TaskData,
  TEAMS,
  WAITING,
  WEBSITE,
  WEBSITE_GOALS,
  WEBSITE_PAGES,
  WEBSITE_TASKS,
  type Who,
} from "./preview-data.js";
import { chartPicture, markPicture, pagePicture } from "./preview-pictures.js";

// The invented work of `preview-data.ts`, made on the console a person looks at the pages on
// (`pnpm dev:plugins`), so that every page has something to show: through the REST API, as the
// people and the agent accounts themselves, each signed in as the fixture's provider knows them.
// One thing is written into the database, since nothing else makes it: how long ago each agent
// account came to stand as it does, and the one its runner was not heard from. Not compiled.

/** The account an agent account signs in with at the fixture's git host. */
const loginOf = (handle: Agent): string => `acme-${handle}`;

/** The bars of the chart of where people leave the sign-up form. */
const LEAVING_BARS = [0.92, 0.85, 0.5, 0.44] as const;

/** A file of the preview as the API takes one. */
function uploadOf(file: PreviewFile): FileUpload {
  if ("text" in file) {
    return {
      name: file.name,
      bytes: new TextEncoder().encode(file.text),
      contentType: file.contentType,
    };
  }
  return {
    name: file.name,
    bytes:
      file.picture === "chart"
        ? chartPicture(LEAVING_BARS, file.colour)
        : pagePicture(file.picture, file.colour),
    contentType: "image/png",
  };
}

/** The day so many days from `now`, as the machine this runs on has the day, which is whose pages show it. */
export function dayFrom(now: Date, days: number): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

interface Cast {
  /** Each member of the workspace as they act on the pages, by login or handle. */
  readonly as: (who: Who) => ConsoleClient;
  /** Someone acting through an agent of theirs: a token of that name, made the first time it is asked for. */
  readonly through: (who: Member, agent: string) => Promise<ConsoleClient>;
  readonly idOf: (who: Who) => string;
}

/**
 * Makes the workspace's work beyond the one board: the people and their teams, the agent
 * accounts as they stand, the projects with their tasks, goals, decisions, runs, comments and
 * documents, and the administrator's front page. `admin` is the Cookie header of the
 * administrator's session.
 */
export async function seedPreviewWork(options: {
  readonly harness: Harness;
  readonly origin: string;
  readonly admin: string;
  readonly now: Date;
  /** The project made before this, to put on the administrator's front page beside these. */
  readonly board: { readonly id: string };
}): Promise<void> {
  const { harness, origin, now } = options;
  const path = (url: string): string => (url.startsWith(origin) ? url.slice(origin.length) : url);
  /** A client that never leaves the process: as a browser with a session, or as a token. */
  const clientOf = (credential: { readonly cookie: string } | { readonly token: string }) =>
    createClient({
      baseUrl: origin,
      ...("token" in credential ? { token: credential.token } : {}),
      fetch: (input, init) =>
        harness.request(path(input), {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string> | undefined),
            ...("cookie" in credential ? { cookie: credential.cookie, origin } : {}),
          },
        }),
    });
  const admin = clientOf({ cookie: options.admin });

  // The workspace, as an administrator keeps it: its week, the zone of the machine this runs
  // on, so that a day here is the day of whoever looks, and the services its agents work with.
  await admin.updateWorkspace({
    weekStart: "monday",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    handle: "acme",
    domain: "acme.example",
  });
  await admin.updateWorkspace({ services: { git: { kind: "github", organization: "acme" } } });
  await admin.updateWorkspace({ services: { identity: { kind: "github", organization: "acme" } } });
  await admin.updateWorkspace({
    services: { messenger: { kind: "slack", workspace: "acme.slack.com" } },
  });
  for (const category of CATEGORIES) {
    await admin.createCategory(category);
  }

  // The people: three more let in and signed in, and a login let in that nobody used.
  const sessions = new Map<Who, ConsoleClient>([["alice", admin]]);
  for (const login of [...JOINING, LISTED_ONLY]) {
    await admin.createListing({ host: "gh", login });
  }
  for (const login of ["bob", "carol", ...JOINING] as const) {
    sessions.set(login, clientOf({ cookie: await harness.signIn(login) }));
  }
  const ids = new Map<string, string>();
  const readPeople = async (): Promise<void> => {
    for (const person of (await admin.people()).items) {
      ids.set(person.login.toLowerCase(), person.id);
      if (typeof person.handle === "string") {
        ids.set(person.handle, person.id);
      }
    }
  };
  await readPeople();
  const idOf = (who: Who): string => {
    const id = ids.get(who);
    if (id === undefined) {
      throw new Error(`${who} is not a member of this console`);
    }
    return id;
  };
  for (const member of MEMBERS) {
    await admin.updatePerson(idOf(member.login), {
      title: member.title,
      email: member.email,
      ...(member.manager === undefined ? {} : { managerId: idOf(member.manager) }),
    });
  }

  // The projects, before the agent accounts, each of which starts in one.
  const projectIds = new Map<string, string>();
  for (const project of PROJECTS) {
    const made = await admin.createProject({
      key: project.key,
      name: project.name,
      ...(project.description === "" ? {} : { description: project.description }),
      visibility: project.visibility,
      color: project.color,
    });
    projectIds.set(project.key, made.id);
    if (project.icon !== undefined) {
      await admin.project(project.key).setIcon({
        name: "mark.png",
        bytes: markPicture(project.icon),
        contentType: "image/png",
      });
    }
  }

  // The agent accounts: made by the administrator, signed in as themselves, and their runners
  // heard from once, each saying how its agent stands.
  const runners = new Map<Agent, ConsoleClient>();
  for (const agent of AGENTS) {
    await admin.createAgent({
      host: "gh",
      login: loginOf(agent.handle),
      handle: agent.handle,
      name: agent.name,
      title: agent.title,
      // Rolled from its handle, so that an account has the same face at every start.
      avatarSeed: agent.handle,
      managerId: idOf(agent.manager),
      project: agent.project,
    });
    if (agent.state === "invited") {
      await admin.inviteAgent(agent.handle);
      continue;
    }
    const cookie = await harness.signIn(loginOf(agent.handle));
    sessions.set(agent.handle, clientOf({ cookie }));
    runners.set(agent.handle, clientOf({ token: await commandOf(harness, origin, cookie) }));
  }
  await readPeople();
  for (const project of PROJECTS) {
    // An agent account is listed in the project it starts in already.
    const listed = new Set(
      project.members === undefined
        ? []
        : (await admin.project(project.key).members()).items.map((member) => member.person.id),
    );
    for (const member of project.members ?? []) {
      if (!listed.has(idOf(member))) {
        await admin.project(project.key).addMember({ personId: idOf(member) });
      }
    }
  }
  for (const team of TEAMS) {
    await admin.createTeam({ key: team.key, name: team.name });
    for (const member of team.members) {
      await admin.addTeamMember(team.key, idOf(member));
    }
  }

  const tokens = new Map<string, Promise<ConsoleClient>>();
  const cast: Cast = {
    as: (who) => {
      const client = sessions.get(who);
      if (client === undefined) {
        throw new Error(`${who} is not signed in on this console`);
      }
      return client;
    },
    through: (who, agent) => {
      const key = `${who}:${agent}`;
      const known = tokens.get(key);
      if (known !== undefined) {
        return known;
      }
      const made = cast
        .as(who)
        .createToken({ name: agent })
        .then((token) => clientOf({ token: token.secret }));
      tokens.set(key, made);
      return made;
    },
    idOf,
  };
  // The agents the administrator connected, one of which is never used and ends within the week.
  await cast.through("alice", LAPTOP_AGENT);
  await admin.createToken({ name: "A console of my own", expiresInDays: null });
  await admin.createToken({ name: "The nightly export", expiresInDays: 5 });

  // The projects' work, each project in its own order and the projects side by side, which is
  // what keeps a start short: a task's number and a page's version follow the order within one.
  const website = await seedBoard(cast, now, WEBSITE, WEBSITE_GOALS, WEBSITE_TASKS);
  await Promise.all([
    (async () => {
      await seedThread(cast, website);
      for (const decision of [...WAITING, ...ANSWERED]) {
        await seedDecision(cast, WEBSITE, website, decision);
      }
    })(),
    (async () => {
      await seedBoard(cast, now, HANDBOOK, HANDBOOK_GOALS, HANDBOOK_TASKS);
      await seedPages(cast, HANDBOOK, HANDBOOK_PAGES);
    })(),
    (async () => {
      const ops = await seedBoard(cast, now, OPS, OPS_GOALS, OPS_TASKS);
      for (const decision of OPS_DECISIONS) {
        await seedDecision(cast, OPS, ops, decision);
      }
    })(),
    seedPages(cast, WEBSITE, WEBSITE_PAGES),
    seedAgents(cast, runners, website, now),
  ]);

  // The example plugin, greeted, so that its widget and its page have something to say.
  for (const [who, to] of [
    ["carol", "Dana"],
    ["bob", "everyone at the new office"],
    ["alice", "Carol"],
  ] as const) {
    await cast.as(who).plugin("hello").command("greet", { args: { to } });
  }

  // Someone who said something and is no longer in.
  await admin.updatePerson(idOf(LEAVING), { status: "deactivated" });

  // The administrator's front page: the projects at every size they come in, beside the
  // example plugin's widget, at every width of the grid.
  const tile = (key: string): string => `project:${projectIds.get(key) ?? ""}`;
  const board = `project:${options.board.id}`;
  const widget = "widget:hello:latest";
  const home: RestHome = {
    hidden: [],
    layouts: {
      12: [
        { tile: tile(WEBSITE), x: 0, y: 0, size: "large" },
        { tile: board, x: 4, y: 0, size: "wide" },
        { tile: tile(HANDBOOK), x: 4, y: 2, size: "medium" },
        { tile: tile(OPS), x: 8, y: 2, size: "small" },
        { tile: tile(LAB), x: 10, y: 2, size: "icon" },
        { tile: widget, x: 0, y: 4, size: "medium" },
      ],
      8: [
        { tile: board, x: 0, y: 0, size: "wide" },
        { tile: tile(WEBSITE), x: 0, y: 2, size: "large" },
        { tile: tile(HANDBOOK), x: 4, y: 2, size: "medium" },
        { tile: tile(OPS), x: 4, y: 4, size: "small" },
        { tile: tile(LAB), x: 6, y: 4, size: "icon" },
        { tile: widget, x: 0, y: 6, size: "medium" },
      ],
      6: [
        { tile: tile(WEBSITE), x: 0, y: 0, size: "large" },
        { tile: tile(OPS), x: 4, y: 0, size: "small" },
        { tile: tile(LAB), x: 4, y: 2, size: "icon" },
        { tile: board, x: 0, y: 4, size: "medium" },
        { tile: widget, x: 4, y: 4, size: "small" },
        { tile: tile(HANDBOOK), x: 0, y: 6, size: "medium" },
      ],
      4: [
        { tile: tile(WEBSITE), x: 0, y: 0, size: "large" },
        { tile: board, x: 0, y: 4, size: "medium" },
        { tile: tile(HANDBOOK), x: 0, y: 6, size: "medium" },
        { tile: tile(OPS), x: 0, y: 8, size: "small" },
        { tile: widget, x: 2, y: 8, size: "small" },
        { tile: tile(LAB), x: 0, y: 10, size: "icon" },
      ],
    },
  };
  await admin.updateMe({ home });

  await agePreviewAgents(harness, now);
}

/** A command signed in as whoever the cookie carries, as an agent account's own is: its secret. */
async function commandOf(harness: Harness, origin: string, cookie: string): Promise<string> {
  const json = { "content-type": "application/json" };
  const begun = await harness.request(REST_ROUTES.connect, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ agent: "console", as: "self" }),
  });
  const connection = restConnectionSchema.parse(await begun.json());
  await harness.request(connectPath(connection.code, "approve"), {
    method: "POST",
    headers: { ...json, cookie, origin },
  });
  const claimed = await harness.request(CLAIM_PATH, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ secret: connection.secret }),
  });
  const claim = restClaimSchema.parse(await claimed.json());
  if (claim.status !== "signed_in") {
    throw new Error("the account's command was not signed in");
  }
  return claim.secret;
}

/** A board's tasks as they were made, by title. */
type Board = ReadonlyMap<string, { readonly id: string; readonly number: number }>;

/** The goals and the tasks of one project, each written by whoever the data names. */
async function seedBoard(
  cast: Cast,
  now: Date,
  key: string,
  goals: readonly GoalData[],
  tasks: readonly TaskData[],
): Promise<Board> {
  const goalIds = new Map<string, string>();
  for (const goal of goals) {
    const made = await cast
      .as("alice")
      .project(key)
      .createGoal({
        title: goal.title,
        state: goal.state,
        category: goal.category ?? null,
        ...(goal.body === undefined ? {} : { body: goal.body }),
        startsOn: goal.starts === undefined ? null : dayFrom(now, goal.starts),
        dueOn: goal.due === undefined ? null : dayFrom(now, goal.due),
      });
    goalIds.set(goal.title, made.id);
  }
  const board = new Map<string, { readonly id: string; readonly number: number }>();
  for (const task of tasks) {
    const made = await cast
      .as(task.by ?? "alice")
      .project(key)
      .createTask({
        title: task.title,
        state: task.state,
        priority: task.priority ?? "normal",
        category: task.category ?? null,
        ...(task.body === undefined ? {} : { body: task.body }),
        workerIds: (task.workers ?? []).map(cast.idOf),
        goalId: task.goal === undefined ? null : (goalIds.get(task.goal) ?? null),
        parentId: task.parent === undefined ? null : (board.get(task.parent)?.id ?? null),
        startsOn: task.starts === undefined ? null : dayFrom(now, task.starts),
        dueOn: task.due === undefined ? null : dayFrom(now, task.due),
      });
    board.set(task.title, { id: made.id, number: made.number });
  }
  return board;
}

/** Whoever the data names, through the agent it names where it names one. */
const actor = (
  cast: Cast,
  one: { readonly by: Who; readonly through?: string },
): Promise<ConsoleClient> =>
  one.through === undefined
    ? Promise.resolve(cast.as(one.by))
    : cast.through(one.by as Member, one.through);

/**
 * The discussion on the task that shows everything: its comments, and its runs as far as each
 * got; and the runs under way on other tasks, which a task that waits for an answer cannot hold.
 */
async function seedThread(cast: Cast, board: Board): Promise<void> {
  const taskId = board.get(FULL_TASK)?.id;
  if (taskId === undefined) {
    throw new Error("the task with everything on it was not made");
  }
  const [first, ...later] = COMMENTS;
  const say = async (comment: (typeof COMMENTS)[number]): Promise<void> => {
    await (await actor(cast, comment)).project(WEBSITE).comment(taskId, {
      body: comment.body,
      files: (comment.files ?? []).map(uploadOf),
    });
  };
  if (first !== undefined) {
    await say(first);
  }
  for (const [index, run] of RUNS.entries()) {
    const project = (await actor(cast, run)).project(WEBSITE);
    const started = await project.startRun({
      taskId: run.task === undefined ? taskId : (board.get(run.task)?.id ?? taskId),
    });
    for (const report of run.reports) {
      await project.report(started.id, { body: report });
    }
    for (const link of run.links ?? []) {
      await project.handIn(started.id, link);
    }
    for (const file of run.files ?? []) {
      await project.handInFile(started.id, uploadOf(file));
    }
    if (run.asks !== undefined) {
      await seedDecision(cast, WEBSITE, board, { ...run.asks, task: FULL_TASK }, started.id);
    }
    if (run.end !== undefined) {
      await project.endRun(started.id, run.end);
    }
    // The comments between the runs, as people said them while the work went on.
    const next = later[index];
    if (next !== undefined) {
      await say(next);
    }
  }
  for (const comment of later.slice(RUNS.length)) {
    await say(comment);
  }
}

/** One decision: raised by whoever asks, with its pictures, and answered where the data says how. */
async function seedDecision(
  cast: Cast,
  key: string,
  board: Board,
  decision: DecisionData,
  runId?: string,
): Promise<void> {
  const project = (await actor(cast, decision)).project(key);
  const raised = await project.raiseDecision(
    {
      question: decision.question,
      ...(decision.body === undefined ? {} : { body: decision.body }),
      options: decision.options.map((label) => ({ label })),
      taskId: decision.task === undefined ? null : (board.get(decision.task)?.id ?? null),
      ...(runId === undefined ? {} : { runId }),
      deciderIds: decision.to.map(cast.idOf),
    },
    (decision.files ?? []).map(uploadOf),
  );
  const { answer } = decision;
  if (answer === undefined) {
    return;
  }
  const decider = (
    answer.through === undefined
      ? cast.as(answer.by)
      : await cast.through(answer.by, answer.through)
  ).project(key);
  await decider.answerDecision(raised.id, {
    ...(answer.own === undefined
      ? { option: raised.options[answer.option ?? 0]?.id ?? "" }
      : { own: answer.own }),
    ...(answer.note === undefined ? {} : { note: answer.note }),
  });
  if (answer.outcome !== undefined) {
    await decider.updateDecision(raised.id, { outcome: answer.outcome });
  }
}

/** A project's documents, each version written in turn by whoever keeps the page, with its files. */
async function seedPages(cast: Cast, key: string, pages: readonly PageData[]): Promise<void> {
  for (const page of pages) {
    const project = cast.as(page.by ?? "alice").project(key);
    let version: number | undefined;
    for (const body of page.versions) {
      const written = await project.writeDocument(page.path, {
        title: page.title,
        body,
        ...(version === undefined ? {} : { baseVersion: version }),
      });
      version = written.version;
    }
    for (const file of page.files ?? []) {
      await project.attachFile(page.path, uploadOf(file));
    }
  }
}

const MACHINE_OS = "macOS 15.1";
const PRODUCTS = {
  claude: { driver: "claude", name: "Claude Code", version: "2.1.321", tried: true },
  codex: { driver: "codex", name: "Codex", version: "0.164.0", tried: true },
} as const;
const OFFERS = {
  claude: {
    models: ["opus", "sonnet"],
    efforts: ["low", "medium", "high"],
    steer: true,
    images: true,
    resume: true,
  },
  codex: {
    models: ["gpt-6-luna"],
    efforts: ["low", "high"],
    steer: false,
    images: true,
    resume: true,
  },
} as const;

/** Why an agent stands as it does, as its runner says it. */
const REASONS = {
  running: "started",
  stopped: "stop",
  refused: "model_refused",
  failed: "sign_in",
  unheard: "started",
} as const;

/**
 * The agent accounts as their runners left them: each heard from, saying how its agent stands;
 * the one at work with a session that holds a conversation, a session before it, what its
 * supervisor told it, its secrets and the accounts it holds elsewhere.
 */
async function seedAgents(
  cast: Cast,
  runners: ReadonlyMap<Agent, ConsoleClient>,
  board: Board,
  now: Date,
): Promise<void> {
  const admin = cast.as("alice");
  for (const agent of AGENTS) {
    const runner = runners.get(agent.handle);
    const { state } = agent;
    if (runner === undefined || state === "invited") {
      continue;
    }
    const machine = { name: agent.machine, os: MACHINE_OS, user: agent.handle };
    const product = PRODUCTS[agent.product];
    const beat = async (session: string | null, delivered: number): Promise<void> => {
      await runner.runnerHeartbeat({
        state: state === "unheard" ? "running" : state,
        reason: REASONS[state],
        delivered,
        session,
        machine,
        runner: APP_VERSION,
        product,
        offers: {
          ...OFFERS[agent.product],
          models: [...OFFERS[agent.product].models],
          efforts: [...OFFERS[agent.product].efforts],
        },
        running: { model: null, effort: null },
      });
    };
    if (agent.handle !== "mira") {
      // A session that ended as the agent came to stand: stopped, refused, or never signed in.
      const session = await runner.beginAgentSession({
        product,
        model: null,
        effort: null,
        resumed: false,
        machine,
      });
      const at = new Date(now.getTime() - agent.since * 60_000).toISOString();
      await runner.sendTranscript(session.id, {
        events: [
          { n: 1, kind: "status", at, text: "The product started." },
          ...(state === "refused"
            ? [{ n: 2, kind: "error" as const, at, text: "The model refused to answer." }]
            : state === "failed"
              ? [
                  {
                    n: 2,
                    kind: "error" as const,
                    at,
                    text: "The product is not signed in: sign in on the machine and start the agent again.",
                  },
                ]
              : []),
        ],
      });
      let delivered = 0;
      if (state === "stopped") {
        delivered = (await cast.as(agent.manager).sendSignal(agent.handle, { kind: "stop" }))
          .number;
      }
      if (state !== "running" && state !== "unheard") {
        await runner.endAgentSession(session.id, {
          how: state === "stopped" ? "stopped" : "crashed",
        });
      }
      await beat(state === "unheard" ? session.id : null, delivered);
      continue;
    }

    // Mira, at work: what she keeps of her own, a session that was restarted, and the open one.
    const own = cast.as("mira");
    await admin.updateAgent("mira", {
      dayStart: "09:00",
      dayEnd: "18:00",
      accounts: { github: "acme-mira", slack: "mira" },
    });
    await own.setSecret("git.token", {
      value: "invented-for-the-preview",
      expiresOn: dayFrom(now, 9),
    });
    await own.setSecret("slack.token", { value: "invented-for-the-preview" });
    await admin.seedAgentSecret("mira", "preview.password", { value: "invented-for-the-preview" });
    await own.secret("git.token");

    const before = await runner.beginAgentSession({
      product,
      model: "sonnet",
      effort: null,
      resumed: false,
      machine,
    });
    const earlier = new Date(now.getTime() - 26 * 3_600_000).toISOString();
    await runner.sendTranscript(before.id, {
      events: [
        { n: 1, kind: "status", at: earlier, text: "The product started." },
        {
          n: 2,
          kind: "assistant",
          at: earlier,
          text: "Nothing waits for me. I am going over my notes.",
        },
        {
          n: 3,
          kind: "status",
          at: earlier,
          text: "The turn completed.",
          data: { turn: "completed" },
        },
      ],
    });
    await runner.endAgentSession(before.id, { how: "restarted" });
    const chosen = await admin.sendSignal("mira", {
      kind: "set",
      set: { model: "opus", effort: "high" },
    });

    const session = await runner.beginAgentSession({
      product,
      model: "opus",
      effort: "high",
      resumed: true,
      machine,
    });
    const told = await admin.sendSignal("mira", {
      kind: "tell",
      text: "Before you go on: does the button move when an error shows? It did on the old form.",
    });
    const numbers = {
      "{errors}": board.get(FIELD_ERRORS)?.number ?? 0,
      "{link}": board.get(CONFIRMATION_LINK)?.number ?? 0,
    };
    const worded = (text: string): string =>
      Object.entries(numbers).reduce(
        (out, [mark, number]) => out.replaceAll(mark, String(number)),
        text,
      );
    const facts = (data: Readonly<Record<string, string | number | boolean | null>>) =>
      Object.fromEntries(
        Object.entries(data).map(([name, value]) => [
          name,
          typeof value === "string" ? worded(value) : value,
        ]),
      );
    const length = SESSION_SCRIPT.reduce((sum, event) => sum + event.after, 0);
    let clock = now.getTime() - (length + 90) * 1000;
    const events = [];
    for (const [index, event] of SESSION_SCRIPT.entries()) {
      clock += event.after * 1000;
      const picture =
        event.picture === undefined
          ? undefined
          : await runner.uploadTranscriptFile(session.id, uploadOf(event.picture));
      events.push({
        n: index + 1,
        kind: event.kind,
        at: new Date(clock).toISOString(),
        text: worded(event.text),
        ...(event.data === undefined
          ? {}
          : {
              data:
                event.kind === "person"
                  ? { ...facts(event.data), signal: told.number }
                  : facts(event.data),
            }),
        ...(picture === undefined ? {} : { files: [picture.id] }),
      });
    }
    await runner.sendTranscript(session.id, { events });
    await runner.runnerHeartbeat({
      state: "running",
      reason: "resumed",
      delivered: Math.max(told.number, chosen.number),
      session: session.id,
      machine,
      runner: APP_VERSION,
      product,
      offers: {
        ...OFFERS.claude,
        models: [...OFFERS.claude.models],
        efforts: [...OFFERS.claude.efforts],
      },
      running: { model: "opus", effort: "high" },
    });
    // One more that she has not read yet: it waits on the page beside the way to have it read now.
    await admin.sendSignal("mira", {
      kind: "tell",
      text: "When the confirmation link is fixed, say so on the task and move it to review.",
    });
  }
}

/**
 * How long each agent account has stood as it does, and when its runner was last heard from,
 * written back in time; and the one that is unheard, which the console itself notes of a runner
 * that went quiet, after a while nobody here waits for. The one thing the REST API cannot make.
 */
async function agePreviewAgents(harness: Harness, now: Date): Promise<void> {
  const handle = drizzleOf(harness.database);
  for (const agent of AGENTS) {
    if (agent.state === "invited") {
      continue;
    }
    const since = new Date(now.getTime() - agent.since * 60_000).toISOString();
    const heard = new Date(now.getTime() - agent.heard * 60_000).toISOString();
    await handle.execute(sql`
      update agent_runners
      set state_at = ${since}::timestamptz,
          heard_at = ${heard}::timestamptz
          ${agent.state === "unheard" ? sql`, state = 'unheard', reason = 'no_heartbeat'` : sql``}
      where person_id = (select id from people where handle = ${agent.handle})
    `);
  }
}
