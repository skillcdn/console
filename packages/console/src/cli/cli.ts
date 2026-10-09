import { parseArgs } from "node:util";
import { ApiError, type ConsoleClient, createClient, type FetchLike } from "../client.js";
import { MAX_OPTIONS, MIN_OPTIONS } from "../limits.js";
import type { RestDecision } from "../schemas.js";
import { TASK_PRIORITIES, TASK_STATES, type TaskPriority, type TaskState } from "../vocabulary.js";
import type { CredentialStore } from "./credentials.js";
import {
  formatAnswer,
  formatDecision,
  formatDecisionLine,
  formatOptions,
  formatRun,
  formatRunLine,
  formatTask,
  formatTaskLine,
} from "./format.js";
import { COMMAND_HELP, helpFor, usage } from "./help.js";

// The `console` command (docs/specs/cli.md): the agent's side of the console. A thin client of
// the REST API with no logic of its own: every command is one or two requests and the words to
// say what came back. It takes what it needs from `CliIo`, so that tests run it whole, against
// the app and no socket, with a store and readers of their own.

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
  /** All of standard input, for a body given as `-`. */
  readonly readStdin: () => Promise<string>;
  /** A secret typed at the terminal without echo, or read from standard input. */
  readonly readSecret: (prompt: string) => Promise<string>;
  /** A file named with `--file`, as text. */
  readonly readFile: (path: string) => Promise<string>;
  readonly store: CredentialStore;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
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

const GLOBAL_OPTIONS: OptionSpec = { json: { type: "boolean" }, url: { type: "string" } };

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
}

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
  return {
    client: createClient({ baseUrl: url, token, fetch: io.fetch }),
    url,
    json: on(values, "json"),
  };
}

/** Prints what came back: the console's JSON on `--json`, the words otherwise. */
function answer(io: CliIo, session: Session, value: unknown, words: () => string): void {
  io.stdout(session.json ? `${JSON.stringify(value, null, 2)}\n` : `${words()}\n`);
}

/** The run a command on a run means: the one named, else the one open run of this token. */
async function currentRun(session: Session, values: Values): Promise<string> {
  const given = text(values, "run");
  if (given !== undefined) {
    return given;
  }
  const { items } = await session.client.runs({ open: true, mine: true });
  const [only] = items;
  if (only !== undefined && items.length === 1) {
    return only.id;
  }
  if (items.length === 0) {
    throw failed("No run of yours is open. Take a task first: console take <number>");
  }
  throw misuse(
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
  client: ConsoleClient,
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
    current = await client.awaitDecision(
      current.id,
      Math.max(1, Math.min(Math.ceil(left / 1000), WAIT_STEP_SECONDS)),
    );
    if (current.answer === null) {
      await io.sleep(WAIT_PAUSE_MS);
    }
  }
}

/** Waits for the answer and says what it is, or that it is still to come. */
async function settle(
  io: CliIo,
  session: Session,
  decision: RestDecision,
  seconds: number,
): Promise<number> {
  const outcome =
    decision.answer === null && seconds > 0
      ? await waitForAnswer(io, session.client, decision, seconds)
      : decision;
  answer(io, session, outcome, () =>
    outcome.answer === null
      ? `Decision ${outcome.id} still waits for a person. Keep waiting with: console decision ${outcome.id} --wait 600; or go on with other work and come back to it.`
      : formatAnswer(outcome),
  );
  return outcome.answer === null ? EXIT.waiting : EXIT.ok;
}

type Command = (args: readonly string[], io: CliIo) => Promise<number>;

const login: Command = async (args, io) => {
  const { values } = parse(args, { "token-stdin": { type: "boolean" } }, false);
  const stored = await io.store.load();
  const wanted = text(values, "url") ?? io.env.CONSOLE_URL ?? stored?.url;
  if (wanted === undefined) {
    throw misuse("Say where the console is: console login --url https://console.example.com");
  }
  const url = originOf(wanted);
  const token = (
    on(values, "token-stdin")
      ? await io.readStdin()
      : await io.readSecret(`Paste a token made at ${url}/tokens: `)
  ).trim();
  if (token.length === 0) {
    throw failed("No token was given.");
  }
  const me = await createClient({ baseUrl: url, token, fetch: io.fetch }).me();
  const person = me.person;
  if (person === null) {
    throw failed(
      "The console does not know this token. Make one on your Tokens page and try again.",
    );
  }
  const kept = await io.store.save({ url, token });
  io.stdout(
    `Signed in to ${me.workspace.name} at ${url} as ${person.login} (${person.role}). The token is kept in ${kept}.\n`,
  );
  return EXIT.ok;
};

