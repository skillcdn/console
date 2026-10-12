import {
  DEFAULT_PAGE_LIMIT,
  MAX_AGENT_LENGTH,
  MAX_ARTIFACTS_PER_RUN,
  MAX_BODY_LENGTH,
  MAX_CATEGORIES,
  MAX_CATEGORY_KEY_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_DOCUMENT_LENGTH,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_FILE_BYTES,
  MAX_FILES_PER_DOCUMENT,
  MAX_LINK_LABEL_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_ICON_BYTES,
  MAX_PROJECT_KEY_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_SYMBOL_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_REPORTS_PER_RUN,
  MAX_RULES_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_VERSIONS_PER_DOCUMENT,
  MIN_OPTIONS,
} from "../limits.js";
import { COLOR_NAMES } from "../vocabulary.js";

// What the command says about itself: for an agent that meets it for the first time, and for a
// person. One table for every command, from which the usage and each command's help are made:
// the overview says what each command does, and a command's own help adds the limits the
// console holds it to and the refusals it may meet, so that an agent learns them before it
// runs into them.

export interface CommandHelp {
  /** The command and its arguments, after `console`. */
  readonly usage: string;
  /** What it does, in a sentence. */
  readonly about: string;
  /** What the console holds the arguments to. */
  readonly limits?: readonly string[];
  /** What the console may refuse, by code, and what to do then. */
  readonly refusals?: readonly string[];
}

/** The refusals any command may meet, said once in the overview. */
const COMMON_REFUSALS = [
  "auth.required: the token is not one the console knows, any more or at all; a person signs the command in again",
  "request.invalid: what was sent is over a limit or malformed; the message names the field",
  "network: the console could not be reached at its address",
];

const RUN_REFUSALS = [
  "run.not_yours: the run is another person's",
  "run.over: the run has ended already",
];

const MARKDOWN = `Markdown, up to ${MAX_BODY_LENGTH} characters`;

const DOCUMENT_PATH = `a path of lowercase letters, digits and hyphens, with slashes between its folders (guides/onboarding), up to ${MAX_DOCUMENT_PATH_LENGTH} characters; it does not change once written`;
const DOCUMENT_REFUSALS = ["document.not_found: no page has that path in this project"];

const DAY = "a day as 2026-10-24, today, tomorrow, or +7 for seven days from today";
const COLORS = `one of ${COLOR_NAMES.join(", ")}`;
const KEY = "lowercase letters, digits and hyphens";
const TASK_FIELD_FLAGS =
  "[--state <state>] [--priority <priority>] [--category <key>] [--goal <id>] [--starts <day>] [--due <day>] [--assignee <login|me>] [--parent <number|id>]";
const TASK_FIELD_LIMITS = [
  `starts, due: ${DAY}; the due day is not before the start`,
  "category: the key of one of the workspace's categories (console categories); goal: the id of one of the project's goals (console goals)",
  "assignee: a login of the workspace, or me; parent: a task of the project",
];
const TASK_FIELD_REFUSALS = [
  "task.invalid_category: no category has that key",
  "task.invalid_goal: the goal is not one of this project",
  "task.invalid_dates: the due day is before the start",
  "task.invalid_assignee: the person may not work in the project",
  "task.invalid_parent: the parent is not a task of the project, or would make a loop",
];

