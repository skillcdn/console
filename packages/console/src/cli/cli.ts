import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import {
  ApiError,
  type ConsoleClient,
  createClient,
  type FetchLike,
  type ProjectClient,
} from "../client.js";
import { MAX_OPTIONS, MIN_OPTIONS } from "../limits.js";
import type { RestClaim, RestDecision } from "../schemas.js";
import { TASK_PRIORITIES, TASK_STATES, type TaskPriority, type TaskState } from "../vocabulary.js";
import type { CredentialStore } from "./credentials.js";
import type { DirectoryStore } from "./directory.js";
import {
  formatAnswer,
  formatDecision,
  formatDecisionLine,
  formatDocument,
  formatDocuments,
  formatOptions,
  formatProjectLine,
  formatRun,
  formatRunLine,
  formatSkills,
  formatTask,
  formatTaskLine,
  formatVersion,
  formatVersionLine,
} from "./format.js";
import { COMMAND_HELP, helpFor, usage } from "./help.js";

// The `console` command (docs/specs/cli.md): the agent's side of the console. A thin client of
// the REST API with no logic of its own: every command is one or two requests and the words to
// say what came back. It takes what it needs from `CliIo`, so that tests run it whole, against
// the app and no socket, with a store and readers of their own. The board is a project's: every
// command on it works in the project the flag, the environment or the working directory names.

/** The exit codes of the command, for whoever runs it: a shell, a hook, an agent. */
export const EXIT = {
  ok: 0,
  /** The console refused, or could not be reached; the reason is on stderr. */
  failed: 1,
  /** The command was not understood. */
  usage: 2,
  /** The decision still waits for a person. */
  waiting: 3,
} as const;

/** How long one request for a decision's answer asks the console to hold it: what the server allows. */
const WAIT_STEP_SECONDS = 50;
/** A breath between two such requests, should the console answer at once. */
const WAIT_PAUSE_MS = 500;
/** How long `ask` waits when nothing is said: within what an agent's shell gives a command. */
const DEFAULT_ASK_WAIT_SECONDS = 60;
/** The longest wait a person may ask for: a day. */
const MAX_WAIT_SECONDS = 86_400;

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly fetch: FetchLike;
  /** All of standard input, for a body given as `-`, or a token given to login. */
  readonly readStdin: () => Promise<string>;
  /** The name of the machine, for the agent to say where it runs; nothing when unknown. */
  readonly hostname?: string | undefined;
  /** A file named with `--file`, as text. */
  readonly readFile: (path: string) => Promise<string>;
  /** A file handed in, as bytes. */
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  readonly store: CredentialStore;
  /** What the working directory says of the project, and the way to write it. */
  readonly directory: DirectoryStore;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** The version of the package the command runs from, when the entry point knows it. */
  readonly version?: string | undefined;
}

/** The command stops with an exit code and a word on stderr. */
class CliExit extends Error {
  readonly exit: number;

  constructor(exit: number, message: string) {
    super(message);
    this.name = "CliExit";
    this.exit = exit;
  }
}

const failed = (message: string): CliExit => new CliExit(EXIT.failed, message);
const misuse = (message: string): CliExit => new CliExit(EXIT.usage, message);

type OptionSpec = Readonly<
  Record<string, { readonly type: "string" | "boolean"; readonly multiple?: boolean }>
>;

const GLOBAL_OPTIONS: OptionSpec = {
  json: { type: "boolean" },
  url: { type: "string" },
  project: { type: "string" },
};

function parse(args: readonly string[], options: OptionSpec, allowPositionals = true) {
  try {
    return parseArgs({
      args: [...args],
      options: { ...GLOBAL_OPTIONS, ...options },
      allowPositionals,
      strict: true,
    });
  } catch (error) {
    throw misuse(error instanceof Error ? error.message : "The arguments were not understood.");
  }
}

type Values = ReturnType<typeof parse>["values"];

