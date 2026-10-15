import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import {
  ApiError,
  type ConsoleClient,
  createClient,
  type FetchLike,
  type ProjectClient,
} from "../client.js";
import { CLIENT_RANGE_HEADER, judgeClient, parseVersion, VERSION_HEADER } from "../compat.js";
import { addDays, dayOf as dayOfDate, isDay } from "../dates.js";
import { DEFAULT_PAGE_LIMIT, LIST_LIMIT, MAX_OPTIONS, MIN_OPTIONS } from "../limits.js";
import { fillRules, RULES_PATH, RULES_TITLE } from "../rules.js";
import {
  hostOfLogin,
  type RestClaim,
  type RestDecision,
  type RestMember,
  type RestPerson,
  type RestSkillBrowse,
  type RestSkillFile,
  type RestSkillLoad,
  type RestSkillPage,
  type RestTaskPatch,
} from "../schemas.js";
import {
  COLOR_NAMES,
  type ColorName,
  GOAL_STATES,
  type GoalState,
  PERSON_ROLES,
  type PersonRole,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  PROVIDER_KEYS,
  type ProjectRole,
  type ProjectVisibility,
  type ProviderKey,
  TASK_PRIORITIES,
  TASK_STATES,
  type TaskPriority,
  type TaskState,
} from "../vocabulary.js";
import { loadWebRoot, type WebRoot, WebRootError } from "../web.js";
import {
  type CredentialStore,
  type Credentials,
  CredentialsError,
  EMPTY_CREDENTIALS,
  loginsAt,
  type Resolution,
  resolveLogin,
  withLogin,
  withoutLogin,
} from "./credentials.js";
import type { DirectorySettings, DirectoryStore } from "./directory.js";
import {
  formatAnswer,
  formatCategoryLine,
  formatComment,
  formatDecision,
  formatDecisionLine,
  formatDocument,
  formatDocuments,
  formatGoal,
  formatGoalLine,
  formatListingLine,
  formatMemberLine,
  formatMore,
  formatOptions,
  formatPersonLine,
  formatPersonWork,
  formatProject,
  formatProjectLine,
  formatRules,
  formatRun,
  formatRunLine,
  formatSkillBrowse,
  formatSkillFile,
  formatSkillFind,
  formatSkillLoad,
  formatSkills,
  formatTask,
  formatTaskLine,
  formatVersion,
  formatVersionLine,
  formatWork,
} from "./format.js";
import { COMMAND_HELP, helpFor, ownSkillPath, usage } from "./help.js";
import { describeInstall, type Install, updateCommandFor } from "./install.js";
import type { NoticeStore } from "./notices.js";
import { createServeHandler, DEFAULT_SERVE_PORT, type Listen } from "./serve.js";

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
  /** The command and the console do not go together (ADR-0025): stderr says which to update, and how. */
  incompatible: 4,
} as const;

/** A day, for how often the command repeats what it noticed of the versions. */
const DAY_MS = 86_400_000;

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
  /** A file read from the console, written at a path, or into a directory under its name; says where. */
  readonly writeBytes: (path: string, bytes: Uint8Array, name: string) => Promise<string>;
  readonly store: CredentialStore;
  /** What the working directory says of the project, and the way to write it. */
  readonly directory: DirectoryStore;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** The version of the package the command runs from, when the entry point knows it. */
  readonly version?: string | undefined;
  /** What the command calls itself on every request (ADR-0025); nothing when it does not know its version. */
  readonly userAgent?: string | undefined;
  /** Where the command is installed, so that an update is told the way it takes effect; nothing when unknown. */
  readonly install?: Install | undefined;
  /** What the command last said of the versions; left out, it says it every time. */
  readonly notices?: NoticeStore | undefined;
  /** Where the console's own skills are on this machine, shipped with the package; nothing when they are not there. */
  readonly skillsDir?: string | undefined;
  /** How `serve` listens on the loopback (ADR-0014); left out, the command cannot serve. */
  readonly listen?: Listen | undefined;
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
  account: { type: "string" },
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
  /** The token the client holds: what `serve` carries the page's requests with. */
  readonly token: string;
  /** The person's login at the console, when the login kept knows it. */
  readonly account: string | undefined;
  /** Where the token came from: the environment's pair, or a login kept here. */
  readonly via: "environment" | "login";
  /** What the command keeps, as it was read for this command. */
  readonly credentials: Credentials | undefined;
  readonly json: boolean;
  /** The project the command works in: named by `--project`, the environment, or the working directory. */
  project(): Promise<ProjectClient>;
  /** The key of that project, or nothing when none is named. */
  projectKey(): Promise<string | undefined>;
}

const NO_PROJECT =
  "Say which project: --project <key>, CONSOLE_PROJECT in the environment, or console use <key> once in this directory. console projects lists the projects you may work in.";

/** What the command keeps, or nothing; a file that cannot be read stops the command, and is never written over. */
async function loadCredentials(io: CliIo): Promise<Credentials | undefined> {
  try {
    return await io.store.load();
  } catch (error) {
    if (error instanceof CredentialsError) {
      throw failed(
        `${error.message} Move it away, then sign in again: console login --url <the console's origin>`,
      );
    }
    throw error;
  }
}

/** The console a directory is bound to, as an origin, when it names one. */
function directoryOrigin(settings: DirectorySettings | undefined): string | undefined {
  if (settings?.url === undefined) {
    return undefined;
  }
  try {
    return originOf(settings.url);
  } catch {
    throw failed(`.skillcdn-console.json names a console that is not an origin: ${settings.url}`);
  }
}

/** Why no console could be talked to, for the person who reads it. */
function wordsOf(failure: Exclude<Resolution, { ok: true }>): string {
  switch (failure.reason) {
    case "nothing":
      return "Not signed in. A person signs the command in: console login --url <the console's origin>";
    case "environment_half":
      return `Both CONSOLE_URL and CONSOLE_TOKEN are needed in the environment, and only ${failure.have} is set: set both, or neither.`;
    case "no_login": {
      const whom = failure.account === undefined ? "" : ` as ${failure.account}`;
      const where =
        failure.source === "directory"
          ? `This directory works at ${failure.url}${whom}, where nobody is signed in here`
          : `Nobody is signed in here at ${failure.url}${whom}`;
      return `${where}: console login --url ${failure.url}. console logins lists the consoles signed in.`;
    }
    case "ambiguous":
      return `Several accounts are signed in at ${failure.url} (${failure.accounts.join(", ")}): say which with --account <login>, or bind this directory to one with console use <key> --account <login>.`;
  }
}

/**
 * The console a command talks to, and with what (ADR-0027): the address from the flag, the
 * environment, the directory or the default login, in that order, and then the token kept for
 * that address and no other. A token never travels to a console it was not made at.
 */
async function open(io: CliIo, values: Values): Promise<Session> {
  const directory = await io.directory.load();
  const flag = text(values, "url");
  const envUrl = io.env.CONSOLE_URL;
  const credentials = await loadCredentials(io);
  const resolved = resolveLogin({
    flagUrl: flag === undefined ? undefined : originOf(flag),
    flagAccount: text(values, "account"),
    envUrl: envUrl === undefined ? undefined : originOf(envUrl),
    envToken: io.env.CONSOLE_TOKEN,
    directoryUrl: directoryOrigin(directory),
    directoryAccount: directory?.account,
    credentials,
  });
  if (!resolved.ok) {
    throw failed(wordsOf(resolved));
  }
  const { url, token } = resolved;
  const client = clientOf(io, url, token);
  const projectKey = async () =>
    text(values, "project") ?? io.env.CONSOLE_PROJECT ?? directory?.project;
  return {
    client,
    url,
    token,
    account: resolved.account,
    via: resolved.via,
    credentials,
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
      "run.none: no run of yours is open in this project. Take a task first: console take <number>; or name a run: --run <id>",
    );
  }
  throw failed(
    `run.ambiguous: several runs of yours are open in this project; say which with --run <id>:\n${items.map((run) => `  ${formatRunLine(run)}`).join("\n")}`,
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

/** The hosts a token may travel to in the clear: this machine, and no other. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
  // A token travels over https; in the clear only to this machine, where a console is run for development.
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw misuse(
      `Not a safe origin: ${value}. A token travels over https only; http is for a console on this machine (localhost).`,
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

function goalStateOf(value: string | undefined): GoalState | undefined {
  if (value === undefined) {
    return undefined;
  }
  const found = GOAL_STATES.find((state) => state === value);
  if (found === undefined) {
    throw misuse(`Not a state of a goal: ${value}. One of ${GOAL_STATES.join(", ")}`);
  }
  return found;
}

/** Today by this machine's clock, as a day. */
const todayOf = (io: CliIo): string => dayOfDate(new Date(io.now()));

/**
 * A day as a flag takes one: `2026-10-24`, `today`, `tomorrow`, or `+<n>` days from today; and
 * `none` where a field may be cleared, which is `null` on the wire.
 */
function dayOf(io: CliIo, value: string | undefined, clearable = false): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (clearable && value === "none") {
    return null;
  }
  if (value === "today") {
    return todayOf(io);
  }
  if (value === "tomorrow") {
    return addDays(todayOf(io), 1);
  }
  const ahead = /^\+(\d{1,3})$/.exec(value);
  if (ahead !== null) {
    return addDays(todayOf(io), Number(ahead[1]));
  }
  if (!isDay(value)) {
    throw misuse(`Not a day: ${value}. Say it as 2026-10-24, today, tomorrow, or +7`);
  }
  return value;
}