export const COMMAND_HELP: Readonly<Record<string, CommandHelp>> = {
  login: {
    usage: "login --url <origin> [--agent <name>] [--token-stdin]",
    about:
      "Connects this agent to the console: shows an address and a code, which a person opens signed in, names the agent and approves; the command then receives a token of its own and keeps it, with the console's address, in your home directory, never showing it. An agent running the command relays the address and the code to its person and waits. --agent says what the agent calls itself; left out, the command names the agent it runs under where its environment says so (Claude Code, Codex), else An agent; the machine's name follows, and the pages show the name before 'on' with the whole on hover. --token-stdin reads a token made by hand from standard input instead, for a script or a job.",
    refusals: [
      "connect.not_found: the code was not approved in time, or the person said it was not theirs; run login again",
      "the console does not know the token given: make one on the Agents page and try again",
    ],
  },
  logout: {
    usage: "logout",
    about:
      "Signs this agent out: gives the token up at the console, so that it is good for nothing from now on, and forgets it with the address kept here. A console out of reach leaves the token to the Agents page.",
  },
  whoami: {
    usage: "whoami",
    about:
      "Who the token acts as, which console it is for, and which project this directory works in.",
  },
  projects: {
    usage: "projects",
    about:
      "The projects you may work in: each with its key, its name, what you are in it, and what waits in it. Every command on the board works in one project.",
  },
  use: {
    usage: "use <key>",
    about:
      "Says which project this directory works in: writes .skillcdn-console.json here, which the commands read from this directory or one above it, and which is meant to be committed. --project <key> on any command, or CONSOLE_PROJECT in the environment, wins over it.",
    refusals: ["project.not_found: no project has the key, or it is not yours to see"],
  },
  work: {
    usage: "work [--person <login>]",
    about:
      "What is on your plate across the projects you may see: the open tasks assigned to you, the sooner due first, each with its project; and the decisions waiting for a person. Needs no project. --person <login> shows another person's plate, for an administrator or for an owner of a project they are in: their open tasks within the projects you may see, without the decisions, which wait for anyone.",
  },
  tasks: {
    usage:
      "tasks [--state <state>] [--open] [--mine] [--category <key>] [--goal <id>] [--due <day|today|week|overdue>] [--limit <n>] [--offset <n>]",
    about: `The tasks on the board, newest first: number, state, priority, title, who owns and works on each, its category and its due day, and what waits on it. --open keeps the ones not done or dropped, --mine those assigned to you, --category and --goal those sorted into one, --due those due by a day: today, within the week, or overdue (the open ones past their day). A page at a time: ${DEFAULT_PAGE_LIMIT} unless --limit says otherwise, from --offset on; a last line says when there is more. States: idea, ready, in_progress, in_review, done, dropped.`,
  },
  task: {
    usage: `task <number|id>  |  task new <title> [--body <markdown>|--file <path>] ${TASK_FIELD_FLAGS}  |  task edit <number|id> [--title <title>] [--body <markdown>|--file <path>] ${TASK_FIELD_FLAGS}`,
    about:
      "One task in full, with its plan (category, goal, start and due days), what happened to it (when it was started and done, which the board keeps itself), the decisions about it and the runs on it; or a new task written down; or a task changed, only in what the flags say, where none clears a field (priorities: low, normal, high, urgent).",
    limits: [
      `title: one line, up to ${MAX_TITLE_LENGTH} characters`,
      `body: ${MARKDOWN}`,
      ...TASK_FIELD_LIMITS,
    ],
    refusals: ["task.not_found: no task has that number or id", ...TASK_FIELD_REFUSALS],
  },
  goals: {
    usage: "goals",
    about:
      "The roadmap of the project: its goals, the active first, each with its id, its state (planned, active, done, dropped), its target day, and how far it is, counted from the tasks that work towards it.",
  },
  goal: {
    usage:
      'goal <id>  |  goal new "<title>" [--body <markdown>|--file <path>] [--state <state>] [--due <day>]  |  goal edit <id> [--title <title>] [--body <markdown>|--file <path>] [--state <state>] [--due <day|none>]',
    about:
      "One goal in full, with the tasks that work towards it; or a goal set on the roadmap, for an owner of the project; or one changed, only in what the flags say. A task works towards a goal through its --goal.",
    limits: [
      `title: one line, up to ${MAX_TITLE_LENGTH} characters`,
      `body: ${MARKDOWN}`,
      `due: ${DAY}`,
    ],
    refusals: [
      "goal.not_found: no goal of this project has that id",
      "auth.forbidden: only an owner of the project sets its roadmap",
    ],
  },
  categories: {
    usage: "categories",
    about:
      "The categories tasks are sorted into, the same in every project: each with its key, which --category takes, its name and its colour. An administrator keeps them: console category, or the Categories page.",
  },
  people: {
    usage: "people",
    about:
      "Everyone of the workspace, by login, with their name where the host gives one and what they are in it: admin, who configures the workspace, or member, who works in the projects they are in; a person taken out is marked deactivated. Then the logins an administrator let in that nobody has signed in with yet. The logins are what --assignee, member and person take.",
  },
  person: {
    usage:
      "person role <login> <admin|member>  |  person add <login> [--host gh|google]  |  person remove <login>  |  person deactivate <login>  |  person reactivate <login>",
    about:
      "For an administrator: the person themselves on the People page, or their agent here, named on it. role says what a person is in the workspace; the board keeps at least one administrator in. add lets a login in: whoever signs in with that account at that host is a person from then on; the host is read off the login (an address is Google's, anything else GitHub's) unless --host says. remove takes a login away that nobody has signed in with yet. deactivate takes a person out: refused on every request at once, their agents with them, kept with everything they did, and listed nowhere; reactivate takes them back in. A person the organization let in comes and goes with it, and is neither.",
    refusals: [
      "auth.forbidden: only an administrator says who is in and what they are",
      "person.last_admin: the board keeps at least one administrator in; make another one first",
      "person.of_organization: the organization says whether that person is in",
      "listing.exists: the login is let in already, or is a person's who is in",
      "listing.unknown_host: nobody signs in through that provider here",
    ],
  },
  project: {
    usage:
      'project <key>  |  project new <key> "<name>" [--description <markdown>|--file <path>] [--visibility workspace|private] [--skills <address>|none] [--color <name>] [--symbol <text>]  |  project edit <key> [--name "<name>"] [the same flags; none clears]  |  project icon <key> <file>  |  project icon <key> --remove',
    about:
      "One project in full; or a project made, with you as its owner, private unless --visibility workspace says everyone of the workspace works in it; or one changed, only in what the flags say, for an owner; or its image for its mark, set from a file of this machine or taken away. The organization's skills are the project's unless --skills names an address of its own.",
    limits: [
      `key: ${KEY}, up to ${MAX_PROJECT_KEY_LENGTH} characters; it does not change once made`,
      `name: one line, up to ${MAX_PROJECT_NAME_LENGTH} characters; description: up to ${MAX_PROJECT_DESCRIPTION_LENGTH}`,
      `color: ${COLORS}; symbol: up to ${MAX_PROJECT_SYMBOL_LENGTH} characters without spaces, shown on the colour; left out, the pages choose both from the key and the name`,
      `image: a PNG, a JPEG, a GIF or a WebP of at most ${MAX_PROJECT_ICON_BYTES} bytes`,
    ],
    refusals: [
      "project.not_found: no project has that key, or it is not yours to see",
      "auth.forbidden: only an owner of the project changes it",
      "project.key_taken: a project has that key already",
      "project.invalid_address: the skills address is not one as SkillCDN spells it",
      "project.invalid_icon: the file is not an image of those kinds, by its bytes",
      "request.too_large: the image is over the limit",
    ],
  },
  members: {
    usage: "members",
    about:
      "Those listed in the project, by login, with what each is in it (owner, who configures it; member, who works on it) and since when. A project open to the workspace has everyone of it as a member besides, and an administrator owns every project.",
  },
  member: {
    usage:
      "member add <login> [--role owner|member]  |  member role <login> <owner|member>  |  member remove <login>",
    about:
      "Lists a person of the workspace in the project, as a member unless --role says owner; changes what they are in it; or takes them off the list. For an owner of the project.",
    refusals: [
      "auth.forbidden: only an owner of the project lists its members",
      "member.invalid_person: the person is not of the workspace",
      "member.exists: the person is listed already; member role changes what they are",
      "member.not_found: the person is not listed in the project",
    ],
  },
  category: {
    usage:
      'category new <key> "<name>" [--color <name>]  |  category edit <key> [--name "<name>"] [--color <name>]  |  category remove <key>',
    about:
      "Makes a category tasks are sorted into, the same in every project; changes its name or its colour; or removes one no task is sorted into. For an administrator.",
    limits: [
      `key: ${KEY}, up to ${MAX_CATEGORY_KEY_LENGTH} characters; it does not change once made`,
      `name: one line, up to ${MAX_CATEGORY_NAME_LENGTH} characters; color: ${COLORS}, gray when left out`,
      `at most ${MAX_CATEGORIES} categories in the workspace`,
    ],
    refusals: [
      "auth.forbidden: only an administrator keeps the categories",
      "category.key_taken: a category has that key already",
      "category.not_found: no category has that key",
      "category.in_use: tasks are sorted into it; move them out first (console task edit <number> --category <other|none>)",
      "category.too_many: the workspace holds as many categories as one may",
    ],
  },
  skills: {
    usage: "skills",
    about:
      "The organization's skills, as SkillCDN serves them at the project's address: each with its description and the URI you load it by through your own SkillCDN connection, which a person makes at the address's page when you have none; and where the console's own skills are on this machine. --json adds the page of each, for a person.",
  },
  rules: {
    usage:
      "rules  |  rules write --body <markdown>|--file <path>|-|none [--workspace] [--base <version>]",
    about:
      "What this organization asks of agents (ADR-0023): the workspace's rules, the console's own until an administrator writes the organization's, and this project's own when it has them. Read them before taking a task; take prints them again. rules write writes this project's rules, for an owner, or with --workspace the workspace's, for an administrator; none puts the written rules away, so that the console's own hold again, or the project adds none. Without a project named, rules shows the workspace's alone.",
    limits: [
      `body: Markdown, up to ${MAX_RULES_LENGTH} characters; the console's own rules, written as they are, write nothing`,
    ],
    refusals: [
      "auth.forbidden: an owner writes a project's rules, an administrator the workspace's",
      "document.conflict: the rules have moved on since --base; read them again",
    ],
  },
  take: {
    usage: "take <number|id> [--agent <name>]",
    about:
      "Takes a task: a run begins, and the task is in progress and the person's. A run still open on the task is taken over, since the board cannot know whether its agent still runs: it ends as abandoned, the feed says who took over, and that agent is refused on its next command. Look before taking (console task <number> lists the runs, with when each was last heard from), and take a task another agent was heard from on lately only when told to. --agent is what people see at work; left out, it is what the person called the token.",
    limits: [`agent: one line, up to ${MAX_AGENT_LENGTH} characters`],
    refusals: [
      "task.not_found: no task has that number or id",
      "run.task_closed: the task is done or dropped",
    ],
  },
  report: {
    usage: "report <markdown>  |  report --file <path>  |  report -",
    about:
      "Says how the work goes, in Markdown: what was found, what was done, what is next. A milestone at a time, not every step. With - the report is read from standard input.",
    limits: [
      `the report: ${MARKDOWN}, not blank`,
      `at most ${MAX_REPORTS_PER_RUN} reports on one run`,
    ],
    refusals: [...RUN_REFUSALS, "run.too_many_reports: the run carries as many as one may"],
  },
  "hand-in": {
    usage: "hand-in <https url | file path> [--label <words>]",
    about:
      "Hands in what was made: a link (a branch, a pull request, a document, a page), or a file from this machine, which the console keeps and shows on the task.",
    limits: [
      "a link: https only",
      `a file: up to ${MAX_FILE_BYTES} bytes, not empty; it is called by its name, without the path`,
      `label: one line, up to ${MAX_LINK_LABEL_LENGTH} characters`,
      `at most ${MAX_ARTIFACTS_PER_RUN} links and files on one run`,
    ],
    refusals: [
      ...RUN_REFUSALS,
      "run.too_many_artifacts: the run carries as many as one may",
      "request.too_large: the file is over the limit",
    ],
  },
  ask: {
    usage:
      'ask "<question>" --option "<label>" --option "<label>" [...] [--body <markdown>|--file <path>] [--wait <seconds>]',
    about:
      "Raises a decision a person must make: the question, the options to choose from, and what they need to know. The run waits for the answer. The command waits 60 seconds for it unless --wait says otherwise, and exits with 3 if it is still to come: keep waiting with `console decision <id> --wait 100`, within what your shell gives one command, and go on meanwhile only with work that does not depend on the answer. The decision's id is printed as soon as it is raised.",
    limits: [
      `question: one line, up to ${MAX_QUESTION_LENGTH} characters`,
      `options: ${MIN_OPTIONS} to ${MAX_OPTIONS}, each one line up to ${MAX_OPTION_LABEL_LENGTH} characters`,
      `body: ${MARKDOWN}`,
    ],
    refusals: ["decision.invalid_run: the run is not yours, or is over"],
  },
  decision: {
    usage: "decision <id> [--wait <seconds>]  |  decision <id> --outcome <markdown>|--file <path>",
    about:
      "One decision, with its context, its options, its answer and what followed. With --wait, holds on for the answer that long, and exits with 3 if it is still to come. With --outcome, writes down what followed the decision, so that it reads as a record.",
    limits: [`outcome: ${MARKDOWN}`],
    refusals: ["decision.not_found: no decision has that id"],
  },
  decisions: {
    usage: "decisions [--open] [--limit <n>] [--offset <n>]",
    about: `The decisions on the board, the waiting first; --open keeps only those. A page at a time: ${DEFAULT_PAGE_LIMIT} unless --limit says otherwise, from --offset on.`,
  },
  finish: {
    usage: 'finish [--summary "<markdown>"|--file <path>]',
    about:
      "Ends the run: the work is done and handed in, and the task goes up for review. The summary says what was done and what is left; the result itself goes in a last report before, which may be much longer.",
    limits: [`summary: ${`Markdown, up to ${MAX_SUMMARY_LENGTH} characters`}`],
    refusals: RUN_REFUSALS,
  },
  fail: {
    usage: 'fail [--summary "<markdown>"|--file <path>]',
    about: "Ends the run: the work could not be done. The summary says why, and what is left.",
    limits: [`summary: Markdown, up to ${MAX_SUMMARY_LENGTH} characters`],
    refusals: RUN_REFUSALS,
  },
  abandon: {
    usage: 'abandon [<run id>] [--summary "<markdown>"]',
    about:
      "Leaves a run; the task stays as it is. A person gives up this way on a run of theirs that will not come back.",
    limits: [`summary: Markdown, up to ${MAX_SUMMARY_LENGTH} characters`],
    refusals: RUN_REFUSALS,
  },
  runs: {
    usage: "runs [--task <number|id>] [--open] [--mine] [--limit <n>] [--offset <n>]",
    about: `The runs, newest first, each with when its agent was last heard from: --open keeps the ones not over, --mine those begun with this token. A page at a time: ${DEFAULT_PAGE_LIMIT} unless --limit says otherwise, from --offset on.`,
  },
  run: {
    usage: "run <id>",
    about: "One run in full: its reports, what it handed in, what it waits for, how it ended.",
    refusals: ["run.not_found: no run has that id"],
  },
  docs: {
    usage: "docs [<folder>] [--search <words>] [--archived]",
    about:
      "The pages of the project's documents: those in a folder, with the folders in it (the root when none is named), or those found by words in their title or body. Archived pages are left out unless --archived.",
  },
  doc: {
    usage: "doc <path> [--version <n>|--versions]",
    about:
      "One page in full: its title, its body in Markdown, what it links to, what refers to it (pages, tasks, decisions), and its files. --versions lists its versions, who wrote each and when; --version <n> prints one as it was.",
    refusals: [...DOCUMENT_REFUSALS, "document.version_not_found: the page has no such version"],
  },
  write: {
    usage: 'write <path> [--title "<title>"] --body <markdown>|--file <path> [--base <version>]',
    about:
      "Writes a page: the first version at a new path, or a new version of the page there. A link in the body whose destination is a page's path (guides/onboarding) refers to that page, and the page says what refers to it. Without --title the page keeps its title. With --base, the write is refused if the page has moved on since that version.",
    limits: [
      `path: ${DOCUMENT_PATH}`,
      `title: one line, up to ${MAX_TITLE_LENGTH} characters`,
      `body: Markdown, up to ${MAX_DOCUMENT_LENGTH} characters`,
      `at most ${MAX_VERSIONS_PER_DOCUMENT} versions of one page`,
    ],
    refusals: [
      "document.invalid_path: the path is not one",
      "document.conflict: the page has moved on since --base; read it again",
      "document.archived: the page is archived; restore it first",
      "document.too_many_versions: the page carries as many versions as one may; write a new page",
    ],
  },
  attach: {
    usage: "attach <path> <file> [--label <words>]",
    about:
      "Attaches a file from this machine to a page: the console keeps it, and the page shows it.",
    limits: [
      `a file: up to ${MAX_FILE_BYTES} bytes, not empty; it is called by its name, without the path`,
      `at most ${MAX_FILES_PER_DOCUMENT} files on one page`,
    ],
    refusals: [
      ...DOCUMENT_REFUSALS,
      "document.archived: the page is archived; restore it first",
      "document.too_many_files: the page carries as many files as one may",
      "request.too_large: the file is over the limit",
    ],
  },
  archive: {
    usage: "archive <path>",
    about:
      "Puts a page away: out of the folders and the search, still readable at its path, not written to until restored. Nothing is deleted.",
    refusals: DOCUMENT_REFUSALS,
  },
  restore: {
    usage: "restore <path>",
    about: "Brings an archived page back.",
    refusals: DOCUMENT_REFUSALS,
  },
  serve: {
    usage: "serve [<dir>] [--port <n>]",
    about:
      "For a person: serves a console of your own from this machine, for you. The build in <dir> (its index.html and files) is served at http://127.0.0.1:11197/, and everything under /api/ is carried to the console you are signed in to with your token, which the pages never see. Without a directory only the API is served there, for a development server to send its /api/ requests to. The loopback only; a request from another site's page is refused. Stop it with Ctrl+C.",
    refusals: ["not a build to serve: the directory holds no index.html"],
  },
};

