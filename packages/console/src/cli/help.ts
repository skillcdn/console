import {
  DEFAULT_PAGE_LIMIT,
  MAX_AGENT_LENGTH,
  MAX_ARTIFACTS_PER_RUN,
  MAX_BODY_LENGTH,
  MAX_CATEGORIES,
  MAX_CATEGORY_KEY_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_COMMENTS_PER_TASK,
  MAX_DOCUMENT_LENGTH,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_FILE_BYTES,
  MAX_FILES_PER_COMMENT,
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
// person. One table for every command, from which two layers are made. The overview is a map:
// every command in a line, what it does in a sentence, and what holds everywhere, short enough
// to be read once at the start. A command's own help is the reference: every form and flag, what
// each does, the limits the console holds it to and the refusals it may meet, read when the
// command is about to be used. How the work goes is the skill working-the-board, and what the
// organization asks is the rules of the board: neither is repeated here.

export interface CommandHelp {
  /** The command and its arguments, after `console`, every form and flag. */
  readonly usage: string;
  /** The usage as the overview shows it, for a command whose forms are many; `usage` has them all. */
  readonly overview?: string;
  /** What it does, in one line, for the overview. */
  readonly synopsis: string;
  /** What it does in full, for the command's own help. */
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

/** How a command on a run finds its run, and what it says when it cannot: the command's own refusals. */
const RUN_CHOICE = [
  "run.none: no run of yours is open in the project; take a task first, or name a run with --run <id>",
  "run.ambiguous: several runs of yours are open in the project; say which with --run <id>",
];

const RUN_REFUSALS = [
  ...RUN_CHOICE,
  "run.not_yours: the run is another person's",
  "run.over: the run has ended already",
];

/** What every command on a run says of the run it acts on. */
const ON_THE_RUN = "On your one open run in the project, or the one --run <id> names.";

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
    usage: "login --url <origin> [--agent <name>] [--token-stdin] [--default]",
    synopsis:
      "Connects this agent to the console with a code a person approves; keeps the token, never shows it.",
    about:
      "Connects this agent to the console: shows an address and a code, which a person opens signed in, names the agent and approves; the command then receives a token of its own and keeps it, with the console's address and the account, in your home directory, never showing it. One login per console and account: a second console adds a login beside the first, the first is the default console a directory that names none works at, and --default makes this one that. A login repeated for the same console and account replaces its token, which is given up at the console. An agent running the command relays the address and the code to its person and waits. --agent says what the agent calls itself; left out, the command names the agent it runs under where its environment says so (Claude Code, Codex), else An agent; the machine's name follows, and the pages show the name before 'on' with the whole on hover. --token-stdin reads a token made by hand from standard input instead, for a script or a job.",
    refusals: [
      "connect.not_found: the code was not approved in time, or the person said it was not theirs; run login again",
      "the console does not know the token given: make one on the Agents page and try again",
    ],
  },
  logins: {
    usage: "logins",
    synopsis: "The consoles this machine is signed in to, and which is the default.",
    about:
      "The consoles this machine is signed in to, each with the account, what the token is called there, since when, and which is the default; never a token.",
  },
  logout: {
    usage: "logout [--url <origin>] [--account <login>]",
    synopsis: "Gives this agent's token up at one console and forgets it here.",
    about:
      "Signs this agent out of one console: gives the token up there, so that it is good for nothing from now on, and forgets it here. Which console: --url, else the one this directory is bound to, else the default, else the one console signed in to; --account says which account where the console has several. A console out of reach leaves the token to the Agents page.",
  },
  whoami: {
    usage: "whoami",
    synopsis: "Who the token acts as, at which console, and in which project this directory works.",
    about:
      "Who the token acts as, which console the command talks to from here and as which account, and which project this directory works in.",
  },
  projects: {
    usage: "projects",
    synopsis: "The projects you may work in, with what you are in each.",
    about:
      "The projects you may work in: each with its key, its name, what you are in it, and what waits in it. Every command on the board works in one project.",
  },
  use: {
    usage: "use <key> [--url <origin>] [--account <login>]",
    synopsis:
      "Binds this directory to a project: writes .skillcdn-console.json here, and prints the sentence for the checkout's agreement.",
    about:
      "Says which project this directory works in: writes .skillcdn-console.json here, which the commands read from this directory or one above it, and which is meant to be committed in a private repository and left out of a public one. The file names the project; and the console, where that is not the default login here or --url says so; and the account, where the console has several logins or --account says so. Never a token. --project <key> on any command, or CONSOLE_PROJECT in the environment, wins over the project it names. Then prints the sentence for the checkout's agreement (AGENTS.md, or CLAUDE.md where that is the file agents read), to be copied as it is, since nothing sends an agent to the console until the checkout says so.",
    refusals: ["project.not_found: no project has the key, or it is not yours to see"],
  },
  work: {
    usage: "work [--person <login>]",
    synopsis:
      "What is on your plate across your projects: your open tasks, and the decisions waiting.",
    about:
      "What is on your plate across the projects you may see: the open tasks assigned to you, the sooner due first, each with its project; and the decisions waiting for a person. Needs no project. --person <login> shows another person's plate, for an administrator or for an owner of a project they are in: their open tasks within the projects you may see, without the decisions, which wait for anyone.",
  },
  tasks: {
    usage:
      "tasks [--state <state>] [--open] [--mine] [--category <key>] [--goal <id>] [--due <day|today|week|overdue>] [--unassigned] [--archived] [--limit <n>] [--offset <n>]",
    synopsis:
      "The tasks on the board, newest first, narrowed by state, owner, category, goal or due day.",
    about: `The tasks on the board, newest first: number, state, priority, title, who owns and works on each, its category and its due day, and what waits on it. --open keeps the ones not done or dropped, --mine those assigned to you, --unassigned those assigned to nobody (not with --mine), --category and --goal those sorted into one, --due those due by a day: today, within the week, or overdue (the open ones past their day). The tasks put away (ADR-0029) are left out unless --archived asks for them alone. A page at a time: ${DEFAULT_PAGE_LIMIT} unless --limit says otherwise, from --offset on; a last line says when there is more. States: idea, ready, in_progress, in_review, done, dropped.`,
  },
  task: {
    usage: `task <number|id>  |  task new <title> [--body <markdown>|--file <path>] ${TASK_FIELD_FLAGS}  |  task edit <number|id> [--title <title>] [--body <markdown>|--file <path>] ${TASK_FIELD_FLAGS}  |  task archive <number|id>  |  task archive --goal <id>  |  task restore <number|id>`,
    overview:
      "task <number|id>  |  task new <title> [flags]  |  task edit <number|id> [flags]  |  task archive <number|id>|--goal <id>  |  task restore <number|id>",
    synopsis: "One task in full; or a task written, changed, put away or brought back.",
    about:
      "One task in full, with its plan (category, goal, start and due days), what happened to it (when it was started and done, which the board keeps itself, and when it was put away), the decisions about it, the runs on it and the discussion on it, each comment whole with its files; or a new task written down; or a task changed, only in what the flags say, where none clears a field (priorities: low, normal, high, urgent). archive puts a task away, whatever its state (ADR-0029, ADR-0030): out of the listings, the board and the calendar, open by its number still; with --goal, every done or dropped task of the goal at once, for an owner. restore brings one back.",
    limits: [
      `title: one line, up to ${MAX_TITLE_LENGTH} characters, saying what is to be done on its own; what it refers to goes in the body`,
      `body: ${MARKDOWN}`,
      ...TASK_FIELD_LIMITS,
    ],
    refusals: ["task.not_found: no task has that number or id", ...TASK_FIELD_REFUSALS],
  },
  goals: {
    usage: "goals [--category <key>] [--state <state>]",
    synopsis: "The roadmap: the project's goals, with their state, their days and how far each is.",
    about:
      "The roadmap of the project: its goals, the active first, each with its id, its state (planned, active, done, dropped), its category, the days it starts and is meant to be reached by, and how far it is, counted from the tasks that work towards it. --category keeps those sorted into one, --state those in one state.",
  },
  goal: {
    usage:
      'goal <id>  |  goal new "<title>" [--body <markdown>|--file <path>] [--state <state>] [--category <key>] [--starts <day>] [--due <day>]  |  goal edit <id> [--title <title>] [--body <markdown>|--file <path>] [--state <state>] [--category <key|none>] [--starts <day|none>] [--due <day|none>]',
    overview: "goal <id>  |  goal new <title> [flags]  |  goal edit <id> [flags]",
    synopsis:
      "One goal with the tasks that work towards it; or a goal set or changed, for an owner.",
    about:
      "One goal in full, with the tasks that work towards it; or a goal set on the roadmap, for an owner of the project; or one changed, only in what the flags say, where none clears a category or a day. A goal is planned in days as a task is, a start and a target, and sorted into a category of the workspace (console categories). A task works towards a goal through its --goal.",
    limits: [
      `title: one line, up to ${MAX_TITLE_LENGTH} characters`,
      `body: ${MARKDOWN}`,
      `starts, due: ${DAY}`,
    ],
    refusals: [
      "goal.not_found: no goal of this project has that id",
      "goal.invalid_category: no category of the workspace has that key",
      "goal.invalid_dates: the target day is before the start",
      "auth.forbidden: only an owner of the project sets its roadmap",
    ],
  },
  categories: {
    usage: "categories",
    synopsis: "The categories tasks are sorted into, by key.",
    about:
      "The categories tasks are sorted into, the same in every project: each with its key, which --category takes, its name and its colour. An administrator keeps them: console category, or the Categories page.",
  },
  people: {
    usage: "people",
    synopsis: "The people you see, by login, with what each is in the workspace.",
    about:
      "The people of the workspace you see, by login, with their name where the host gives one and what they are in it: admin, who configures the workspace, or member, who works in the projects they are in; a person taken out is marked deactivated. Everyone, unless the workspace shows a member only the people they share a project with (console workspace says which; an administrator sees everyone). Then, where you see everyone, the logins an administrator let in that nobody has signed in with yet. The logins are what --assignee, member and person take; a login is found exactly, so an owner lists someone the list does not show.",
  },
  workspace: {
    usage:
      "workspace  |  workspace edit [--people-visibility <everyone|shared-projects>] [--week-start <auto|monday|sunday>] [--time-zone <zone|none>]  |  workspace pack-token --connect  |  workspace pack-token --stdin  |  workspace pack-token --remove",
    overview:
      "workspace  |  workspace edit [flags]  |  workspace pack-token --connect|--stdin|--remove",
    synopsis:
      "The workspace's settings; or some changed, or its SkillCDN token set, for an administrator.",
    about:
      "What the workspace is called; who sees whom on the People page and in the pickers (everyone; or shared-projects: a member sees only the people they share a project with, an administrator everyone; a project open to the workspace has everyone in it, so a member of one sees everyone); the day the calendars begin a week on (auto: the system default, as each device has it); the workspace's time zone, an IANA name such as Asia/Seoul, in which this command prints moments as ISO 8601 with its offset, as the login kept it at login or whoami, or none, which leaves them as the API gives them, in UTC; where the organization's skills come from; and the most days a token may last. edit changes any of the first three, for an administrator; --json leaves moments as the API gives them. pack-token is the SkillCDN token the organization's pack is read with, by every project that names no address of its own and holds no token of its own (ADR-0036), for an administrator: with --connect, the console asks SkillCDN for a code, this command prints the page and the code, a person who may open the repository approves there, signed in at SkillCDN, and the console receives the token, shown to nobody; with --stdin, a token made by hand at SkillCDN is read from standard input and never an argument; --remove takes the token away.",
    refusals: [
      "auth.forbidden: only an administrator changes the workspace's settings or its token",
      "request.invalid: the time zone is not a name the console knows",
      "workspace.pack_token_refused: SkillCDN does not serve the organization's pack to the token, or the console names no address for the organization's skills",
      "workspace.pack_connect_refused: the console names no address for the organization's skills, the pack is on the console's machine, or SkillCDN refused to begin",
      "workspace.pack_token_unsupported, workspace.pack_connect_unsupported: the console keeps no secret to seal a token with (AUTH_SECRET), or reaches no deployment",
    ],
  },
  person: {
    usage:
      "person role <login> <admin|member>  |  person add <login> [--host gh|google]  |  person remove <login>  |  person deactivate <login>  |  person reactivate <login>",
    synopsis:
      "Says what a person is in the workspace, lets a login in or takes one out; for an administrator.",
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
      'project <key>  |  project new <key> "<name>" [--description <markdown>|--file <path>] [--visibility workspace|private] [--skills <address>|none] [--color <name>] [--symbol <text>]  |  project edit <key> [--name "<name>"] [the same flags; none clears]  |  project icon <key> <file>  |  project icon <key> --remove  |  project pack-token <key> --connect  |  project pack-token <key> --stdin  |  project pack-token <key> --remove',
    overview:
      "project <key>  |  project new <key> <name> [flags]  |  project edit <key> [flags]  |  project icon <key> <file>|--remove  |  project pack-token <key> --connect|--stdin|--remove",
    synopsis:
      "One project in full; or a project made, changed, given its mark or its SkillCDN token.",
    about:
      "One project in full; or a project made, with you as its owner, private unless --visibility workspace says everyone of the workspace works in it; or one changed, only in what the flags say, for an owner; or its image for its mark, set from a file of this machine or taken away; or its SkillCDN token (pack-token, ADR-0028), which the console keeps sealed to read a private pack with, and which a project that reads the organization's pack may leave to the workspace's (console workspace pack-token): with --connect, the console asks SkillCDN for a code, this command prints the page and the code, a person who may open the repository approves there, signed in at SkillCDN, and the console receives the token, shown to nobody (ADR-0036); with --stdin, a token a person made by hand at SkillCDN is read from standard input and never an argument; --remove takes the token away. The organization's skills are the project's unless --skills names an address of its own.",
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
      "project.pack_connect_unsupported: the console reaches no deployment, or keeps no secret to seal a token with",
      "project.pack_connect_refused: the project names no pack, the pack is on the console's machine, or SkillCDN refused to begin",
      "skills.unavailable: SkillCDN could not be reached; try again later",
    ],
  },
  members: {
    usage: "members",
    synopsis: "The members of the project, with what each is in it.",
    about:
      "The members of the project, by login, with what each is in it (owner, who configures it; member, who works on it) and since when. In a private project, those listed; in one open to the workspace, everyone of it, an owner where listed as one or an administrator, a member otherwise. An administrator owns every project.",
  },
  member: {
    usage:
      "member add <login> [--role owner|member] [--project <key>[,<key>...]]  |  member role <login> <owner|member>  |  member remove <login>",
    synopsis:
      "Lists a person in the project, changes what they are in it, or takes them off; for an owner.",
    about:
      "Lists a person of the workspace in the project, as a member unless --role says owner; changes what they are in it; or takes them off the list. For an owner of the project. In a project open to the workspace everyone is a member already: only an owner is listed (member add --role owner, or member role <login> owner), and an owner made a member again stays the member everyone is. With --project naming several keys with commas, member add lists the person in each of them in turn, one line per project; one listed already is said so, and the rest go on.",
    refusals: [
      "auth.forbidden: only an owner of the project lists its members",
      "member.invalid_person: the person is not of the workspace",
      "member.exists: the person is listed already; member role changes what they are",
      "member.open_project: the project is open to the workspace, so everyone is a member already; list an owner with --role owner",
      "member.not_found: the person is not listed in the project",
    ],
  },
  category: {
    usage:
      'category new <key> "<name>" [--color <name>]  |  category edit <key> [--name "<name>"] [--color <name>]  |  category remove <key>',
    synopsis: "Makes, changes or removes a category; for an administrator.",
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
    usage:
      "skills  |  skills <folder>  |  skills --search <words> [<folder>] [--limit <n>] [--cursor <cursor>]",
    synopsis:
      "The project's pack: its skills; what a folder of it holds; or what words find in it.",
    about:
      "The project's pack, read by the console at the project's address, or the organization's: at a SkillCDN deployment, with the pack token the project holds where the pack is private (ADR-0028), or from a directory on the console's machine for a local address (ADR-0031). Alone: where the pack is and what a client is told of it on connect, then every skill with the path of its SKILL.md and every document, as a connection of your own would list them, and where the console's own skills are on this machine. With a folder (. for the root): what it holds, whole, as browse_repo lays it out for a model: its skills, its folders with what each holds and the README that introduces it, its files. With --search: what the words find, as search_repo does: skills first, with the files of theirs that matched, then documents, in relevance order; words, not meaning, in the language the pack is written in; within the folder when one is named; 10 unless --limit says otherwise, up to 25, and a nextCursor line says when more matched, which --cursor continues. The text is the one an MCP client's model is given, with the reads named as these commands. --json answers with the console's own JSON: what the pack answered, in the shapes of the main repository's REST API, the pages of a folder joined.",
    limits: ["search: 1 to 500 characters; limit: 1 to 25"],
    refusals: [
      "status not_found: the pack is not served to the console; private, with no pack token on the project",
      "status token_invalid: the pack token the project holds no longer works; an owner sets a new one",
    ],
  },
  skill: {
    usage: "skill <path>  |  skill --file <path>",
    synopsis:
      "One skill of the pack whole, its rules first; or with --file a file of the pack, or what a folder holds.",
    about:
      "One skill of the project's pack, whole, as load_skill lays it out for a model: the rules of the repository from its root to the nearest manifest, the skill's instructions, the files it includes, then its supporting files and what it refers to; the pages it came in are joined. Read by the console from the pack, with the pack token the project holds where the pack is private, so you need no connection of your own. <path> is the path of the SKILL.md from the repository's root, as console skills lists it, or the URI the pack names it by (skill://<host>/<owner>/<name>/<path>). --file <path> reads a file of the pack instead, whole, as read_repo_file does, or what a folder holds, and takes no skill's path beside it; console skills <folder> shows a folder with more. --json answers with what the pack answered, in the shapes of the main repository's REST API, the pages joined.",
    refusals: [
      "status not_found: the pack is not served to the console; private, with no pack token on the project",
      "status token_invalid: the pack token the project holds no longer works; an owner sets a new one",
      "status failed, for a file: the pack will not carry it, too large or not text",
    ],
  },
  rules: {
    usage:
      "rules  |  rules write --body <markdown>|--file <path>|-|none [--workspace] [--base <version>]",
    synopsis:
      "What this organization and this project ask of agents; rules write writes them, for an owner or an administrator.",
    about:
      "What this organization asks of agents (ADR-0023): the workspace's rules, the console's own until an administrator writes the organization's, and this project's own when it has them. rules write writes this project's rules, for an owner, or with --workspace the workspace's, for an administrator; none puts the written rules away, so that the console's own hold again, or the project adds none. Without a project named, rules shows the workspace's alone.",
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
    synopsis: "Takes a task: a run begins, and the task is in progress and the person's.",
    about:
      "Takes a task: a run begins, and the task is in progress and the person's; the run's id and the task's id are printed on a line of their own, then the task, then the rules of the board. A run still open on the task is taken over, since the board cannot know whether its agent still runs: it ends as abandoned, the feed says who took over, and that agent is refused on its next command; console task <number> shows the runs on a task, with when each was last heard from, before it is taken. --agent is what people see at work; left out, it is what the person called the token.",
    limits: [`agent: one line, up to ${MAX_AGENT_LENGTH} characters`],
    refusals: [
      "task.not_found: no task has that number or id",
      "run.task_closed: the task is done or dropped",
    ],
  },
  report: {
    usage:
      "report <markdown> [--run <id>]  |  report --file <path> [--run <id>]  |  report - [--run <id>]",
    overview: "report <markdown>  |  report --file <path>  |  report -",
    synopsis: "Says how the work goes, in Markdown, on the open run.",
    about: `Says how the work goes, in Markdown: what was found, what was done, what is next. With - the report is read from standard input. ${ON_THE_RUN}`,
    limits: [
      `the report: ${MARKDOWN}, not blank`,
      `at most ${MAX_REPORTS_PER_RUN} reports on one run`,
    ],
    refusals: [...RUN_REFUSALS, "run.too_many_reports: the run carries as many as one may"],
  },
  "hand-in": {
    usage: "hand-in <https url | file path> [--label <words>] [--run <id>]",
    overview: "hand-in <https url | file path> [--label <words>]",
    synopsis: "Hands in what was made: an https link, or a file from this machine.",
    about: `Hands in what was made: a link (a branch, a pull request, a document, a page), or a file from this machine, which the console keeps and shows on the task; a picture is shown there small and large, and a report that names it as ![words](its name) shows it where the words are. ${ON_THE_RUN}`,
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
      'ask "<question>" --option "<label>" --option "<label>" [...] [--body <markdown>|--file <path>] [--wait <seconds>] [--run <id>]',
    overview:
      'ask "<question>" --option "<label>" --option "<label>" [...] [--body <markdown>|--file <path>] [--wait <seconds>]',
    synopsis:
      "Raises a decision a person must make, with options, and waits a while for the answer.",
    about: `Raises a decision a person must make: the question, the options to choose from, and what they need to know. The run waits for the answer. The command waits 60 seconds for it unless --wait says otherwise, and exits with 3 if it is still to come: keep waiting with \`console decision <id> --wait 100\`, within what your shell gives one command. The decision's id is printed as soon as it is raised. The person chooses one of the options, or answers in their own words: the answer then names one more option, their words, marked own; act on it as given. ${ON_THE_RUN}`,
    limits: [
      `question: one line, up to ${MAX_QUESTION_LENGTH} characters`,
      `options: ${MIN_OPTIONS} to ${MAX_OPTIONS}, each one line up to ${MAX_OPTION_LABEL_LENGTH} characters`,
      `body: ${MARKDOWN}`,
    ],
    refusals: [...RUN_CHOICE, "decision.invalid_run: the run is not yours, or is over"],
  },
  decision: {
    usage: "decision <id> [--wait <seconds>]  |  decision <id> --outcome <markdown>|--file <path>",
    synopsis:
      "One decision in full; waits for its answer with --wait; writes what followed with --outcome.",
    about:
      "One decision, with its context, its options, its answer (one of the options, or the person's own words as one more, marked own) and what followed. With --wait, holds on for the answer that long, and exits with 3 if it is still to come. With --outcome, writes down what followed the decision, so that it reads as a record.",
    limits: [`outcome: ${MARKDOWN}`],
    refusals: ["decision.not_found: no decision has that id"],
  },
  decisions: {
    usage: "decisions [--open] [--limit <n>] [--offset <n>]",
    synopsis: "The decisions on the board, the waiting first.",
    about: `The decisions on the board, the waiting first; --open keeps only those. A page at a time: ${DEFAULT_PAGE_LIMIT} unless --limit says otherwise, from --offset on.`,
  },
  finish: {
    usage: 'finish [--summary "<markdown>"|--file <path>] [--run <id>]',
    overview: 'finish [--summary "<markdown>"|--file <path>]',
    synopsis: "Ends the run: done and handed in; the task goes up for review.",
    about: `Ends the run: the work is done and handed in, and the task goes up for review. The summary says what was done and what is left; the result itself goes in a last report before, which may be much longer. ${ON_THE_RUN}`,
    limits: [`summary: ${`Markdown, up to ${MAX_SUMMARY_LENGTH} characters`}`],
    refusals: RUN_REFUSALS,
  },
  fail: {
    usage: 'fail [--summary "<markdown>"|--file <path>] [--run <id>]',
    overview: 'fail [--summary "<markdown>"|--file <path>]',
    synopsis: "Ends the run: the work could not be done.",
    about: `Ends the run: the work could not be done. The summary says why, and what is left. ${ON_THE_RUN}`,
    limits: [`summary: Markdown, up to ${MAX_SUMMARY_LENGTH} characters`],
    refusals: RUN_REFUSALS,
  },
  abandon: {
    usage: 'abandon [<run id>] [--summary "<markdown>"]',
    synopsis: "Leaves a run; the task stays as it is.",
    about:
      "Leaves a run; the task stays as it is. A person gives up this way on a run of theirs that will not come back.",
    limits: [`summary: Markdown, up to ${MAX_SUMMARY_LENGTH} characters`],
    refusals: RUN_REFUSALS,
  },
  runs: {
    usage: "runs [--task <number|id>] [--open] [--mine] [--limit <n>] [--offset <n>]",
    synopsis: "The runs, newest first, each with when its agent was last heard from.",
    about: `The runs, newest first, each with when its agent was last heard from: --open keeps the ones not over, --mine those begun with this token. A page at a time: ${DEFAULT_PAGE_LIMIT} unless --limit says otherwise, from --offset on.`,
  },
  run: {
    usage: "run <id>",
    synopsis: "One run in full: its reports, what it handed in, how it ended.",
    about: "One run in full: its reports, what it handed in, what it waits for, how it ended.",
    refusals: ["run.not_found: no run has that id"],
  },
  comment: {
    usage:
      'comment <number|id> "<markdown>" [--attach <path>]...  |  comment <number|id> --file <path>  |  comment <number|id> -',
    synopsis: "Says something in the discussion on a task, with files; needs no run.",
    about:
      "Says something in the discussion on a task, for its people: an answer to what they asked there, a question that is not a decision, a remark; with files from this machine put in it, which the console keeps and shows on the task, pictures in place. Needs no run. A report is the run's record; a comment is a word to people. Never rewritten: a mistake is corrected in the next one.",
    limits: [
      `the comment: ${MARKDOWN}; blank only when a file comes with it`,
      `a file: up to ${MAX_FILE_BYTES} bytes, not empty; called by its name, without the path; a picture is placed in the text as ![words](its name)`,
      `at most ${MAX_FILES_PER_COMMENT} files on one comment, together up to ${MAX_FILE_BYTES} bytes`,
      `at most ${MAX_COMMENTS_PER_TASK} comments on one task`,
    ],
    refusals: [
      "task.not_found: no task has that number or id",
      "comment.too_many: the task carries as many comments as one may",
      "comment.too_many_files: more files than one comment may carry",
      "request.too_large: the files are over the limit together",
    ],
  },
  file: {
    usage: "file <id> [--out <path>]",
    synopsis: "Reads a file of the project to this machine, by its id.",
    about:
      "Reads a file of the project from the console and writes it on this machine: one a run handed in, one put in a comment, or one attached to a page, by the id the task, the run or the page shows. Written under its own name in the working directory, at --out <path>, or into --out <directory>. Then look at it with your own tools.",
    refusals: ["file.not_found: no file of this project has that id"],
  },
  docs: {
    usage: "docs [<folder>] [--search <words>] [--archived]",
    synopsis: "The pages of the project's documents: a folder, or those found by words.",
    about:
      "The pages of the project's documents: those in a folder, with the folders in it (the root when none is named), or those found by words in their title or body. Archived pages are left out unless --archived.",
  },
  doc: {
    usage: "doc <path> [--version <n>|--versions]",
    synopsis: "One page in full, or one of its versions.",
    about:
      "One page in full: its title, its body in Markdown, what it links to, what refers to it (pages, tasks, decisions), and its files. --versions lists its versions, who wrote each and when; --version <n> prints one as it was.",
    refusals: [...DOCUMENT_REFUSALS, "document.version_not_found: the page has no such version"],
  },
  write: {
    usage: 'write <path> [--title "<title>"] --body <markdown>|--file <path> [--base <version>]',
    synopsis: "Writes a page: a new one at a path, or a new version of the page there.",
    about:
      "Writes a page: the first version at a new path, or a new version of the page there. The title is shown above the body, on the page and by console doc, so the body does not begin with it as a heading. A link in the body whose destination is a page's path (guides/onboarding) refers to that page, and the page says what refers to it. Without --title the page keeps its title. With --base, the write is refused if the page has moved on since that version.",
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
    synopsis: "Attaches a file from this machine to a page.",
    about:
      "Attaches a file from this machine to a page: the console keeps it, and the page lists it; a picture is shown where the body names it as ![words](its name).",
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
    synopsis: "Puts a page away; nothing is deleted.",
    about:
      "Puts a page away: out of the folders and the search, still readable at its path, not written to until restored. Nothing is deleted.",
    refusals: DOCUMENT_REFUSALS,
  },
  restore: {
    usage: "restore <path>",
    synopsis: "Brings an archived page back.",
    about: "Brings an archived page back.",
    refusals: DOCUMENT_REFUSALS,
  },
  serve: {
    usage: "serve [<dir>] [--port <n>]",
    synopsis:
      "For a person: serves a console of your own from this machine, its /api/ carried to the console with your token.",
    about:
      "For a person: serves a console of your own from this machine, for you. The build in <dir> (its index.html and files) is served at http://127.0.0.1:11197/, and everything under /api/ is carried to the console you are signed in to with your token, which the pages never see. Without a directory only the API is served there, for a development server to send its /api/ requests to. The loopback only; a request from another site's page is refused. Stop it with Ctrl+C.",
    refusals: ["not a build to serve: the directory holds no index.html"],
  },
};

