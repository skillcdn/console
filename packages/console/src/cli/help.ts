import {
  MAX_AGENT_LENGTH,
  MAX_ARTIFACTS_PER_RUN,
  MAX_BODY_LENGTH,
  MAX_FILE_BYTES,
  MAX_LINK_LABEL_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_REPORTS_PER_RUN,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_OPTIONS,
} from "../limits.js";

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

export const COMMAND_HELP: Readonly<Record<string, CommandHelp>> = {
  login: {
    usage: "login --url <origin> [--token-stdin]",
    about:
      "A person signs the command in: it asks for a token made on the console's Tokens page and keeps it, with the console's address, in your home directory. --token-stdin reads the token from standard input instead.",
    refusals: ["the console does not know the token: make one on the Tokens page and try again"],
  },
  logout: {
    usage: "logout",
    about:
      "Forgets the address and the token kept here. The token itself is removed on the Tokens page.",
  },
  whoami: {
    usage: "whoami",
    about: "Who the token acts as, and which console it is for.",
  },
  tasks: {
    usage: "tasks [--state <state>]",
    about:
      "The tasks on the board, newest first: number, state, priority, title, who owns and works on each, and what waits on it. States: idea, ready, in_progress, in_review, done, dropped.",
  },
  task: {
    usage:
      "task <number|id>  |  task new <title> [--body <markdown>|--file <path>] [--state <state>] [--priority <priority>]",
    about:
      "One task in full, with the decisions about it and the runs on it; or a new task written down (priorities: low, normal, high, urgent).",
    limits: [`title: one line, up to ${MAX_TITLE_LENGTH} characters`, `body: ${MARKDOWN}`],
    refusals: ["task.not_found: no task has that number or id"],
  },
  take: {
    usage: "take <number|id> [--agent <name>]",
    about:
      "Takes a task: a run begins, and the task is in progress and the person's. One agent at a time per task. --agent is what people see at work; left out, it is what the person called the token.",
    limits: [`agent: one line, up to ${MAX_AGENT_LENGTH} characters`],
    refusals: [
      "task.not_found: no task has that number or id",
      "run.task_taken: a run is open on the task already; console runs --open --mine shows whether it is yours",
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
    usage: "decision <id> [--wait <seconds>]",
    about:
      "One decision, with its options and its answer. With --wait, holds on for the answer that long, and exits with 3 if it is still to come.",
    refusals: ["decision.not_found: no decision has that id"],
  },
  decisions: {
    usage: "decisions [--open]",
    about: "The decisions on the board, the waiting first; --open keeps only those.",
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
    usage: "runs [--task <number|id>] [--open] [--mine]",
    about:
      "The runs, newest first: agents at work and what they did. --mine keeps those begun with this token.",
  },
  run: {
    usage: "run <id>",
    about: "One run in full: its reports, what it handed in, what it waits for, how it ended.",
    refusals: ["run.not_found: no run has that id"],
  },
};

const PREAMBLE = `console: the board of your organization's work with AI agents, from the command line.
You act as the person whose token you hold; everything you send is shown to people as text.

Usage: console <command> [arguments] [--json] [--url <origin>]
`;

const CLOSING = `Options everywhere: --json answers with the console's own JSON; --url names another console.
Commands on a run (report, hand-in, ask, finish, fail) act on your one open run; with several open,
say which with --run <id>. A Markdown body given as - is read from standard input.
console help <command> says what each command takes, the limits the console holds it to, and
what it may refuse.

Exit codes: 0 done; 1 the console refused, or could not be reached (the reason is on stderr);
2 the command was not understood; 3 the decision still waits for a person.
What the console refuses is printed as its code and its words. Everywhere:
${COMMON_REFUSALS.map((refusal) => `  ${refusal}`).join("\n")}

Credentials: CONSOLE_URL and CONSOLE_TOKEN in the environment, else what login kept in
$XDG_CONFIG_HOME/skillcdn-console/credentials.json (~/.config when XDG_CONFIG_HOME is unset).
`;

const SECTIONS: readonly { readonly title: string; readonly commands: readonly string[] }[] = [
  { title: "Signing in, once, as a person", commands: ["login", "logout", "whoami"] },
  { title: "The board", commands: ["tasks", "task", "decisions", "decision", "runs", "run"] },
  { title: "Working", commands: ["take", "report", "hand-in", "ask", "finish", "fail", "abandon"] },
];

/** The whole usage, as `console help` prints it. */
export function usage(): string {
  const parts = [PREAMBLE];
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