/** The first lines of the usage, with the version of the command when it is known. */
const preamble = (version: string | undefined): string =>
  `console${version === undefined ? "" : ` ${version}`}: the board of your organization's work with AI agents, from the command line.
You act as the person whose token you hold; everything you send is shown to people as text.
console rules says what this organization asks of agents: read it before taking a task.

Usage: console <command> [arguments] [--json] [--url <origin>] [--project <key>]
`;

const CLOSING = `Options everywhere: --json answers with the console's own JSON; --url names another console;
--project names the project to work in, over CONSOLE_PROJECT and over what console use kept here.
A listing (tasks, decisions, runs) is a page at a time: --limit <n> and --offset <n>, and a last line
says when there is more, so that nothing is read that is not needed.
Commands on a run (report, hand-in, ask, finish, fail) act on your one open run in the project;
with several open, say which with --run <id>. A Markdown body given as - is read from standard input.
console help <command> says what each command takes, the limits the console holds it to, and
what it may refuse. console --version says which version of the command this is.

Exit codes: 0 done; 1 the console refused, or could not be reached (the reason is on stderr);
2 the command was not understood; 3 the decision still waits for a person.
What the console refuses is printed as its code and its words. Everywhere:
${COMMON_REFUSALS.map((refusal) => `  ${refusal}`).join("\n")}

Credentials: CONSOLE_URL and CONSOLE_TOKEN in the environment, else what login kept in
$XDG_CONFIG_HOME/skillcdn-console/credentials.json (~/.config when XDG_CONFIG_HOME is unset).
`;