/** A value a field is set to, or `none` to clear it, which is `null` on the wire. */
const orNone = (value: string | undefined): string | null | undefined =>
  value === "none" ? null : value;

/** The id of the person a flag names: `me`, or a login of the workspace. */
async function personIdOf(
  session: Session,
  value: string | undefined,
): Promise<string | null | undefined> {
  if (value === undefined) {
    return undefined;
  }
  if (value === "none") {
    return null;
  }
  if (value === "me") {
    const me = await session.client.me();
    if (me.person === null) {
      throw failed("The console does not know this token. Sign in again: console login");
    }
    return me.person.id;
  }
  return (await personOf(session, value)).id;
}

/** The person a login names, among the workspace's; the logins are as people sign in. */
async function personOf(session: Session, login: string): Promise<RestPerson> {
  const { items } = await session.client.people();
  const found = items.find((person) => person.login.toLowerCase() === login.toLowerCase());
  if (found === undefined) {
    throw misuse(
      `Nobody of the workspace is called ${login}. console people lists everyone, by login.`,
    );
  }
  return found;
}

/** One word of a vocabulary, or the refusal to understand. */
function wordOf<T extends string>(value: string, words: readonly T[], what: string): T {
  const found = words.find((word) => word === value);
  if (found === undefined) {
    throw misuse(`Not ${what}: ${value}. One of ${words.join(", ")}`);
  }
  return found;
}

const personRoleOf = (value: string): PersonRole =>
  wordOf(value, PERSON_ROLES, "a role in the workspace");
const providerOf = (value: string): ProviderKey =>
  wordOf(value, PROVIDER_KEYS, "a provider people sign in through");
const projectRoleOf = (value: string): ProjectRole =>
  wordOf(value, PROJECT_ROLES, "a role in a project");
const visibilityOf = (value: string): ProjectVisibility =>
  wordOf(value, PROJECT_VISIBILITIES, "a visibility");
const colorOf = (value: string): ColorName => wordOf(value, COLOR_NAMES, "a colour");
/** A colour, or `none` for the one the pages choose, which is `null` on the wire. */
const colorOrNoneOf = (value: string | undefined): ColorName | null | undefined =>
  value === undefined ? undefined : value === "none" ? null : colorOf(value);

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

/** The flags of a page of a listing: how many, from which one on. */
const PAGE_OPTIONS: OptionSpec = { limit: { type: "string" }, offset: { type: "string" } };

/** The page the flags ask for: `DEFAULT_PAGE_LIMIT` items from the first when nothing is said. */
function pageOf(values: Values): { readonly limit: number; readonly offset: number } {
  const limit = text(values, "limit");
  const offset = text(values, "offset");
  const page = {
    limit: limit === undefined ? DEFAULT_PAGE_LIMIT : Number(limit),
    offset: offset === undefined ? 0 : Number(offset),
  };
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > LIST_LIMIT) {
    throw misuse(`Not a number of items, 1 to ${LIST_LIMIT}: ${limit}`);
  }
  if (!Number.isInteger(page.offset) || page.offset < 0) {
    throw misuse(`Not a number of items to skip: ${offset}`);
  }
  return page;
}

/** One positional, and nothing else. */
function theOne(positionals: readonly string[], ask: string): string {
  const [first] = positionals;
  if (first === undefined || positionals.length > 1) {
    throw misuse(ask);
  }
  return first;
}

/** Exactly two words, for a command on a thing and a value. */
function theTwo(positionals: readonly string[], ask: string): readonly [string, string] {
  const [first, second] = positionals;
  if (first === undefined || second === undefined || positionals.length > 2) {
    throw misuse(ask);
  }
  return [first, second];
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

/**
 * Checks a token against the console, keeps it as the login at that console for that account,
 * and says who it is. A token the login replaces is given up at the console on the way.
 */
async function keep(
  io: CliIo,
  url: string,
  token: string,
  agent: string | undefined,
  asDefault: boolean,
): Promise<number> {
  const me = await clientOf(io, url, token).me();
  const person = me.person;
  if (person === null) {
    throw failed(
      "The console does not know this token. Make one on your Agents page and try again.",
    );
  }
  const credentials = (await loadCredentials(io)) ?? EMPTY_CREDENTIALS;
  const replaced = loginsAt(credentials, url).find((login) => login.account === person.login);
  if (replaced !== undefined && replaced.token !== token) {
    await clientOf(io, url, replaced.token)
      .giveUpToken()
      .catch(() => undefined);
  }
  const next = withLogin(
    credentials,
    { url, account: person.login, token, agent, since: new Date(io.now()).toISOString() },
    { default: asDefault },
  );
  const kept = await io.store.save(next);
  const standing = next.default === url ? ", the default console here" : "";
  io.stdout(
    `${agent === undefined ? "Signed in" : `Connected as "${agent}"`} to ${me.workspace.name} at ${url} as ${person.login} (${person.role})${standing}. The token is kept in ${kept}.\nNext, say which project this directory works in: console use <key> (console projects lists them).\n`,
  );
  return EXIT.ok;
}

const login: Command = async (args, io) => {
  const { values } = parse(
    args,
    { "token-stdin": { type: "boolean" }, agent: { type: "string" }, default: { type: "boolean" } },
    false,
  );
  const credentials = await loadCredentials(io);
  const wanted = text(values, "url") ?? io.env.CONSOLE_URL ?? credentials?.default;
  if (wanted === undefined) {
    throw misuse("Say where the console is: console login --url https://console.example.com");
  }
  const url = originOf(wanted);
  const asDefault = on(values, "default");
  if (on(values, "token-stdin")) {
    const token = (await io.readStdin()).trim();
    if (token.length === 0) {
      throw failed("No token was given.");
    }
    return keep(io, url, token, undefined, asDefault);
  }
  // A connection (ADR-0011): a code a person approves on the console's own pages, and the token
  // handed over here once, never shown.
  const client = clientOf(io, url);
  // "<agent> on <machine>": the pages say the agent and keep the machine for a hover.
  const agent = text(values, "agent") ?? agentOf(io.env) ?? "An agent";
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
      return keep(io, url, claim.secret, claim.token.name, asDefault);
    }
  }
};

const logout: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const credentials = await loadCredentials(io);
  const directory = await io.directory.load();
  const envNote = () => {
    if (io.env.CONSOLE_TOKEN !== undefined) {
      io.stdout("CONSOLE_TOKEN in the environment still holds a token: unset it.\n");
    }
  };
  if (credentials === undefined || credentials.logins.length === 0) {
    io.stdout("Not signed in here: nothing to forget.\n");
    envNote();
    return EXIT.ok;
  }
  // Which login: the console the flag names, else the directory's, else the default, else the
  // one console signed in to; and the account the same way, where the console has several.
  const consoles = [...new Set(credentials.logins.map((login) => login.url))];
  const flag = text(values, "url");
  const url =
    flag === undefined
      ? (directoryOrigin(directory) ??
        credentials.default ??
        (consoles.length === 1 ? consoles[0] : undefined))
      : originOf(flag);
  if (url === undefined) {
    throw failed(
      `Several consoles are signed in here; say which: console logout --url <origin>. console logins lists them.`,
    );
  }
  const account = text(values, "account") ?? directory?.account;
  const at = loginsAt(credentials, url);
  const chosen = account === undefined ? at : at.filter((login) => login.account === account);
  const [login] = chosen;
  if (login === undefined) {
    throw failed(
      `Nobody is signed in here at ${url}${account === undefined ? "" : ` as ${account}`}: nothing to forget. console logins lists the consoles signed in.`,
    );
  }
  if (chosen.length > 1) {
    throw failed(
      `Several accounts are signed in at ${url} (${chosen.map((kept) => kept.account ?? "?").join(", ")}); say which: console logout --url ${url} --account <login>`,
    );
  }
  // The token is given up at the console first, so that it is good for nothing from now on;
  // one the console no longer knows is gone already. A console out of reach leaves it to the
  // Agents page, and the person is told so.
  let gone = true;
  try {
    await clientOf(io, url, login.token).giveUpToken();
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "auth.required")) {
      gone = false;
    }
  }
  const next = withoutLogin(credentials, url, login.account);
  if (next.logins.length === 0) {
    await io.store.clear();
  } else {
    await io.store.save(next);
  }
  const whom = login.account === undefined ? "" : ` as ${login.account}`;
  io.stdout(
    gone
      ? `Signed out of ${url}${whom}: the token is given up at the console and forgotten here.\n`
      : `Signed out of ${url}${whom} here, but the console could not be reached to give the token up: a person removes it on the Agents page.\n`,
  );
  envNote();
  return EXIT.ok;
};