const logout: Command = async (args, io) => {
  parse(args, {}, false);
  await io.store.clear();
  io.stdout("Signed out here. The token itself is removed on your Tokens page.\n");
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
  answer(
    io,
    session,
    me,
    () => `${person.login} (${person.role}) at ${me.workspace.name}, ${session.url}`,
  );
  return EXIT.ok;
};

const tasks: Command = async (args, io) => {
  const { values } = parse(args, { state: { type: "string" } }, false);
  const state = stateOf(text(values, "state"));
  const session = await open(io, values);
  const found = await session.client.tasks(state === undefined ? {} : { state });
  answer(io, session, found, () =>
    found.items.length === 0 ? "No tasks." : found.items.map(formatTaskLine).join("\n"),
  );
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
  const made = await session.client.createTask({
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
  const found = await session.client.task(ref);
  const [decisions, runs] = await Promise.all([
    session.client.decisions({ task: found.id }),
    session.client.runs({ task: found.id }),
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
  const found = await session.client.task(ref);
  const agent = text(values, "agent");
  const run = await session.client.startRun({
    taskId: found.id,
    ...(agent === undefined ? {} : { agent }),
  });
  answer(io, session, { run, task: found }, () =>
    [
      `Run ${run.id} began on #${found.number} ${found.title}, as "${run.agent}" for ${run.person.login}. The task is in progress and theirs.`,
      "",
      formatTask(found),
      "",
      'Say how it goes: console report "<what you found or did>". Hand in what you make: console hand-in <https url>.',
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
  const runId = await currentRun(session, values);
  const run = await session.client.report(runId, { body });
  answer(
    io,
    session,
    run,
    () =>
      `Reported on run ${run.id}: ${run.reports.length} report${run.reports.length === 1 ? "" : "s"} so far.`,
  );
  return EXIT.ok;
};

const handIn: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    label: { type: "string" },
    run: { type: "string" },
  });
  const url = theOne(
    positionals,
    "Say what to hand in: console hand-in <https url> [--label <words>]",
  );
  const label = text(values, "label");
  const session = await open(io, values);
  const runId = await currentRun(session, values);
  const run = await session.client.handIn(runId, {
    url,
    ...(label === undefined ? {} : { label }),
  });
  answer(
    io,
    session,
    run,
    () =>
      `Handed in ${url} on run ${run.id}: ${run.artifacts.length} artifact${run.artifacts.length === 1 ? "" : "s"} so far.`,
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
  const runId = await currentRun(session, values);
  const raised = await session.client.raiseDecision({
    question,
    options: options.map((label) => ({ label })),
    runId,
    ...(body === undefined ? {} : { body }),
  });
  if (!session.json) {
    io.stdout(
      `Decision ${raised.id} raised on run ${runId}; the run waits for a person.\n${formatOptions(raised)}\n`,
    );
  }
  return settle(io, session, raised, seconds);
};

const decision: Command = async (args, io) => {
  const { values, positionals } = parse(args, { wait: { type: "string" } });
  const id = theOne(positionals, "Say which decision: console decision <id> [--wait <seconds>]");
  const seconds = secondsOf(text(values, "wait"), 0);
  const session = await open(io, values);
  const found = await session.client.decision(id);
  if (seconds === 0) {
    answer(io, session, found, () => formatDecision(found));
    return EXIT.ok;
  }
  return settle(io, session, found, seconds);
};

const decisions: Command = async (args, io) => {
  const { values } = parse(args, { open: { type: "boolean" } }, false);
  const session = await open(io, values);
  const found = await session.client.decisions(on(values, "open") ? { open: true } : {});
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
    const runId = await currentRun(session, values);
    const run = await session.client.endRun(runId, {
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
  const runId = positionals[0] ?? (await currentRun(session, values));
  const run = await session.client.endRun(runId, {
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
  const ref = text(values, "task");
  const taskId = ref === undefined ? undefined : (await session.client.task(ref)).id;
  const found = await session.client.runs({
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
  const found = await session.client.run(id);
  answer(io, session, found, () => formatRun(found));
  return EXIT.ok;
};

const COMMANDS: Readonly<Record<string, Command>> = {
  login,
  logout,
  whoami,
  tasks,
  task,
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
};

function help(io: CliIo, name: string | undefined): number {
  if (name === undefined) {
    io.stdout(usage());
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