/**
 * Where the skill working-the-board is, among the console's own skills in `skillsDir`, with the
 * separators the directory came with, so that the path reads as the machine writes paths.
 */
export function ownSkillPath(skillsDir: string): string {
  const separator = skillsDir.includes("\\") ? "\\" : "/";
  const base =
    skillsDir.endsWith("/") || skillsDir.endsWith("\\") ? skillsDir : `${skillsDir}${separator}`;
  return `${base}working-the-board${separator}SKILL.md`;
}

/** The first lines of the usage, with the version of the command and where its skill is, when known. */
const preamble = (version: string | undefined, skillsDir: string | undefined): string =>
  `console${version === undefined ? "" : ` ${version}`}: the board of your organization's work with AI agents, from the command line.
You act as the person whose token you hold; everything you send is shown to people as text.
The rules of this organization come with the task: console take prints them; console rules reads them any time.
How the board is worked is the skill working-the-board, installed with this command; read it before the
first command of a run${skillsDir === undefined ? " (console whoami says where it is)" : `:\n${ownSkillPath(skillsDir)}`}

Usage: console <command> [arguments] [--json] [--url <origin>] [--project <key>]
A command in full, every form and flag ([flags] below), the limits the console holds it to and what
it may refuse: console help <command>. Read a command there when you are about to use it.
`;