const text = (values: Values, name: string): string | undefined => {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
};
const on = (values: Values, name: string): boolean => values[name] === true;
const texts = (values: Values, name: string): string[] => {
  const value = values[name];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
};

interface Session {
  readonly client: ConsoleClient;
  readonly url: string;
  readonly json: boolean;
  /** The project the command works in: named by `--project`, the environment, or the working directory. */
  project(): Promise<ProjectClient>;
  /** The key of that project, or nothing when none is named. */
  projectKey(): Promise<string | undefined>;
}

const NO_PROJECT =
  "Say which project: --project <key>, CONSOLE_PROJECT in the environment, or console use <key> once in this directory. console projects lists the projects you may work in.";

/** The console and the token to talk to it with: the flags, the environment, then what login kept. */
async function open(io: CliIo, values: Values): Promise<Session> {
  const stored = await io.store.load();
  const url = text(values, "url") ?? io.env.CONSOLE_URL ?? stored?.url;
  const token = io.env.CONSOLE_TOKEN ?? stored?.token;
  if (url === undefined || token === undefined) {
    throw failed(
      "Not signed in. A person signs the command in: console login --url <the console's origin>",
    );
  }
  const client = createClient({ baseUrl: url, token, fetch: io.fetch });
  const projectKey = async () =>
    text(values, "project") ?? io.env.CONSOLE_PROJECT ?? (await io.directory.load())?.project;
  return {
    client,
    url,
    json: on(values, "json"),
    projectKey,
    async project() {
      const key = await projectKey();
      if (key === undefined) {
        throw failed(NO_PROJECT);
      }
      return client.project(key);
    },
  };
}

/** Prints what came back: the console's JSON on `--json`, the words otherwise. */
function answer(io: CliIo, session: Session, value: unknown, words: () => string): void {
  io.stdout(session.json ? `${JSON.stringify(value, null, 2)}\n` : `${words()}\n`);
}

/** The run a command on a run means: the one named, else the one open run of this token in the project. */
async function currentRun(project: ProjectClient, values: Values): Promise<string> {
  const given = text(values, "run");
  if (given !== undefined) {
    return given;
  }
  const { items } = await project.runs({ open: true, mine: true });
  const [only] = items;
  if (only !== undefined && items.length === 1) {
    return only.id;
  }
  if (items.length === 0) {
    throw failed(
      "No run of yours is open in this project. Take a task first: console take <number>",
    );
  }
  throw failed(
    `Several runs of yours are open; say which with --run <id>:\n${items.map((run) => `  ${formatRunLine(run)}`).join("\n")}`,
  );
}

/** A Markdown body: from `--file`, from standard input for `-`, or as given. */
async function bodyOf(
  io: CliIo,
  values: Values,
  given: string | undefined,
): Promise<string | undefined> {
  const file = text(values, "file");
  if (file !== undefined) {
    return io.readFile(file);
  }
  return given === "-" ? io.readStdin() : given;
}

function originOf(value: string): string {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (
    url === undefined ||
    !/^https?:$/.test(url.protocol) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw misuse(
      `Not an origin: ${value}. Say the console's address without a path, such as https://console.example.com`,
    );
  }
  return url.origin;
}

function stateOf(value: string | undefined): TaskState | undefined {
  if (value === undefined) {
    return undefined;
  }
  const found = TASK_STATES.find((state) => state === value);
  if (found === undefined) {
    throw misuse(`Not a state: ${value}. One of ${TASK_STATES.join(", ")}`);
  }
  return found;
}

function priorityOf(value: string | undefined): TaskPriority | undefined {
  if (value === undefined) {
    return undefined;
  }
  const found = TASK_PRIORITIES.find((priority) => priority === value);
  if (found === undefined) {
    throw misuse(`Not a priority: ${value}. One of ${TASK_PRIORITIES.join(", ")}`);
  }
  return found;
}

function secondsOf(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_WAIT_SECONDS) {
    throw misuse(`Not a number of seconds to wait: ${value}`);
  }
  return seconds;
}