/** The consoles this machine is signed in to, with the account at each; never a token. */
const logins: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const credentials = await loadCredentials(io);
  const kept = (credentials?.logins ?? []).map((login) => ({
    url: login.url,
    account: login.account ?? null,
    agent: login.agent ?? null,
    since: login.since ?? null,
    default: credentials?.default === login.url,
  }));
  if (on(values, "json")) {
    io.stdout(
      `${JSON.stringify({ default: credentials?.default ?? null, logins: kept }, null, 2)}\n`,
    );
    return EXIT.ok;
  }
  if (kept.length === 0) {
    io.stdout("Not signed in anywhere here: console login --url <the console's origin>\n");
    return EXIT.ok;
  }
  io.stdout(
    `${kept
      .map(
        (login) =>
          `${login.url}  ${login.account ?? "(account unknown)"}${login.agent === null ? "" : `  ${login.agent}`}${login.since === null ? "" : `  since ${login.since.slice(0, 10)}`}${login.default ? "  (default)" : ""}`,
      )
      .join("\n")}\n`,
  );
  return EXIT.ok;
};

/** The agent the command runs under, where its environment says so: what a connection is named by default. */
function agentOf(env: CliIo["env"]): string | undefined {
  if (env.CLAUDECODE !== undefined) {
    return "Claude Code";
  }
  if (Object.keys(env).some((key) => key.startsWith("CODEX_"))) {
    return "Codex";
  }
  return undefined;
}

const whoami: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const me = await session.client.me();
  const person = me.person;
  if (person === null) {
    throw failed("The console does not know this token. Sign in again: console login");
  }
  const key = await session.projectKey();
  const command = parseVersion(io.version);
  const server = parseVersion(me.console?.version);
  const verdict =
    command === undefined || server === undefined
      ? undefined
      : judgeClient(command, server).verdict;
  // A console from before the rule says nothing of itself; the command says so instead.
  const consoleWords =
    me.console === undefined
      ? "the console does not say its version, so it is older than 0.1.18"
      : `the console is ${me.console.version} and takes ${me.console.clientRange}`;
  answer(
    io,
    session,
    {
      ...me,
      console: me.console ?? null,
      project: key ?? null,
      command: { version: io.version ?? null, install: io.install ?? null },
    },
    () =>
      [
        `${person.login} (${person.role}) at ${me.workspace.name}, ${session.url}${key === undefined ? "; no project named here" : `; project ${key}`}`,
        // The pack's rules send an agent here first; from here the rules and the skill are the next steps.
        ...(key === undefined
          ? []
          : [
              `What this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command${io.skillsDir === undefined ? " (console skills says where it is)." : `: ${ownSkillPath(io.skillsDir)}`}`,
            ]),
        `This command is ${io.version ?? "of a version it does not know"}${io.install === undefined ? "" : `, ${describeInstall(io.install)}`}; ${consoleWords}.`,
        ...(verdict === "behind"
          ? [`A newer command exists. Update it: ${updateWords(io, me.console?.version)}`]
          : verdict === "ahead"
            ? [
                `This command is newer than the console: it works, and what the console has not got yet is refused as not found; nothing to do until then. To match the console then: ${updateWords(io, me.console?.version)}`,
              ]
            : []),
      ].join("\n"),
  );
  return EXIT.ok;
};

const projects: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const found = await session.client.projects();
  answer(io, session, found, () =>
    found.items.length === 0
      ? 'No projects you may work in. Make one: console project new <key> "<name>"'
      : found.items.map(formatProjectLine).join("\n"),
  );
  return EXIT.ok;
};

const use: Command = async (args, io) => {
  const { values, positionals } = parse(args, {});
  const key = theOne(
    positionals,
    "Say which project: console use <key> [--url <origin>] [--account <login>]",
  );
  const session = await open(io, values);
  const project = await session.client.project(key).get();
  // The directory names the console where that is not the default login here, or when asked,
  // and the account where the console has several, or when asked; never a token.
  const credentials = session.credentials ?? EMPTY_CREDENTIALS;
  const pinUrl =
    text(values, "url") !== undefined ||
    (session.via === "login" && credentials.default !== session.url);
  const pinAccount =
    text(values, "account") !== undefined ||
    (session.via === "login" && loginsAt(credentials, session.url).length > 1);
  const kept = await io.directory.save({
    project: project.key,
    ...(pinUrl ? { url: session.url } : {}),
    ...(pinAccount && session.account !== undefined ? { account: session.account } : {}),
  });
  const bound = pinUrl
    ? ` at ${session.url}${pinAccount && session.account !== undefined ? ` as ${session.account}` : ""}`
    : "";
  answer(
    io,
    session,
    project,
    () =>
      `Working in ${project.name} (${project.key})${bound} from this directory on: kept in ${kept}, which is meant to be committed in a private repository and left out of a public one. What its people ask of agents: console rules.`,
  );
  return EXIT.ok;
};

const tasks: Command = async (args, io) => {
  const { values } = parse(
    args,
    {
      state: { type: "string" },
      open: { type: "boolean" },
      mine: { type: "boolean" },
      unassigned: { type: "boolean" },
      category: { type: "string" },
      goal: { type: "string" },
      due: { type: "string" },
      archived: { type: "boolean" },
      ...PAGE_OPTIONS,
    },
    false,
  );
  const state = stateOf(text(values, "state"));
  if (on(values, "mine") && on(values, "unassigned")) {
    throw misuse(
      "Say one: --mine for the tasks assigned to you, or --unassigned for those assigned to nobody",
    );
  }
  const page = pageOf(values);
  const session = await open(io, values);
  const project = await session.project();
  // What is due: a day, or the words for the usual windows; overdue keeps only the open ones.
  const due = text(values, "due");
  const today = todayOf(io);
  const dueBy =
    due === undefined
      ? undefined
      : due === "overdue"
        ? addDays(today, -1)
        : due === "week"
          ? addDays(today, 6)
          : (dayOf(io, due) ?? undefined);
  const assignee = on(values, "mine")
    ? ((await personIdOf(session, "me")) ?? undefined)
    : undefined;
  const found = await project.tasks({
    ...(state === undefined ? {} : { state }),
    ...(on(values, "open") || due === "overdue" ? { open: true } : {}),
    ...(assignee === undefined ? {} : { assignee }),
    ...(on(values, "unassigned") ? { unassigned: true } : {}),
    ...(text(values, "category") === undefined ? {} : { category: text(values, "category") }),
    ...(text(values, "goal") === undefined ? {} : { goal: text(values, "goal") }),
    ...(dueBy === undefined ? {} : { dueBy }),
    ...(on(values, "archived") ? { archived: true } : {}),
    ...page,
  });
  answer(io, session, found, () =>
    found.items.length === 0
      ? "No tasks."
      : found.items.map(formatTaskLine).join("\n") +
        formatMore(found.more, page.limit, page.offset),
  );
  return EXIT.ok;
};

const work: Command = async (args, io) => {
  const { values } = parse(args, { person: { type: "string" } }, false);
  const session = await open(io, values);
  const login = text(values, "person");
  if (login === undefined) {
    const found = await session.client.work();
    answer(io, session, found, () => formatWork(found));
    return EXIT.ok;
  }
  // Another person's plate: the console decides whether it is the asker's to see.
  const whose = await personOf(session, login);
  const found = await session.client.personWork(whose.id);
  answer(io, session, found, () => formatPersonWork(whose, found));
  return EXIT.ok;
};

const categories: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const found = await session.client.categories();
  answer(io, session, found, () =>
    found.items.length === 0 ? "No categories." : found.items.map(formatCategoryLine).join("\n"),
  );
  return EXIT.ok;
};

/** How many pages of a skill, of a file or of a folder the command follows before it stops: far above what one holds. */
const MAX_SKILL_PAGES = 64;
/** How many results a search answers at most: what the deployment allows on one page. */
const MAX_FIND_LIMIT = 25;

