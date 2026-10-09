# Spec: the command line

- Status: **Draft.** Version 1 is what an agent works the board with (Claude Code, Codex, any agent with a shell), and what a person's own scripts and hooks use.
- The command is `console`, the `bin` of `@skillcdn/console` (`packages/console/src/cli/`): a thin client of the [REST API](rest.md) with no logic of its own ([ADR-0006](../adr/0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)). `@skillcdn/console/cli` exports `runCli(argv, io)`, the command as a function; the integration tests run it against the app with no socket.

## Signing in

A person installs the package where the agent runs and signs the command in once: `console login --url <origin>` asks for a token made on the console's Tokens page (or reads it from standard input with `--token-stdin`), checks it against the console (`GET /api/v1/me` must know the person), and keeps it with the address in `$XDG_CONFIG_HOME/skillcdn-console/credentials.json` (`~/.config/skillcdn-console/credentials.json` when `XDG_CONFIG_HOME` is unset), readable by the person alone where the system can say so. `CONSOLE_URL` and `CONSOLE_TOKEN` in the environment win over the file, for a hook or a job; `--url <origin>` names another console for one command. `logout` forgets the file; the token itself is removed on the Tokens page. A token is never taken on the command line, and never printed.

From then on the agent is that person on the board ([ADR-0004](../adr/0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md)): what it does is attributed to the person and shown as done by the agent, called what the person called the token unless `take --agent` says otherwise.

## The commands

| Command | Asks the console | Says |
|---|---|---|
| `login --url <origin> [--token-stdin]` | `GET /api/v1/me`, with the token | who the token is; keeps the credentials |
| `logout` | nothing | that they are forgotten |
| `whoami` | `GET /api/v1/me` | the login, the role, the workspace, the address |
| `tasks [--state <state>]` | `GET /api/v1/tasks` | one line per task: number, state, priority, title, owner, assignee, what waits on it |
| `task <number\|id>` | `GET /api/v1/tasks/<ref>`, the decisions about it, the runs on it | the task in full |
| `task new <title> [--body <markdown>\|--file <path>] [--state <state>] [--priority <priority>]` | `POST /api/v1/tasks` | the number and the id |
| `skills` | `GET /api/v1/skills` | the organization's skills: each with its description and the URI an agent loads it by through its own SkillCDN connection; or why there are none to show |
| `take <number\|id> [--agent <name>]` | `GET /api/v1/tasks/<ref>`, then `POST /api/v1/runs` | the run that began, the task in full, and what to do next |
| `report <markdown>`, `report --file <path>`, `report -` | `POST /api/v1/runs/<id>/reports` | how many reports the run carries |
| `hand-in <https url \| file path> [--label <words>]` | `POST /api/v1/runs/<id>/artifacts` for a link; `POST /api/v1/runs/<id>/files` for a file, sent as a form with its name and its media type by extension | how many artifacts |
| `ask "<question>" --option "<label>" ... [--body <markdown>\|--file <path>] [--wait <seconds>]` | `POST /api/v1/decisions` with `runId`, then `GET /api/v1/decisions/<id>?wait=` | the decision raised, its options; then the answer, or that it still waits |
| `decision <id> [--wait <seconds>]` | `GET /api/v1/decisions/<id>`, with `?wait=` while waiting | the decision; with a wait, the answer or that it still waits |
| `decisions [--open]` | `GET /api/v1/decisions` | one line per decision |
| `finish [--summary <markdown>\|--file <path>]`, `fail [...]` | `POST /api/v1/runs/<id>/end` | how the run ended |
| `abandon [<run id>] [--summary <markdown>]` | `POST /api/v1/runs/<id>/end`, as `abandoned` | the same |
| `runs [--task <number\|id>] [--open] [--mine]` | `GET /api/v1/runs` | one line per run |
| `run <id>` | `GET /api/v1/runs/<id>` | the run in full, with its reports and what it handed in |
| `help [<command>]` | nothing | the usage, written for an agent that meets the command for the first time |

Everywhere: `--json` prints the console's own answer as JSON, in the shapes of `@skillcdn/console/api`; `--url <origin>` names another console for this one command. A Markdown body given as `-` is read from standard input. Every argument is bounded and checked by the console, as the REST API's schemas say; the command sends it as it was given.

## The run a command means

`report`, `hand-in`, `ask`, `finish` and `fail` act on a run. Named with `--run <id>`, that one; else the one open run begun with this token (`GET /api/v1/runs?open=true&mine=true`). None open, or several: the command exits with `1` and says so, listing the open ones, so that an agent working two tasks at once says which.

## Waiting for a decision

`ask` waits 60 seconds for the answer unless `--wait` says otherwise, within what an agent's shell gives one command; `decision <id> --wait <seconds>` waits as long as it is told, a day at most. The command asks the console to hold each request for up to 50 seconds (`?wait=`), the server's own bound, and repeats while the time lasts, with a breath between requests; the answer arrives as soon as a person gives it, since the console is woken through the database's own channel. A decision that still waits when the time is up is exit code `3`: the run waits with it, so the agent keeps waiting with `console decision <id> --wait 100`, within what its shell gives one command, and goes on meanwhile only with work that does not depend on the answer. `ask` prints the decision's id as soon as it is raised, before any waiting, so that a wait cut short loses nothing; with `--json` it prints the decision then, and again with its answer when that comes.

## Output and exit codes

Plain text on standard output: one line per thing in a list, a few lines for one thing in full, with ids given, since the commands take them, and the vocabulary's own words (`in_progress`, `waiting`), since the options take them. What went wrong goes to standard error as the console's stable code and its words (`run.task_taken: an agent is at work on the task already`), with a hint when there is something to do about it.

| Exit code | Meaning |
|---|---|
| `0` | Done. |
| `1` | The console refused, or could not be reached; the reason is on standard error. |
| `2` | The command was not understood. |
| `3` | The decision still waits for a person. |

## What an agent is told

`console help` says what the board is, that the agent acts as the person whose token it holds and that everything it sends is shown to people as text, what each command does (take a task, report at the milestones of the work, hand in what was made, ask when a person must decide, finish when done), and the refusals any command may meet. `console help <command>` adds what the command takes, the limits the console holds it to (how long a report, a summary, a question or an option may be; how many options, reports and links) and the refusals it may meet, by code, so that an agent learns them before it runs into them. An organization's own skill for working with its console says the rest: which tasks to take, what to report, when to ask ([roadmap](../roadmap.md)).

## Running an agent on a task

What a person does, once the command is signed in where the agent runs; tried with Claude Code on 2026-10-09, with an agent that took a task, reported at each milestone, raised a decision, acted on the answer, handed in and finished, and a person who answered on the board.

1. Write the task on the board, with its body as the work order: what to make, where, the milestones, what to ask.
2. Start the agent in the directory it is to work in, and tell it, in its own words, what this amounts to: run `console help`; take the task with `console take <number>` and follow its body; report at the milestones with `console report`; ask with `console ask` when a person must decide, and keep waiting with `console decision <id> --wait 100` until the answer comes; hand in with `console hand-in`; finish with `console finish --summary`. Say that the command is signed in already and that it must never look for or print a token.
3. Follow the run on the board, and answer the decisions it raises. The agent's reports, what it handed in and its summary are the run's record on the task's page.

## Not yet

Hooks that report an agent's events without being asked ([roadmap](../roadmap.md)).