/** One positional, and nothing else. */
function theOne(positionals: readonly string[], ask: string): string {
  const [first] = positionals;
  if (first === undefined || positionals.length > 1) {
    throw misuse(ask);
  }
  return first;
}

/**
 * The decision once answered, or as it stands when the wait is over. Each request asks the
 * console to hold it for a while, so the answer arrives as soon as a person gives it.
 */
async function waitForAnswer(
  io: CliIo,
  project: ProjectClient,
  decision: RestDecision,
  seconds: number,
): Promise<RestDecision> {
  const deadline = io.now() + seconds * 1000;
  let current = decision;
  for (;;) {
    const left = deadline - io.now();
    if (current.answer !== null || left <= 0) {
      return current;
    }
    current = await project.awaitDecision(
      current.id,
      Math.max(1, Math.min(Math.ceil(left / 1000), WAIT_STEP_SECONDS)),
    );
    if (current.answer === null) {
      await io.sleep(WAIT_PAUSE_MS);
    }
  }
}

const stillWaiting = (id: string): string =>
  `Decision ${id} still waits for a person; the run waits with it. Keep waiting with: console decision ${id} --wait 100, as often as needed. Meanwhile, go on only with work that does not depend on the answer.`;

/**
 * Waits for the answer and says what it is, or that it is still to come. On `--json`, a decision
 * printed already as it was raised (`shown`) is printed again only with its answer.
 */
async function settle(
  io: CliIo,
  session: Session,
  project: ProjectClient,
  decision: RestDecision,
  seconds: number,
  shown = false,
): Promise<number> {
  const outcome =
    decision.answer === null && seconds > 0
      ? await waitForAnswer(io, project, decision, seconds)
      : decision;
  if (session.json) {
    if (!shown || outcome.answer !== null) {
      io.stdout(`${JSON.stringify(outcome, null, 2)}\n`);
    }
  } else {
    io.stdout(`${outcome.answer === null ? stillWaiting(outcome.id) : formatAnswer(outcome)}\n`);
  }
  return outcome.answer === null ? EXIT.waiting : EXIT.ok;
}

type Command = (args: readonly string[], io: CliIo) => Promise<number>;

/** Checks a token against the console, keeps it with the address, and says who it is. */
async function keep(io: CliIo, url: string, token: string, agent?: string): Promise<number> {
  const me = await createClient({ baseUrl: url, token, fetch: io.fetch }).me();
  const person = me.person;
  if (person === null) {
    throw failed(
      "The console does not know this token. Make one on your Agents page and try again.",
    );
  }
  const kept = await io.store.save({ url, token });
  io.stdout(
    `${agent === undefined ? "Signed in" : `Connected as "${agent}"`} to ${me.workspace.name} at ${url} as ${person.login} (${person.role}). The token is kept in ${kept}.\nNext, say which project this directory works in: console use <key> (console projects lists them).\n`,
  );
  return EXIT.ok;
}

const login: Command = async (args, io) => {
  const { values } = parse(
    args,
    { "token-stdin": { type: "boolean" }, agent: { type: "string" } },
    false,
  );
  const stored = await io.store.load();
  const wanted = text(values, "url") ?? io.env.CONSOLE_URL ?? stored?.url;
  if (wanted === undefined) {
    throw misuse("Say where the console is: console login --url https://console.example.com");
  }
  const url = originOf(wanted);
  if (on(values, "token-stdin")) {
    const token = (await io.readStdin()).trim();
    if (token.length === 0) {
      throw failed("No token was given.");
    }
    return keep(io, url, token);
  }
  // A connection (ADR-0011): a code a person approves on the console's own pages, and the token
  // handed over here once, never shown.
  const client = createClient({ baseUrl: url, fetch: io.fetch });
  const agent = text(values, "agent") ?? "The console command";
  const begun = await client.connect({
    agent: io.hostname === undefined ? agent : `${agent} on ${io.hostname}`,
  });
  io.stdout(
    `To connect this agent, a person opens ${begun.url} signed in, checks that the page shows the code ${begun.code}, names the agent and approves.\nWaiting for that, until ${begun.expiresAt}.\n`,
  );
  for (;;) {
    await io.sleep(begun.interval * 1000);
    let claim: RestClaim;
    try {
      claim = await client.claimConnection(begun.secret);
    } catch (error) {
      if (error instanceof ApiError && error.code === "connect.not_found") {
        throw failed(
          "The connection was not approved in time, or the person said it was not theirs. Run console login again for a new code.",
        );
      }
      throw error;
    }
    if (claim.status === "connected") {
      return keep(io, url, claim.secret, claim.token.name);
    }
  }
};