const SECTIONS: readonly { readonly title: string; readonly commands: readonly string[] }[] = [
  {
    title: "Signing in, once, as a person, and the project to work in",
    commands: ["login", "logout", "whoami", "projects", "use"],
  },
  {
    title: "The board",
    commands: [
      "work",
      "tasks",
      "task",
      "goals",
      "goal",
      "categories",
      "decisions",
      "decision",
      "runs",
      "run",
      "skills",
      "rules",
    ],
  },
  { title: "Working", commands: ["take", "report", "hand-in", "ask", "finish", "fail", "abandon"] },
  {
    title: "The documents: the project's pages of Markdown, in folders, by path",
    commands: ["docs", "doc", "write", "attach", "archive", "restore"],
  },
  {
    title:
      "Configuring, as the person: what an administrator or an owner does on the pages, their agent does here, named on it",
    commands: ["people", "person", "project", "members", "member", "category"],
  },
];

/** The whole usage, as `console help` prints it, naming the version when it is known. */
export function usage(version?: string): string {
  const parts = [preamble(version)];
  for (const section of SECTIONS) {
    parts.push(`${section.title}`);
    for (const name of section.commands) {
      const help = COMMAND_HELP[name];
      if (help !== undefined) {
        parts.push(`  console ${help.usage}\n      ${help.about}`);
      }
    }
    parts.push("");
  }
  parts.push(CLOSING);
  return parts.join("\n");
}

/** What `console help <command>` prints, or nothing for a command that is not one. */
export function helpFor(name: string): string | undefined {
  const help = COMMAND_HELP[name];
  if (help === undefined) {
    return undefined;
  }
  const parts = [`console ${help.usage}`, "", help.about];
  if (help.limits !== undefined) {
    parts.push("", "Limits:", ...help.limits.map((limit) => `  ${limit}`));
  }
  if (help.refusals !== undefined) {
    parts.push("", "Refusals:", ...help.refusals.map((refusal) => `  ${refusal}`));
  }
  return `${parts.join("\n")}\n`;
}