const skills: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    search: { type: "string" },
    limit: { type: "string" },
  });
  if (positionals.length > 1) {
    throw misuse("Say one folder: console skills [<folder>] [--search <words>]");
  }
  // The root of the pack is the mounted folder, which the deployment reads as no path at all.
  const given = positionals[0];
  const folder = given === undefined || given === "/" || given === "." ? undefined : given;
  const words = text(values, "search");
  const limit = text(values, "limit");
  if (words === undefined && limit !== undefined) {
    throw misuse("--limit goes with --search: console skills --search <words> [--limit <n>]");
  }
  const atMost = limit === undefined ? undefined : Number(limit);
  if (
    atMost !== undefined &&
    (!Number.isInteger(atMost) || atMost < 1 || atMost > MAX_FIND_LIMIT)
  ) {
    throw misuse(`Not a number of results, 1 to ${MAX_FIND_LIMIT}: ${limit}`);
  }
  const session = await open(io, values);
  const project = await session.project();
  if (words !== undefined) {
    // One page of what the words find; more is said, and narrowed by the agent, not fetched.
    const found = await project.skillFind(words, { path: folder, limit: atMost });
    answer(io, session, found, () => formatSkillFind(found));
    return EXIT.ok;
  }
  if (given !== undefined) {
    // The folder whole: its pages until the end, as the deployment lists them.
    const folders: NonNullable<RestSkillBrowse["folder"]>[] = [];
    let cursor: string | undefined;
    let last: RestSkillBrowse | undefined;
    for (let n = 0; n < MAX_SKILL_PAGES; n += 1) {
      last = await project.skillBrowse({ path: folder, cursor });
      if (last.status !== "ready" || last.folder === null) {
        break;
      }
      folders.push(last.folder);
      if (last.folder.nextCursor === null) {
        break;
      }
      cursor = last.folder.nextCursor;
    }
    if (last === undefined) {
      throw failed("The folder could not be read.");
    }
    const browsed = last;
    answer(io, session, { ...browsed, folders }, () => formatSkillBrowse(browsed, folders));
    return EXIT.ok;
  }
  const found = await project.skills();
  answer(io, session, found, () => formatSkills(found, io.skillsDir));
  return EXIT.ok;
};

const skill: Command = async (args, io) => {
  const { values, positionals } = parse(args, { file: { type: "string" } });
  const file = text(values, "file");
  // A file is read by its own path from the repository's root; a skill's path beside it would be
  // ignored, which reads as if it mattered, so the two together are not understood.
  if (file !== undefined && positionals.length > 0) {
    throw misuse(
      "Say one: console skill <path of its SKILL.md> for a skill, or console skill --file <path> for a file of the pack.",
    );
  }
  const session = await open(io, values);
  const project = await session.project();
  if (file !== undefined) {
    // The file whole, page after page, as the console reads it from the deployment.
    const parts: string[] = [];
    let offset: number | undefined;
    let last: RestSkillFile | undefined;
    for (let pages = 0; pages < MAX_SKILL_PAGES; pages += 1) {
      last = await project.skillFile(file, offset === undefined ? {} : { offset });
      if (last.status !== "ready" || last.file === null) {
        break;
      }
      parts.push(last.file.content);
      if (last.file.nextOffset === null) {
        break;
      }
      offset = last.file.nextOffset;
    }
    if (last === undefined) {
      throw failed("The file could not be read.");
    }
    const read = last;
    const content = parts.join("");
    answer(io, session, { ...read, content }, () => formatSkillFile(read, content));
    return EXIT.ok;
  }
  const { path, pack } = skillPathOf(
    theOne(
      positionals,
      "Say which skill: console skill <path of its SKILL.md>, or console skill --file <path> for a file of the pack",
    ),
  );
  // The skill whole: its pages until complete, the rules first, as load_skill lays them out.
  const pages: RestSkillPage[] = [];
  let cursor: string | undefined;
  let last: RestSkillLoad | undefined;
  for (let n = 0; n < MAX_SKILL_PAGES; n += 1) {
    last = await project.skill(path, cursor);
    if (last.status !== "ready" || last.skill === null) {
      break;
    }
    pages.push(last.skill);
    if (last.skill.complete || last.skill.nextCursor === null) {
      break;
    }
    cursor = last.skill.nextCursor;
  }
  if (last === undefined) {
    throw failed("The skill could not be read.");
  }
  // A URI of another pack would read this pack's skill at the same path, or nothing: said instead.
  if (pack !== undefined && last.address !== null && last.address !== pack) {
    throw misuse(
      `That URI is of another pack, ${pack}; this project's pack is at ${last.address}. Say the path of the SKILL.md, or a URI console skills lists.`,
    );
  }
  const loaded = last;
  answer(io, session, { ...loaded, pages }, () => formatSkillLoad(loaded, pages));
  return EXIT.ok;
};

/**
 * A skill's path as given, or taken out of the URI `console skills` lists beside it
 * (`skill://gh/<owner>/<repo>/<path>`), with the pack the URI names, for the read to check.
 */
function skillPathOf(given: string): { readonly path: string; readonly pack?: string } {
  const uri = /^skill:\/\/(gh\/[^/]+\/[^/]+)\/(.+)$/.exec(given);
  const named = uri?.[1];
  const within = uri?.[2];
  if (named !== undefined && within !== undefined) {
    return { path: within, pack: `/${named}` };
  }
  if (given.startsWith("skill://")) {
    throw misuse(
      `Not a skill's URI the console knows: ${given}. Say the path of its SKILL.md from the repository's root, or the URI console skills lists.`,
    );
  }
  return { path: given };
}

/** A version number given as a flag, or nothing; anything else is not understood. */
function versionOf(given: string | undefined): number | undefined {
  if (given === undefined) {
    return undefined;
  }
  const version = Number(given);
  if (!Number.isInteger(version) || version < 1) {
    throw misuse(`Not a version number: ${given}`);
  }
  return version;
}

// The rules of the board (ADR-0023): read before a task is taken, written by an owner for the
// project and by an administrator for the workspace, through the same page the console keeps.
const rules: Command = async (args, io) => {
  const [verb, ...rest] = args;
  if (verb === "write") {
    const { values, positionals } = parse(rest, {
      body: { type: "string" },
      file: { type: "string" },
      workspace: { type: "boolean" },
      base: { type: "string" },
    });
    if (positionals.length > 1) {
      throw misuse("Say the rules as one argument: console rules write --body <markdown>");
    }
    const given = positionals[0] ?? text(values, "body");
    const none = given === "none";
    const body = none ? undefined : await bodyOf(io, values, given);
    if (!none && body === undefined) {
      throw misuse(
        "Say what the rules are to say: --body <markdown>, --file <path>, - to read standard input, or none to put the written rules away.",
      );
    }
    const baseVersion = versionOf(text(values, "base"));
    const session = await open(io, values);
    if (on(values, "workspace")) {
      if (none) {
        const put = await session.client.archiveRules();
        answer(
          io,
          session,
          put,
          () => "The organization's rules are put away: the console's own hold.",
        );
        return EXIT.ok;
      }
      const written = await session.client.writeRules({
        body: body ?? "",
        ...(baseVersion === undefined ? {} : { baseVersion }),
      });
      answer(io, session, written, () =>
        written.page === null
          ? "Nothing written: these are the console's own rules as they stand, and they hold already."
          : `Wrote the workspace's rules, version ${written.page.version}.`,
      );
      return EXIT.ok;
    }
    const project = await session.project();
    if (none) {
      try {
        const put = await project.archiveDocument(RULES_PATH);
        answer(io, session, put, () => "This project's rules are put away: it adds none now.");
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "document.not_found") {
          throw error;
        }
        answer(io, session, null, () => "This project has no rules of its own to put away.");
      }
      return EXIT.ok;
    }
    const written = await project.writeDocument(RULES_PATH, {
      title: RULES_TITLE,
      body: body ?? "",
      ...(baseVersion === undefined ? {} : { baseVersion }),
    });
    answer(io, session, written, () => `Wrote this project's rules, version ${written.version}.`);
    return EXIT.ok;
  }
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const key = await session.projectKey();
  const [found, me] = await Promise.all([
    key === undefined ? session.client.rules() : session.client.project(key).rules(),
    session.client.me(),
  ]);
  const read =
    "workspace" in found
      ? {
          workspace: forPerson(found.workspace, me.language),
          project: forPerson(found.project, me.language),
        }
      : forPerson(found, me.language);
  answer(io, session, read, () => formatRules(read));
  return EXIT.ok;
};

/**
 * The rules as they read for the person whose token the command holds: `{language}` filled
 * with the language they chose for the pages, or with the task's when they chose none.
 */
function forPerson<T extends { readonly body: string | null }>(
  half: T,
  language: string | null,
): T {
  return half.body === null ? half : { ...half, body: fillRules(half.body, language) };
}

/** The flags that set a task's fields, shared by writing one and changing one. */
const TASK_FIELDS: OptionSpec = {
  state: { type: "string" },
  priority: { type: "string" },
  category: { type: "string" },
  goal: { type: "string" },
  starts: { type: "string" },
  due: { type: "string" },
  assignee: { type: "string" },
  parent: { type: "string" },
};