const logout: Command = async (args, io) => {
  parse(args, {}, false);
  await io.store.clear();
  io.stdout("Signed out here. The token itself is removed on your Agents page.\n");
  return EXIT.ok;
};

const whoami: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const me = await session.client.me();
  const person = me.person;
  if (person === null) {
    throw failed("The console does not know this token. Sign in again: console login");
  }
  const key = await session.projectKey();
  answer(
    io,
    session,
    { ...me, project: key ?? null },
    () =>
      `${person.login} (${person.role}) at ${me.workspace.name}, ${session.url}${key === undefined ? "; no project named here" : `; project ${key}`}`,
  );
  return EXIT.ok;
};

const projects: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const found = await session.client.projects();
  answer(io, session, found, () =>
    found.items.length === 0
      ? "No projects you may work in. A person makes one on the console's Projects page."
      : found.items.map(formatProjectLine).join("\n"),
  );
  return EXIT.ok;
};

const use: Command = async (args, io) => {
  const { values, positionals } = parse(args, {});
  const key = theOne(positionals, "Say which project: console use <key>");
  const session = await open(io, values);
  const project = await session.client.project(key).get();
  const kept = await io.directory.save({ project: project.key });
  answer(
    io,
    session,
    project,
    () =>
      `Working in ${project.name} (${project.key}) from this directory on: kept in ${kept}, which is meant to be committed.`,
  );
  return EXIT.ok;
};

const tasks: Command = async (args, io) => {
  const { values } = parse(args, { state: { type: "string" } }, false);
  const state = stateOf(text(values, "state"));
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.tasks(state === undefined ? {} : { state });
  answer(io, session, found, () =>
    found.items.length === 0 ? "No tasks." : found.items.map(formatTaskLine).join("\n"),
  );
  return EXIT.ok;
};

const skills: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.skills();
  answer(io, session, found, () => formatSkills(found));
  return EXIT.ok;
};

const newTask: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    body: { type: "string" },
    file: { type: "string" },
    state: { type: "string" },
    priority: { type: "string" },
  });
  const title = theOne(positionals, 'Say the title: console task new "<title>"');
  const state = stateOf(text(values, "state"));
  const priority = priorityOf(text(values, "priority"));
  const body = await bodyOf(io, values, text(values, "body"));
  const session = await open(io, values);
  const project = await session.project();
  const made = await project.createTask({
    title,
    ...(body === undefined ? {} : { body }),
    ...(state === undefined ? {} : { state }),
    ...(priority === undefined ? {} : { priority }),
  });
  answer(io, session, made, () => `Task #${made.number} written: ${made.title}\nid: ${made.id}`);
  return EXIT.ok;
};

const task: Command = async (args, io) => {
  if (args[0] === "new") {
    return newTask(args.slice(1), io);
  }
  const { values, positionals } = parse(args, {});
  const ref = theOne(positionals, "Say which task: console task <number|id>");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.task(ref);
  const [decisions, runs] = await Promise.all([
    project.decisions({ task: found.id }),
    project.runs({ task: found.id }),
  ]);
  answer(io, session, { task: found, decisions: decisions.items, runs: runs.items }, () =>
    formatTask(found, decisions.items, runs.items),
  );
  return EXIT.ok;
};

