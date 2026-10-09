// What the command says about itself: for an agent that meets it for the first time, and for a
// person. One table for every command, from which the usage and each command's help are made.

export interface CommandHelp {
  /** The command and its arguments, after `console`. */
  readonly usage: string;
  /** What it does, in a sentence. */
  readonly about: string;
}

export const COMMAND_HELP: Readonly<Record<string, CommandHelp>> = {
  login: {
    usage: "login --url <origin> [--token-stdin]",
    about:
      "A person signs the command in: it asks for a token made on the console's Tokens page and keeps it, with the console's address, in your home directory. --token-stdin reads the token from standard input instead.",
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
  },
  take: {
    usage: "take <number|id> [--agent <name>]",
    about:
      "Takes a task: a run begins, and the task is in progress and the person's. One agent at a time per task. --agent is what people see at work; left out, it is what the person called the token.",
  },
  report: {
    usage: "report <markdown>  |  report --file <path>  |  report -",
    about:
      "Says how the work goes, in Markdown: what was found, what was done, what is next. A milestone at a time, not every step. With - the report is read from standard input.",
  },
  "hand-in": {
    usage: "hand-in <https url> [--label <words>]",
    about: "Hands in what was made, as a link: a branch, a pull request, a document, a page.",
  },
  ask: {
    usage:
      'ask "<question>" --option "<label>" --option "<label>" [...] [--body <markdown>|--file <path>] [--wait <seconds>]',
    about:
      "Raises a decision a person must make before the work goes on: the question, the options to choose from, and what they need to know. The run waits; the command waits 60 seconds for the answer unless --wait says otherwise, and exits with 3 if it is still to come.",
  },
  decision: {
    usage: "decision <id> [--wait <seconds>]",
    about:
      "One decision, with its options and its answer. With --wait, holds on for the answer that long, and exits with 3 if it is still to come.",
  },
  decisions: {
    usage: "decisions [--open]",
    about: "The decisions on the board, the waiting first; --open keeps only those.",
  },
  finish: {
    usage: 'finish [--summary "<markdown>"|--file <path>]',
    about:
      "Ends the run: the work is done and handed in, and the task goes up for review. The summary says what was done and what is left.",
  },
  fail: {
    usage: 'fail [--summary "<markdown>"|--file <path>]',
    about: "Ends the run: the work could not be done. The summary says why, and what is left.",
  },
  abandon: {
    usage: 'abandon [<run id>] [--summary "<markdown>"]',
    about:
      "Leaves a run; the task stays as it is. A person gives up this way on a run of theirs that will not come back.",
  },
  runs: {
    usage: "runs [--task <number|id>] [--open] [--mine]",
    about:
      "The runs, newest first: agents at work and what they did. --mine keeps those begun with this token.",
  },
  run: {
    usage: "run <id>",
    about: "One run in full: its reports, what it handed in, what it waits for, how it ended.",
  },
};

const PREAMBLE = `console: the board of your organization's work with AI agents, from the command line.
You act as the person whose token you hold; everything you send is shown to people as text.

Usage: console <command> [arguments] [--json] [--url <origin>]
`;

const CLOSING = `Options everywhere: --json answers with the console's own JSON; --url names another console.
Commands on a run (report, hand-in, ask, finish, fail) act on your one open run; with several open,
say which with --run <id>. A Markdown body given as - is read from standard input.

Exit codes: 0 done; 1 the console refused, or could not be reached (the reason is on stderr);
2 the command was not understood; 3 the decision still waits for a person.

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
  return help === undefined ? undefined : `console ${help.usage}\n\n${help.about}\n`;
}