const CLOSING = `Options everywhere: --json answers with the console's own JSON; --url names another console;
--project names the project to work in, over CONSOLE_PROJECT and over what console use kept here.
A listing (tasks, decisions, runs) is a page at a time: --limit <n> and --offset <n>, and a last line
says when there is more, so that nothing is read that is not needed.
Commands on a run (report, hand-in, ask, finish, fail) act on your one open run in the project;
with several open, say which with --run <id>. A Markdown body given as - is read from standard input.
console --version says which version of the command this is.

Exit codes: 0 done; 1 the console refused, or could not be reached (the reason is on stderr);
2 the command was not understood; 3 the decision still waits for a person; 4 the command and the
console do not go together, and stderr says which to update and how.
What the console refuses is printed as its code and its words. Everywhere:
${COMMON_REFUSALS.map((refusal) => `  ${refusal}`).join("\n")}

Which console a command talks to: --url, else CONSOLE_URL in the environment, else the console
.skillcdn-console.json binds this directory to, else the default login. The token is then the one
kept for that console alone (CONSOLE_TOKEN only together with CONSOLE_URL, for a hook or a job), in
$XDG_CONFIG_HOME/skillcdn-console/credentials.json (~/.config when XDG_CONFIG_HOME is unset);
a console nobody is signed in to here gets no request. --account <login> says which account where
a console has several. console logins lists them.
`;