const take: Command = async (args, io) => {
  const { values, positionals } = parse(args, { agent: { type: "string" } });
  const ref = theOne(positionals, "Say which task: console take <number|id>");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.task(ref);
  const agent = text(values, "agent");
  const run = await project.startRun({
    taskId: found.id,
    ...(agent === undefined ? {} : { agent }),
  });
  answer(io, session, { run, task: found }, () =>
    [
      `Run ${run.id} began on #${found.number} ${found.title}, as "${run.agent}" for ${run.person.login}. The task is in progress and theirs.`,
      "",
      formatTask(found),
      "",
      'Say how it goes: console report "<what you found or did>". Hand in what you make: console hand-in <https url | file path>.',
      'Ask when a person must decide: console ask "<question>" --option "..." --option "...". End with: console finish --summary "<what was done, what is left>".',
    ].join("\n"),
  );
  return EXIT.ok;
};

const report: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    file: { type: "string" },
    run: { type: "string" },
  });
  if (positionals.length > 1) {
    throw misuse('Say the report as one argument: console report "<markdown>"');
  }
  const body = await bodyOf(io, values, positionals[0]);
  if (body === undefined) {
    throw misuse(
      'Say what to report: console report "<markdown>", or --file <path>, or - to read standard input.',
    );
  }
  const session = await open(io, values);
  const project = await session.project();
  const runId = await currentRun(project, values);
  const run = await project.report(runId, { body });
  answer(
    io,
    session,
    run,
    () =>
      `Reported on run ${run.id}: ${run.reports.length} report${run.reports.length === 1 ? "" : "s"} so far.`,
  );
  return EXIT.ok;
};