/** What the flags say of a task's fields, as the API takes them; `none` clears a field. */
async function taskFieldsOf(
  io: CliIo,
  session: Session,
  project: ProjectClient,
  values: Values,
): Promise<RestTaskPatch> {
  const state = stateOf(text(values, "state"));
  const priority = priorityOf(text(values, "priority"));
  const category = orNone(text(values, "category"));
  const goalId = orNone(text(values, "goal"));
  const startsOn = dayOf(io, text(values, "starts"), true);
  const dueOn = dayOf(io, text(values, "due"), true);
  const assigneeId = await personIdOf(session, text(values, "assignee"));
  const parent = text(values, "parent");
  const parentId =
    parent === undefined ? undefined : parent === "none" ? null : (await project.task(parent)).id;
  return {
    ...(state === undefined ? {} : { state }),
    ...(priority === undefined ? {} : { priority }),
    ...(category === undefined ? {} : { category }),
    ...(goalId === undefined ? {} : { goalId }),
    ...(startsOn === undefined ? {} : { startsOn }),
    ...(dueOn === undefined ? {} : { dueOn }),
    ...(assigneeId === undefined ? {} : { assigneeId }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}

const newTask: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    ...TASK_FIELDS,
    body: { type: "string" },
    file: { type: "string" },
  });
  const title = theOne(positionals, 'Say the title: console task new "<title>"');
  const body = await bodyOf(io, values, text(values, "body"));
  const session = await open(io, values);
  const project = await session.project();
  const fields = await taskFieldsOf(io, session, project, values);
  const made = await project.createTask({
    title,
    ...(body === undefined ? {} : { body }),
    ...fields,
  });
  answer(io, session, made, () => `Task #${made.number} written: ${made.title}\nid: ${made.id}`);
  return EXIT.ok;
};

const editTask: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    ...TASK_FIELDS,
    title: { type: "string" },
    body: { type: "string" },
    file: { type: "string" },
  });
  const ref = theOne(
    positionals,
    "Say which task: console task edit <number|id> --due <day> [--category <key>] ...",
  );
  const body = await bodyOf(io, values, text(values, "body"));
  const session = await open(io, values);
  const project = await session.project();
  const title = text(values, "title");
  const patch: RestTaskPatch = {
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    ...(await taskFieldsOf(io, session, project, values)),
  };
  if (Object.keys(patch).length === 0) {
    throw misuse(
      "Say what to change: --title, --body, --state, --priority, --category, --goal, --starts, --due, --assignee or --parent; none clears a field.",
    );
  }
  const found = await project.task(ref);
  const changed = await project.updateTask(found.id, patch);
  answer(io, session, changed, () => formatTask(changed));
  return EXIT.ok;
};

/** Puts a task away, or every done or dropped task of a goal (ADR-0029); the task by its number or its id. */
const taskArchive: Command = async (args, io) => {
  const { values, positionals } = parse(args, { goal: { type: "string" } });
  const goal = text(values, "goal");
  if (positionals.length > 1 || (positionals.length === 0) === (goal === undefined)) {
    throw misuse(
      "Say which: console task archive <number|id>, or console task archive --goal <id> for every done or dropped task of a goal",
    );
  }
  const session = await open(io, values);
  const project = await session.project();
  if (goal !== undefined) {
    const { archived } = await project.archiveTasksOfGoal(goal);
    answer(
      io,
      session,
      { archived },
      () => `${archived} ${archived === 1 ? "task" : "tasks"} of the goal put away.`,
    );
    return EXIT.ok;
  }
  const found = await project.task(positionals[0] ?? "");
  const archived = await project.archiveTask(found.id);
  answer(io, session, archived, () => formatTaskLine(archived));
  return EXIT.ok;
};

/** Brings a task back from the archive. */
const taskRestore: Command = async (args, io) => {
  const { values, positionals } = parse(args, {});
  const ref = theOne(positionals, "Say which task: console task restore <number|id>");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.task(ref);
  const restored = await project.restoreTask(found.id);
  answer(io, session, restored, () => formatTaskLine(restored));
  return EXIT.ok;
};

const task: Command = async (args, io) => {
  if (args[0] === "new") {
    return newTask(args.slice(1), io);
  }
  if (args[0] === "edit") {
    return editTask(args.slice(1), io);
  }
  if (args[0] === "archive") {
    return taskArchive(args.slice(1), io);
  }
  if (args[0] === "restore") {
    return taskRestore(args.slice(1), io);
  }
  const { values, positionals } = parse(args, {});
  const ref = theOne(positionals, "Say which task: console task <number|id>");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.task(ref);
  const [decisions, runs, comments] = await Promise.all([
    project.decisions({ task: found.id }),
    project.runs({ task: found.id }),
    project.comments(found.id),
  ]);
  answer(
    io,
    session,
    { task: found, decisions: decisions.items, runs: runs.items, comments: comments.items },
    () => formatTask(found, decisions.items, runs.items, comments.items),
  );
  return EXIT.ok;
};

/**
 * A word in the discussion on a task (ADR-0024): what is said, as given, from a file or from
 * standard input, with the files named by --attach put in it; one request, one comment.
 */
const comment: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    file: { type: "string" },
    attach: { type: "string", multiple: true },
  });
  const ask =
    'Say which task, and what: console comment <number|id> "<markdown>" [--file <path> | -] [--attach <path>]...';
  if (positionals.length === 0 || positionals.length > 2) {
    throw misuse(ask);
  }
  const ref = positionals[0] ?? "";
  const body = (await bodyOf(io, values, positionals[1])) ?? "";
  const paths = texts(values, "attach");
  if (body.trim().length === 0 && paths.length === 0) {
    throw misuse(`Say something, or attach a file. ${ask}`);
  }
  const files = [];
  for (const path of paths) {
    let bytes: Uint8Array;
    try {
      bytes = await io.readBytes(path);
    } catch {
      throw failed(`No file could be read at ${path}. Name the path of a file to attach.`);
    }
    const name = basename(path);
    const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
    files.push({ name, bytes, ...(contentType === undefined ? {} : { contentType }) });
  }
  const session = await open(io, values);
  const project = await session.project();
  const task = await project.task(ref);
  const written = await project.comment(task.id, { body, files });
  answer(io, session, written, () =>
    [
      `Commented on #${task.number} ${task.title}${written.files.length === 0 ? "" : `, with ${written.files.length} file${written.files.length === 1 ? "" : "s"}`}.`,
      formatComment(written),
    ].join("\n"),
  );
  return EXIT.ok;
};

/**
 * A file of the project, read from the console and written on this machine: one a run handed
 * in, one put in a comment, or one attached to a page, by its id, so that an agent can look at
 * a picture a person put on the board.
 */