const SECTIONS: readonly { readonly title: string; readonly commands: readonly string[] }[] = [
  {
    title: "Signing in, once, as a person, and the project to work in",
    commands: ["login", "logins", "logout", "whoami", "projects", "use"],
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
      "skill",
      "rules",
    ],
  },
  {
    title: "Working",
    commands: ["take", "report", "hand-in", "comment", "file", "ask", "finish", "fail", "abandon"],
  },
  {
    title: "The documents: the project's pages of Markdown, in folders, by path",
    commands: ["docs", "doc", "write", "attach", "archive", "restore"],
  },
  {
    title:
      "Configuring, as the person: what an administrator or an owner does on the pages, their agent does here, named on it",
    commands: ["workspace", "people", "person", "project", "members", "member", "category"],
  },
];

/** The overview, as `console help` prints it: every command in a line, naming the version when it is known. */
export function usage(version?: string, skillsDir?: string): string {
  const parts = [preamble(version, skillsDir)];
  for (const section of SECTIONS) {
    parts.push(`${section.title}`);
    for (const name of section.commands) {
      const help = COMMAND_HELP[name];
      if (help !== undefined) {
        parts.push(`  console ${help.overview ?? help.usage}\n      ${help.synopsis}`);
      }
    }
    parts.push("");
  }
  parts.push(CLOSING);
  return parts.join("\n");
}

/** What `console help <command>` prints, the command in full; or nothing for a command that is not one. */
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