/** The media types of the kinds of file an agent hands in, by extension; the rest is bytes. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

const soFar = (count: number): string => `${count} artifact${count === 1 ? "" : "s"} so far.`;

const handIn: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    label: { type: "string" },
    run: { type: "string" },
  });
  const what = theOne(
    positionals,
    "Say what to hand in: console hand-in <https url | file path> [--label <words>]",
  );
  const label = text(values, "label");
  const session = await open(io, values);
  const project = await session.project();
  const runId = await currentRun(project, values);
  // A URL is handed in as a link, and the console says whether it takes it; anything else
  // names a file on this machine.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(what)) {
    const run = await project.handIn(runId, {
      url: what,
      ...(label === undefined ? {} : { label }),
    });
    answer(
      io,
      session,
      run,
      () => `Handed in ${what} on run ${run.id}: ${soFar(run.artifacts.length)}`,
    );
    return EXIT.ok;
  }
  let bytes: Uint8Array;
  try {
    bytes = await io.readBytes(what);
  } catch {
    throw failed(`No file could be read at ${what}. Hand in an https link, or the path of a file.`);
  }
  const name = basename(what);
  const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
  const run = await project.handInFile(runId, {
    name,
    bytes,
    ...(contentType === undefined ? {} : { contentType }),
    ...(label === undefined ? {} : { label }),
  });
  answer(
    io,
    session,
    run,
    () =>
      `Handed in the file ${name} (${bytes.byteLength} bytes) on run ${run.id}: ${soFar(run.artifacts.length)}`,
  );
  return EXIT.ok;
};

const ask: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    option: { type: "string", multiple: true },
    body: { type: "string" },
    file: { type: "string" },
    run: { type: "string" },
    wait: { type: "string" },
  });
  const question = theOne(
    positionals,
    'Say the question: console ask "<question>" --option "<label>" --option "<label>"',
  );
  const options = texts(values, "option");
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw misuse(`Give ${MIN_OPTIONS} to ${MAX_OPTIONS} options, one --option each.`);
  }
  const seconds = secondsOf(text(values, "wait"), DEFAULT_ASK_WAIT_SECONDS);
  const body = await bodyOf(io, values, text(values, "body"));
  const session = await open(io, values);
  const project = await session.project();
  const runId = await currentRun(project, values);
  const raised = await project.raiseDecision({
    question,
    options: options.map((label) => ({ label })),
    runId,
    ...(body === undefined ? {} : { body }),
  });
  // The id is printed before any waiting, so that a wait cut short loses nothing.
  io.stdout(
    session.json
      ? `${JSON.stringify(raised, null, 2)}\n`
      : `Decision ${raised.id} raised on run ${runId}; the run waits for a person.\n${formatOptions(raised)}\n`,
  );
  return settle(io, session, project, raised, seconds, true);
};

const decision: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    wait: { type: "string" },
    outcome: { type: "string" },
    file: { type: "string" },
  });
  const id = theOne(
    positionals,
    "Say which decision: console decision <id> [--wait <seconds>] [--outcome <markdown>|--file <path>]",
  );
  const seconds = secondsOf(text(values, "wait"), 0);
  const outcome = await bodyOf(io, values, text(values, "outcome"));
  const session = await open(io, values);
  const project = await session.project();
  if (outcome !== undefined) {
    // What followed the decision: the record grows, and is printed as it stands.
    const grown = await project.updateDecision(id, { outcome });
    answer(io, session, grown, () => formatDecision(grown));
    return EXIT.ok;
  }
  const found = await project.decision(id);
  if (seconds === 0) {
    answer(io, session, found, () => formatDecision(found));
    return EXIT.ok;
  }
  return settle(io, session, project, found, seconds);
};

const docs: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    search: { type: "string" },
    archived: { type: "boolean" },
  });
  if (positionals.length > 1) {
    throw misuse("Say one folder: console docs [<folder>] [--search <words>] [--archived]");
  }
  const search = text(values, "search");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.documents({
    ...(positionals[0] === undefined ? {} : { folder: positionals[0] }),
    ...(search === undefined ? {} : { q: search }),
    ...(on(values, "archived") ? { archived: true } : {}),
  });
  answer(io, session, found, () => formatDocuments(found));
  return EXIT.ok;
};

const doc: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    version: { type: "string" },
    versions: { type: "boolean" },
  });
  const path = theOne(positionals, "Say which page: console doc <path> [--version <n>|--versions]");
  const session = await open(io, values);
  const project = await session.project();
  if (on(values, "versions")) {
    const found = await project.documentVersions(path);
    answer(io, session, found, () => found.items.map(formatVersionLine).join("\n"));
    return EXIT.ok;
  }
  const wanted = text(values, "version");
  if (wanted !== undefined) {
    const number = Number(wanted);
    if (!Number.isInteger(number) || number < 1) {
      throw misuse(`Not a version number: ${wanted}`);
    }
    const found = await project.documentVersion(path, number);
    answer(io, session, found, () => formatVersion(path, found));
    return EXIT.ok;
  }
  const found = await project.document(path);
  answer(io, session, found, () =>
    formatDocument(found, (fileId) => project.documentFileUrl(path, fileId)),
  );
  return EXIT.ok;
};

const write: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    title: { type: "string" },
    body: { type: "string" },
    file: { type: "string" },
    base: { type: "string" },
  });
  const path = theOne(
    positionals,
    'Say which page: console write <path> --title "<title>" --body <markdown>|--file <path>',
  );
  const body = await bodyOf(io, values, text(values, "body"));
  if (body === undefined) {
    throw misuse(
      "Say what the page is to say: --body <markdown>, --file <path>, or --body - to read standard input.",
    );
  }
  const base = text(values, "base");
  const baseVersion = base === undefined ? undefined : Number(base);
  if (baseVersion !== undefined && (!Number.isInteger(baseVersion) || baseVersion < 1)) {
    throw misuse(`Not a version number: ${base}`);
  }
  const session = await open(io, values);
  const project = await session.project();
  let title = text(values, "title");
  if (title === undefined) {
    // Without a title, the page keeps the one it has; a new page needs one.
    try {
      title = (await project.document(path)).title;
    } catch (error) {
      if (error instanceof ApiError && error.code === "document.not_found") {
        throw misuse(`No page at ${path} yet. Say its title: --title "<title>"`);
      }
      throw error;
    }
  }
  const written = await project.writeDocument(path, {
    title,
    body,
    ...(baseVersion === undefined ? {} : { baseVersion }),
  });
  answer(
    io,
    session,
    written,
    () =>
      `Wrote ${written.path} (${written.title}), version ${written.version}${written.links.length === 0 ? "" : `; refers to ${written.links.map((link) => link.path).join(", ")}`}`,
  );
  return EXIT.ok;
};

const attach: Command = async (args, io) => {
  const { values, positionals } = parse(args, { label: { type: "string" } });
  const [path, file] = positionals;
  if (path === undefined || file === undefined || positionals.length > 2) {
    throw misuse("Say the page and the file: console attach <path> <file> [--label <words>]");
  }
  const label = text(values, "label");
  const session = await open(io, values);
  const project = await session.project();
  let bytes: Uint8Array;
  try {
    bytes = await io.readBytes(file);
  } catch {
    throw failed(`No file could be read at ${file}.`);
  }
  const name = basename(file);
  const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
  const written = await project.attachFile(path, {
    name,
    bytes,
    ...(contentType === undefined ? {} : { contentType }),
    ...(label === undefined ? {} : { label }),
  });
  answer(
    io,
    session,
    written,
    () =>
      `Attached ${name} (${bytes.byteLength} bytes) to ${written.path}: ${written.files.length} file${written.files.length === 1 ? "" : "s"} on the page.`,
  );
  return EXIT.ok;
};

const archive: Command = async (args, io) => {
  const { values, positionals } = parse(args, {});
  const path = theOne(positionals, "Say which page: console archive <path>");
  const session = await open(io, values);
  const project = await session.project();
  const put = await project.archiveDocument(path);
  answer(
    io,
    session,
    put,
    () =>
      `Archived ${put.path} (${put.title}): out of the folders and the search, still readable here.`,
  );
  return EXIT.ok;
};

const restore: Command = async (args, io) => {
  const { values, positionals } = parse(args, {});
  const path = theOne(positionals, "Say which page: console restore <path>");
  const session = await open(io, values);
  const project = await session.project();
  const back = await project.restoreDocument(path);
  answer(io, session, back, () => `Restored ${back.path} (${back.title}).`);
  return EXIT.ok;
};

const decisions: Command = async (args, io) => {
  const { values } = parse(args, { open: { type: "boolean" } }, false);
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.decisions(on(values, "open") ? { open: true } : {});
  answer(io, session, found, () =>
    found.items.length === 0 ? "No decisions." : found.items.map(formatDecisionLine).join("\n"),
  );
  return EXIT.ok;
};

const ending =
  (status: "finished" | "failed"): Command =>
  async (args, io) => {
    const { values } = parse(
      args,
      { summary: { type: "string" }, file: { type: "string" }, run: { type: "string" } },
      false,
    );
    const summary = await bodyOf(io, values, text(values, "summary"));
    const session = await open(io, values);
    const project = await session.project();
    const runId = await currentRun(project, values);
    const run = await project.endRun(runId, {
      status,
      ...(summary === undefined ? {} : { summary }),
    });
    answer(io, session, run, () =>
      status === "finished"
        ? `Run ${run.id} finished; the task is up for review.`
        : `Run ${run.id} failed; the task stays as it is.`,
    );
    return EXIT.ok;
  };

const abandon: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    summary: { type: "string" },
    file: { type: "string" },
    run: { type: "string" },
  });
  if (positionals.length > 1) {
    throw misuse("Say which run: console abandon [<run id>]");
  }
  const summary = await bodyOf(io, values, text(values, "summary"));
  const session = await open(io, values);
  const project = await session.project();
  const runId = positionals[0] ?? (await currentRun(project, values));
  const run = await project.endRun(runId, {
    status: "abandoned",
    ...(summary === undefined ? {} : { summary }),
  });
  answer(io, session, run, () => `Run ${run.id} abandoned; the task stays as it is.`);
  return EXIT.ok;
};

const runs: Command = async (args, io) => {
  const { values } = parse(
    args,
    { task: { type: "string" }, open: { type: "boolean" }, mine: { type: "boolean" } },
    false,
  );
  const session = await open(io, values);
  const project = await session.project();
  const ref = text(values, "task");
  const taskId = ref === undefined ? undefined : (await project.task(ref)).id;
  const found = await project.runs({
    ...(taskId === undefined ? {} : { task: taskId }),
    ...(on(values, "open") ? { open: true } : {}),
    ...(on(values, "mine") ? { mine: true } : {}),
  });
  answer(io, session, found, () =>
    found.items.length === 0 ? "No runs." : found.items.map(formatRunLine).join("\n"),
  );
  return EXIT.ok;
};

const run: Command = async (args, io) => {
  const { values, positionals } = parse(args, {});
  const id = theOne(positionals, "Say which run: console run <id>");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.run(id);
  answer(io, session, found, () => formatRun(found, (artifactId) => project.fileUrl(artifactId)));
  return EXIT.ok;
};

const COMMANDS: Readonly<Record<string, Command>> = {
  login,
  logout,
  whoami,
  projects,
  use,
  tasks,
  task,
  skills,
  take,
  report,
  "hand-in": handIn,
  ask,
  decision,
  decisions,
  finish: ending("finished"),
  fail: ending("failed"),
  abandon,
  runs,
  run,
  docs,
  doc,
  write,
  attach,
  archive,
  restore,
};

function help(io: CliIo, name: string | undefined): number {
  if (name === undefined) {
    io.stdout(usage(io.version));
    return EXIT.ok;
  }
  const found = helpFor(name);
  if (found === undefined) {
    throw misuse(`Not a command: ${name}. The commands: ${Object.keys(COMMAND_HELP).join(", ")}`);
  }
  io.stdout(found);
  return EXIT.ok;
}

/** What a refusal of the console is followed by, when there is something to do about it. */
function hintFor(error: ApiError): string {
  switch (error.code) {
    case "auth.required":
      return "The token is not one the console knows, any more or at all. A person signs the command in again: console login\n";
    case "project.not_found":
      return "No project has this key, or it is not yours to see. console projects lists the projects you may work in.\n";
    case "document.not_found":
      return "No page has this path, in this project. console docs lists the pages of a folder; console write <path> writes one.\n";
    case "document.conflict":
      return "The page has moved on since the version you started from. Read it again, and write from there.\n";
    case "document.archived":
      return "The page is archived. console restore <path> brings it back first.\n";
    case "connect.too_many":
      return "The console holds as many connections as it may at once. Try again in a few minutes.\n";
    case "network":
      return "Is the console's address right? console whoami --url <origin> says what the command uses.\n";
    default:
      return "";
  }
}

/** Runs the command and answers with its exit code. What it prints goes through `io`. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [name, ...rest] = argv;
  try {
    if (name === "--version" || name === "-v" || name === "version") {
      io.stdout(`console ${io.version ?? "(version unknown)"} (@skillcdn/console)\n`);
      return EXIT.ok;
    }
    if (name === undefined || name === "help" || name === "--help" || name === "-h") {
      return help(io, rest[0]);
    }
    if (rest.includes("--help") || rest.includes("-h")) {
      return help(io, name);
    }
    const command = COMMANDS[name];
    if (command === undefined) {
      throw misuse(`Not a command: ${name}. Run: console help`);
    }
    return await command(rest, io);
  } catch (error) {
    if (error instanceof CliExit) {
      io.stderr(`${error.message}\n`);
      return error.exit;
    }
    if (error instanceof ApiError) {
      io.stderr(`${error.code}: ${error.message}\n${hintFor(error)}`);
      return EXIT.failed;
    }
    throw error;
  }
}