const file: Command = async (args, io) => {
  const { values, positionals } = parse(args, { out: { type: "string" } });
  const id = theOne(positionals, "Say which file: console file <id> [--out <path>]");
  const session = await open(io, values);
  const project = await session.project();
  const read = await project.readFile(id);
  const target = text(values, "out") ?? read.name;
  let saved: string;
  try {
    saved = await io.writeBytes(target, read.bytes, read.name);
  } catch {
    throw failed(`The file could not be written at ${target}. Name a path with --out <path>.`);
  }
  answer(
    io,
    session,
    {
      id,
      name: read.name,
      contentType: read.contentType,
      size: read.bytes.byteLength,
      path: saved,
    },
    () => `Saved ${read.name} (${read.bytes.byteLength} bytes, ${read.contentType}) at ${saved}`,
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
  // The rules come with the run, as they read for the person: everything from here acts
  // within them (ADR-0023); the task is read again, as it stands now that it is taken.
  const [ruling, me, taken, comments, openRuns] = await Promise.all([
    project.rules(),
    session.client.me(),
    project.task(ref),
    project.comments(found.id),
    project.runs({ open: true, mine: true }),
  ]);
  // Taking a task with a run open on it ends that run (ADR-0020): said when it happened.
  const tookOver =
    found.openRuns > 0
      ? " A run that was open on it is over now: the board cannot know whether its agent still ran, so taking it was deciding."
      : "";
  // Another run of this token open in the project makes every command on a run ask which
  // (currentRun): said here, with the id to say, before the first report runs into it.
  const others = openRuns.items.filter((item) => item.id !== run.id);
  const elsewhere =
    others.length === 0
      ? ""
      : `\nOther runs of yours are open in this project (${others.map((item) => `#${item.taskNumber}`).join(", ")}): say which run on report, hand-in, ask, finish and fail, --run ${run.id} for this one.`;
  const rules = {
    workspace: forPerson(ruling.workspace, me.language),
    project: forPerson(ruling.project, me.language),
  };
  answer(io, session, { run, task: taken, comments: comments.items, rules }, () =>
    [
      `Run ${run.id} began on #${found.number} ${found.title}, as "${run.agent}" for ${run.person.login}. The task is in progress and theirs.${tookOver}${elsewhere}`,
      "",
      formatTask(taken, undefined, undefined, comments.items),
      "",
      formatRules(rules),
      "",
      'Say how it goes: console report "<what you found or did>". Hand in what you make: console hand-in <https url | file path>.',
      'Ask when a person must decide: console ask "<question>" --option "..." --option "...". A word for the task\'s people that is not a report: console comment <number> "<markdown>". End with: console finish --summary "<what was done, what is left>".',
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

const goals: Command = async (args, io) => {
  const { values } = parse(
    args,
    { category: { type: "string" }, state: { type: "string" } },
    false,
  );
  const state = goalStateOf(text(values, "state"));
  const category = text(values, "category");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.goals({
    ...(state === undefined ? {} : { state }),
    ...(category === undefined ? {} : { category }),
  });
  answer(io, session, found, () =>
    found.items.length === 0
      ? state === undefined && category === undefined
        ? "No goals. An owner sets one: console goal new <title> --due <day>"
        : "No goal matches."
      : found.items.map(formatGoalLine).join("\n"),
  );
  return EXIT.ok;
};

const GOAL_FIELDS: OptionSpec = {
  state: { type: "string" },
  category: { type: "string" },
  starts: { type: "string" },
  due: { type: "string" },
  body: { type: "string" },
  file: { type: "string" },
};

/** A category's key as a flag names one, or `null` for `none` where the field may be cleared. */
function categoryOf(value: string | undefined, clearable = false): string | null | undefined {
  return clearable && value === "none" ? null : value;
}

const newGoal: Command = async (args, io) => {
  const { values, positionals } = parse(args, GOAL_FIELDS);
  const title = theOne(positionals, 'Say the title: console goal new "<title>" [--due <day>]');
  const state = goalStateOf(text(values, "state"));
  const category = categoryOf(text(values, "category"));
  const startsOn = dayOf(io, text(values, "starts"));
  const dueOn = dayOf(io, text(values, "due"));
  const body = await bodyOf(io, values, text(values, "body"));
  const session = await open(io, values);
  const project = await session.project();
  const made = await project.createGoal({
    title,
    ...(body === undefined ? {} : { body }),
    ...(state === undefined ? {} : { state }),
    ...(category === undefined ? {} : { category }),
    ...(startsOn === undefined ? {} : { startsOn }),
    ...(dueOn === undefined ? {} : { dueOn }),
  });
  answer(io, session, made, () => `Goal set: ${made.title}\nid: ${made.id}`);
  return EXIT.ok;
};

const editGoal: Command = async (args, io) => {
  const { values, positionals } = parse(args, { ...GOAL_FIELDS, title: { type: "string" } });
  const id = theOne(positionals, "Say which goal: console goal edit <id> --state <state> ...");
  const title = text(values, "title");
  const state = goalStateOf(text(values, "state"));
  const category = categoryOf(text(values, "category"), true);
  const startsOn = dayOf(io, text(values, "starts"), true);
  const dueOn = dayOf(io, text(values, "due"), true);
  const body = await bodyOf(io, values, text(values, "body"));
  const patch = {
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    ...(state === undefined ? {} : { state }),
    ...(category === undefined ? {} : { category }),
    ...(startsOn === undefined ? {} : { startsOn }),
    ...(dueOn === undefined ? {} : { dueOn }),
  };
  if (Object.keys(patch).length === 0) {
    throw misuse(
      "Say what to change: --title, --body, --state, --category, --starts or --due; none clears a category or a day.",
    );
  }
  const session = await open(io, values);
  const project = await session.project();
  const changed = await project.updateGoal(id, patch);
  answer(io, session, changed, () => formatGoal(changed));
  return EXIT.ok;
};

const goal: Command = async (args, io) => {
  if (args[0] === "new") {
    return newGoal(args.slice(1), io);
  }
  if (args[0] === "edit") {
    return editGoal(args.slice(1), io);
  }
  const { values, positionals } = parse(args, {});
  const id = theOne(positionals, "Say which goal: console goal <id>");
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.goal(id);
  const towards = await project.tasks({ goal: found.id });
  answer(io, session, { goal: found, tasks: towards.items }, () =>
    formatGoal(found, towards.items),
  );
  return EXIT.ok;
};

const decisions: Command = async (args, io) => {
  const { values } = parse(args, { open: { type: "boolean" }, ...PAGE_OPTIONS }, false);
  const page = pageOf(values);
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.decisions({
    ...(on(values, "open") ? { open: true } : {}),
    ...page,
  });
  answer(io, session, found, () =>
    found.items.length === 0
      ? "No decisions."
      : found.items.map(formatDecisionLine).join("\n") +
        formatMore(found.more, page.limit, page.offset),
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
    {
      task: { type: "string" },
      open: { type: "boolean" },
      mine: { type: "boolean" },
      ...PAGE_OPTIONS,
    },
    false,
  );
  const page = pageOf(values);
  const session = await open(io, values);
  const project = await session.project();
  const ref = text(values, "task");
  const taskId = ref === undefined ? undefined : (await project.task(ref)).id;
  const found = await project.runs({
    ...(taskId === undefined ? {} : { task: taskId }),
    ...(on(values, "open") ? { open: true } : {}),
    ...(on(values, "mine") ? { mine: true } : {}),
    ...page,
  });
  answer(io, session, found, () =>
    found.items.length === 0
      ? "No runs."
      : found.items.map(formatRunLine).join("\n") + formatMore(found.more, page.limit, page.offset),
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

/** A port for `serve`: the default, or what was said; 0 for one the system picks. */
function portOf(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_SERVE_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw misuse(`Not a port: ${value}`);
  }
  return port;
}

/**
 * A console of the person's own, served from this machine (ADR-0014): the build's pages here,
 * and everything under /api/ carried to the console with the token, which the pages never see.
 */
const serve: Command = async (args, io) => {
  const { values, positionals } = parse(args, { port: { type: "string" } });
  if (positionals.length > 1) {
    throw misuse("Say at most one directory: console serve [<dir>] [--port <n>]");
  }
  const [dir] = positionals;
  const port = portOf(text(values, "port"));
  const listen = io.listen;
  if (listen === undefined) {
    throw failed("Serving is not possible here.");
  }
  const session = await open(io, values);
  const me = await session.client.me();
  const person = me.person;
  if (person === null) {
    throw failed("The console does not know this token. Sign in again: console login");
  }
  let web: WebRoot | undefined;
  if (dir !== undefined) {
    try {
      web = await loadWebRoot(dir);
    } catch (error) {
      if (error instanceof WebRootError) {
        throw failed(
          `Not a build to serve: ${error.message}. Build your console first, and name the directory that holds its index.html: console serve <dir>`,
        );
      }
      throw error;
    }
  }
  const listening = await listen(
    (bound) =>
      createServeHandler({
        upstream: session.url,
        token: session.token,
        fetch: io.fetch,
        port: bound,
        web,
      }),
    port,
  );
  io.stdout(
    web === undefined
      ? `Serving the API of ${me.workspace.name} (${session.url}) at ${listening.url}api/ as ${person.login}, for a development server to send its /api/ requests to. Stop with Ctrl+C.\n`
      : `Serving ${dir} at ${listening.url} as ${person.login}: the pages are there, and everything under /api/ goes to ${me.workspace.name} (${session.url}) with your token, which the pages never see. Stop with Ctrl+C.\n`,
  );
  await listening.closed;
  return EXIT.ok;
};

// Configuring, as the person (ADR-0021): what an administrator or an owner does on the pages,
// their agent does here, attributed to them as the agent. The console decides on every request
// with the same roles; what the person may not, the agent may not (auth.forbidden). The tokens
// themselves have no command, by design.

const people: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const found = await session.client.people();
  answer(io, session, found, () =>
    [...found.items.map(formatPersonLine), ...found.listed.map(formatListingLine)].join("\n"),
  );
  return EXIT.ok;
};

const PERSON_USAGE =
  "Say what to do: console person role <login> <admin|member>  |  person add <login> [--host gh|google]  |  person remove <login>  |  person deactivate <login>  |  person reactivate <login>";

const person: Command = async (args, io) => {
  const what = args[0];
  if (what === "role") {
    const { values, positionals } = parse(args.slice(1), {});
    const [login, role] = theTwo(
      positionals,
      "Say whom and what: console person role <login> <admin|member>",
    );
    const wanted = personRoleOf(role);
    const session = await open(io, values);
    const found = await personOf(session, login);
    const changed = await session.client.updatePerson(found.id, { role: wanted });
    answer(io, session, changed, () => formatPersonLine(changed));
    return EXIT.ok;
  }
  if (what === "add") {
    const { values, positionals } = parse(args.slice(1), { host: { type: "string" } });
    const login = theOne(positionals, "Say whom: console person add <login> [--host gh|google]");
    const chosen = text(values, "host");
    const host = chosen === undefined ? hostOfLogin(login) : providerOf(chosen);
    const session = await open(io, values);
    const made = await session.client.createListing({ host, login });
    answer(io, session, made, () => formatListingLine(made));
    return EXIT.ok;
  }
  if (what === "remove") {
    const { values, positionals } = parse(args.slice(1), {});
    const login = theOne(positionals, "Say whom: console person remove <login>");
    const session = await open(io, values);
    const { listed } = await session.client.people();
    const found = listed.find((listing) => listing.login.toLowerCase() === login.toLowerCase());
    if (found === undefined) {
      throw misuse(
        `Nobody called ${login} is let in and not signed in yet. console people lists them; a person who signed in is taken out with console person deactivate <login>.`,
      );
    }
    await session.client.removeListing(found.id);
    answer(io, session, { removed: found }, () => `${found.login} is no longer let in.`);
    return EXIT.ok;
  }
  if (what === "deactivate" || what === "reactivate") {
    const { values, positionals } = parse(args.slice(1), {});
    const login = theOne(positionals, `Say whom: console person ${what} <login>`);
    const session = await open(io, values);
    const found = await personOf(session, login);
    const changed = await session.client.updatePerson(found.id, {
      status: what === "deactivate" ? "deactivated" : "active",
    });
    answer(io, session, changed, () => formatPersonLine(changed));
    return EXIT.ok;
  }
  throw misuse(PERSON_USAGE);
};

/** The flags that set what a project is, shared by making one and changing one. */
const PROJECT_FIELDS: OptionSpec = {
  description: { type: "string" },
  file: { type: "string" },
  visibility: { type: "string" },
  skills: { type: "string" },
  color: { type: "string" },
  symbol: { type: "string" },
};

/** What the flags say of a project; `none` clears what may be cleared. */
async function projectFieldsOf(io: CliIo, values: Values) {
  const description = await bodyOf(io, values, text(values, "description"));
  const visibility = text(values, "visibility");
  const skills = orNone(text(values, "skills"));
  const color = colorOrNoneOf(text(values, "color"));
  const symbol = orNone(text(values, "symbol"));
  return {
    ...(description === undefined
      ? {}
      : { description: description === "none" ? "" : description }),
    ...(visibility === undefined ? {} : { visibility: visibilityOf(visibility) }),
    ...(skills === undefined ? {} : { skillsAddress: skills }),
    ...(color === undefined ? {} : { color }),
    ...(symbol === undefined ? {} : { symbol }),
  };
}

const newProject: Command = async (args, io) => {
  const { values, positionals } = parse(args, PROJECT_FIELDS);
  const [key, name] = theTwo(
    positionals,
    'Say the key and the name: console project new <key> "<name>" [--visibility workspace|private]',
  );
  const fields = await projectFieldsOf(io, values);
  const session = await open(io, values);
  const made = await session.client.createProject({ key, name, ...fields });
  answer(
    io,
    session,
    made,
    () =>
      `Project made: ${made.name} (${made.key}), with you as its owner.\nTo work in it from this directory: console use ${made.key}`,
  );
  return EXIT.ok;
};

const editProject: Command = async (args, io) => {
  const { values, positionals } = parse(args, { ...PROJECT_FIELDS, name: { type: "string" } });
  const key = theOne(
    positionals,
    "Say which project: console project edit <key> --name <name> ...",
  );
  const name = text(values, "name");
  const patch = { ...(name === undefined ? {} : { name }), ...(await projectFieldsOf(io, values)) };
  if (Object.keys(patch).length === 0) {
    throw misuse(
      "Say what to change: --name, --description, --visibility, --skills, --color or --symbol; none clears the description, the skills address, the colour or the symbol.",
    );
  }
  const session = await open(io, values);
  const changed = await session.client.project(key).update(patch);
  answer(io, session, changed, () => formatProject(changed));
  return EXIT.ok;
};

/** The pack token (ADR-0028): read from standard input and never from an argument, so that no shell keeps it. */
const projectPackToken: Command = async (args, io) => {
  const { values, positionals } = parse(args, {
    stdin: { type: "boolean" },
    remove: { type: "boolean" },
  });
  const key = theOne(
    positionals,
    "Say which project: console project pack-token <key> --stdin, or console project pack-token <key> --remove",
  );
  if (on(values, "stdin") === on(values, "remove")) {
    throw misuse(
      "Say one of --stdin, which reads the token from standard input, and --remove, which takes it away.",
    );
  }
  const session = await open(io, values);
  const project = session.client.project(key);
  if (on(values, "remove")) {
    const changed = await project.removePackToken();
    answer(io, session, changed, () => formatProject(changed));
    return EXIT.ok;
  }
  const token = (await io.readStdin()).trim();
  if (token.length === 0) {
    throw failed("No token was given on standard input.");
  }
  const changed = await project.setPackToken({ token });
  answer(io, session, changed, () => formatProject(changed));
  return EXIT.ok;
};

const projectIcon: Command = async (args, io) => {
  const { values, positionals } = parse(args, { remove: { type: "boolean" } });
  const [key, file] = positionals;
  const removing = on(values, "remove");
  if (key === undefined || positionals.length > 2 || (file === undefined) !== removing) {
    throw misuse(
      "Say which project and which image: console project icon <key> <file>, or console project icon <key> --remove",
    );
  }
  const session = await open(io, values);
  const project = session.client.project(key);
  const changed =
    file === undefined
      ? await project.removeIcon()
      : await project.setIcon({
          name: basename(file),
          bytes: await io.readBytes(file),
          contentType: CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        });
  answer(io, session, changed, () => formatProject(changed));
  return EXIT.ok;
};

const project: Command = async (args, io) => {
  if (args[0] === "new") {
    return newProject(args.slice(1), io);
  }
  if (args[0] === "edit") {
    return editProject(args.slice(1), io);
  }
  if (args[0] === "icon") {
    return projectIcon(args.slice(1), io);
  }
  if (args[0] === "pack-token") {
    return projectPackToken(args.slice(1), io);
  }
  const { values, positionals } = parse(args, {});
  const key = theOne(
    positionals,
    "Say which project: console project <key>; or console project new, edit, icon or pack-token",
  );
  const session = await open(io, values);
  const found = await session.client.project(key).get();
  answer(io, session, found, () => formatProject(found));
  return EXIT.ok;
};

const members: Command = async (args, io) => {
  const { values } = parse(args, {}, false);
  const session = await open(io, values);
  const project = await session.project();
  const found = await project.members();
  answer(io, session, found, () =>
    found.items.length === 0
      ? "Nobody is listed in the project."
      : found.items.map(formatMemberLine).join("\n"),
  );
  return EXIT.ok;
};

/** The keys --project names with commas, each once, or nothing when it names one project or none. */
function projectKeysOf(value: string | undefined): readonly string[] | undefined {
  if (value === undefined || !value.includes(",")) {
    return undefined;
  }
  const keys = [...new Set(value.split(",").map((key) => key.trim()))].filter((key) => key !== "");
  if (keys.length === 0) {
    throw misuse("Say which projects: --project <key>[,<key>...]");
  }
  return keys;
}

const member: Command = async (args, io) => {
  const [verb, ...rest] = args;
  if (verb === "add") {
    const { values, positionals } = parse(rest, { role: { type: "string" } });
    const login = theOne(
      positionals,
      "Say whom: console member add <login> [--role owner|member] [--project <key>[,<key>...]]",
    );
    const role = text(values, "role");
    const session = await open(io, values);
    const input = {
      personId: (await personOf(session, login)).id,
      ...(role === undefined ? {} : { role: projectRoleOf(role) }),
    };
    // Several projects at once, where --project names them with commas: the person is listed
    // in each in turn, one listed already is said so, and the rest go on.
    const keys = projectKeysOf(text(values, "project"));
    if (keys !== undefined) {
      const added: { readonly project: string; readonly member: RestMember | null }[] = [];
      for (const key of keys) {
        try {
          added.push({ project: key, member: await session.client.project(key).addMember(input) });
        } catch (error) {
          if (!(error instanceof ApiError && error.code === "member.exists")) {
            throw error;
          }
          added.push({ project: key, member: null });
        }
      }
      answer(io, session, added, () =>
        added
          .map(
            ({ project, member }) =>
              `${project}  ${member === null ? `${login} is listed already` : formatMemberLine(member)}`,
          )
          .join("\n"),
      );
      return EXIT.ok;
    }
    const project = await session.project();
    const added = await project.addMember(input);
    answer(io, session, added, () => formatMemberLine(added));
    return EXIT.ok;
  }
  if (verb === "role") {
    const { values, positionals } = parse(rest, {});
    const [login, role] = theTwo(
      positionals,
      "Say whom and what: console member role <login> <owner|member>",
    );
    const wanted = projectRoleOf(role);
    const session = await open(io, values);
    const project = await session.project();
    const changed = await project.updateMember((await personOf(session, login)).id, {
      role: wanted,
    });
    answer(io, session, changed, () => formatMemberLine(changed));
    return EXIT.ok;
  }
  if (verb === "remove") {
    const { values, positionals } = parse(rest, {});
    const login = theOne(positionals, "Say whom: console member remove <login>");
    const session = await open(io, values);
    const project = await session.project();
    const found = await personOf(session, login);
    await project.removeMember(found.id);
    answer(
      io,
      session,
      { removed: found.login },
      () => `${found.login} is no longer listed in the project.`,
    );
    return EXIT.ok;
  }
  throw misuse(
    "Say what to do: console member add <login> [--role owner|member] [--project <key>[,<key>...]], console member role <login> <owner|member>, or console member remove <login>",
  );
};

const category: Command = async (args, io) => {
  const [verb, ...rest] = args;
  if (verb === "new") {
    const { values, positionals } = parse(rest, { color: { type: "string" } });
    const [key, name] = theTwo(
      positionals,
      'Say the key and the name: console category new <key> "<name>" [--color <name>]',
    );
    const color = text(values, "color");
    const session = await open(io, values);
    const made = await session.client.createCategory({
      key,
      name,
      ...(color === undefined ? {} : { color: colorOf(color) }),
    });
    answer(io, session, made, () => formatCategoryLine(made));
    return EXIT.ok;
  }
  if (verb === "edit") {
    const { values, positionals } = parse(rest, {
      name: { type: "string" },
      color: { type: "string" },
    });
    const key = theOne(
      positionals,
      "Say which category: console category edit <key> [--name <name>] [--color <name>]",
    );
    const name = text(values, "name");
    const color = text(values, "color");
    const patch = {
      ...(name === undefined ? {} : { name }),
      ...(color === undefined ? {} : { color: colorOf(color) }),
    };
    if (Object.keys(patch).length === 0) {
      throw misuse("Say what to change: --name or --color.");
    }
    const session = await open(io, values);
    const changed = await session.client.updateCategory(key, patch);
    answer(io, session, changed, () => formatCategoryLine(changed));
    return EXIT.ok;
  }
  if (verb === "remove") {
    const { values, positionals } = parse(rest, {});
    const key = theOne(positionals, "Say which category: console category remove <key>");
    const session = await open(io, values);
    await session.client.removeCategory(key);
    answer(io, session, { removed: key }, () => `Category ${key} removed.`);
    return EXIT.ok;
  }
  throw misuse(
    'Say what to do: console category new <key> "<name>" [--color <name>], console category edit <key> [--name <name>] [--color <name>], or console category remove <key>',
  );
};

const COMMANDS: Readonly<Record<string, Command>> = {
  login,
  logins,
  logout,
  whoami,
  serve,
  projects,
  use,
  work,
  tasks,
  task,
  goals,
  goal,
  categories,
  skills,
  skill,
  rules,
  people,
  person,
  project,
  members,
  member,
  category,
  take,
  report,
  "hand-in": handIn,
  comment,
  file,
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
    io.stdout(usage(io.version, io.skillsDir));
    return EXIT.ok;
  }
  const found = helpFor(name);
  if (found === undefined) {
    throw misuse(`Not a command: ${name}. The commands: ${Object.keys(COMMAND_HELP).join(", ")}`);
  }
  io.stdout(found);
  return EXIT.ok;
}

/**
 * A client of the console at `url`, naming the command on every request (ADR-0025). A redirect
 * is not followed: the token goes to the address the command resolved, and nowhere it is sent on to.
 */
function clientOf(io: CliIo, url: string, token?: string): ConsoleClient {
  return createClient({
    baseUrl: url,
    fetch: (input, init) => io.fetch(input, { ...init, redirect: "manual" }),
    ...(token === undefined ? {} : { token }),
    ...(io.userAgent === undefined ? {} : { userAgent: io.userAgent }),
  });
}

/** What the console said of itself on its last answer (ADR-0025): its version, and the range of command versions it takes. */
interface ConsoleSeen {
  version?: string | undefined;
  range?: string | undefined;
}

/** The command that puts the console's version where this command is installed. */
function updateWords(io: CliIo, version: string | undefined): string {
  const wanted = version ?? "latest";
  if (io.install === undefined) {
    return `npm install -g @skillcdn/console@${wanted}`;
  }
  const command = updateCommandFor(io.install, wanted);
  return io.install.kind === "project" ? `${command} (in ${io.install.root})` : command;
}

/**
 * What the command says of the versions once the console answered: that a newer command exists,
 * or that this one is newer than the console; once a day for one pair of versions, on stderr,
 * so that the console's JSON stays what it is. What is out of the range never gets here: the
 * console refused it, and the refusal says what to do.
 */
async function noticeVersions(io: CliIo, seen: ConsoleSeen): Promise<void> {
  const command = parseVersion(io.version);
  const server = parseVersion(seen.version);
  if (
    io.version === undefined ||
    seen.version === undefined ||
    command === undefined ||
    server === undefined
  ) {
    return;
  }
  const { verdict } = judgeClient(command, server);
  if (verdict !== "behind" && verdict !== "ahead") {
    return;
  }
  const previous = await io.notices?.load();
  const now = io.now();
  if (
    previous !== undefined &&
    previous.command === io.version &&
    previous.console === seen.version &&
    now - Date.parse(previous.shownAt) < DAY_MS
  ) {
    return;
  }
  io.stderr(
    verdict === "behind"
      ? `A newer command exists: the console runs ${seen.version}, this command is ${io.version}. Update it: ${updateWords(io, seen.version)}\n`
      : `This command (${io.version}) is newer than the console (${seen.version}, which takes ${seen.range ?? "an older line"}): it works, and what the console has not got yet is refused as not found; nothing to do until then. The console's operator updates it; to match the console meanwhile: ${updateWords(io, seen.version)}\n`,
  );
  await io.notices?.save({
    command: io.version,
    console: seen.version,
    shownAt: new Date(now).toISOString(),
  });
}

/** What a refusal of the console is followed by, when there is something to do about it. */
function hintFor(error: ApiError, io: CliIo, seen: ConsoleSeen): string {
  switch (error.code) {
    case "client.outdated":
      return `Update the command: ${updateWords(io, seen.version)}\n`;
    case "client.too_new":
      return `Install the console's version: ${updateWords(io, seen.version)}; or ask the console's operator to update the console.\n`;
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
    case "task.invalid_category":
      return "No category has that key. console categories lists them.\n";
    case "task.invalid_goal":
      return "No goal of this project has that id. console goals lists them.\n";
    case "task.invalid_dates":
      return "The due day is before the start. Say a due day on or after it.\n";
    case "goal.not_found":
      return "No goal of this project has that id. console goals lists them.\n";
    case "goal.invalid_category":
      return "No category has that key. console categories lists them.\n";
    case "goal.invalid_dates":
      return "The target day is before the start. Say a target day on or after it.\n";
    case "auth.forbidden":
      return "What was asked is an administrator's, or an owner's of the project, and the person this token acts as is not one here. Hand the step to them.\n";
    case "project.key_taken":
      return "A project has that key already. console projects lists them.\n";
    case "project.invalid_address":
      return "The skills address is not one as SkillCDN spells it; none makes the organization's skills the project's.\n";
    case "project.invalid_icon":
      return "The image must be a PNG, a JPEG, a GIF or a WebP, known by its bytes.\n";
    case "member.exists":
      return "The person is listed already. console member role <login> <owner|member> changes what they are.\n";
    case "member.not_found":
      return "The person is not listed in the project. console members lists those who are.\n";
    case "category.key_taken":
      return "A category has that key already. console categories lists them.\n";
    case "category.not_found":
      return "No category has that key. console categories lists them.\n";
    case "category.in_use":
      return "Tasks are sorted into the category. Move them out first: console task edit <number> --category <other|none>\n";
    case "person.last_admin":
      return "The board keeps at least one administrator in. Make another one first.\n";
    case "person.of_organization":
      return "The organization says who is in: a person it let in comes and goes with it, and is listed by login to stay.\n";
    case "listing.exists":
      return "The login is let in already, or is a person's who is in. console people lists both.\n";
    case "listing.not_found":
      return "No login let in and not signed in yet has that id. console people lists them.\n";
    case "listing.unknown_host":
      return "Nobody signs in through that provider here. console whoami --json names the ways in.\n";
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
  // Every answer of the console says its version and the range it takes; the command reads
  // them off the answers it gets anyway, and asks nothing more (ADR-0025).
  const seen: ConsoleSeen = {};
  const watched: CliIo = {
    ...io,
    fetch: async (input, init) => {
      const response = await io.fetch(input, init);
      seen.version = response.headers.get(VERSION_HEADER) ?? seen.version;
      seen.range = response.headers.get(CLIENT_RANGE_HEADER) ?? seen.range;
      return response;
    },
  };
  try {
    if (name === "--version" || name === "-v" || name === "version") {
      io.stdout(
        `console ${io.version ?? "(version unknown)"} (@skillcdn/console)${io.install === undefined ? "" : `, ${describeInstall(io.install)}`}\n`,
      );
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
    const exit = await command(rest, watched);
    if (name !== "whoami") {
      await noticeVersions(io, seen);
    }
    return exit;
  } catch (error) {
    if (error instanceof CliExit) {
      io.stderr(`${error.message}\n`);
      return error.exit;
    }
    if (error instanceof ApiError) {
      io.stderr(`${error.code}: ${error.message}\n${hintFor(error, io, seen)}`);
      return error.code === "client.outdated" || error.code === "client.too_new"
        ? EXIT.incompatible
        : EXIT.failed;
    }
    throw error;
  }
}
