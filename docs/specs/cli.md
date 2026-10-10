# Spec: the command line

- Status: **Draft.** Version 1 is what an agent works the board with (Claude Code, Codex, any agent with a shell), what a person's own scripts and hooks use, and what serves a console of a person's own ([ADR-0014](../adr/0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md)).
- The command is `console`, the `bin` of `@skillcdn/console` (`packages/console/src/cli/`): a thin client of the [REST API](rest.md) with no logic of its own ([ADR-0006](../adr/0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)). `@skillcdn/console/cli` exports `runCli(argv, io)`, the command as a function; the integration tests run it against the app with no socket.

## Signing in

A person installs the package where the agent runs, or has the agent install it, and the command connects once ([ADR-0011](../adr/0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md)): `console login --url <origin>` asks the console to connect, prints the address of the console's own page and a code of eight characters, and waits; the person opens the address signed in, checks that the page shows the same code, names the agent and approves; and the command receives a token of its own, which it never prints. An agent that can run commands does this itself and relays the address and the code to its person; `--agent <name>` says what it calls itself, shown to the person with the machine's name. A token made by hand on the Agents page is read from standard input with `--token-stdin` instead, for a script or a job, and checked against the console (`GET /api/v1/me` must know the person). Either way the command keeps the token with the address in `$XDG_CONFIG_HOME/skillcdn-console/credentials.json` (`~/.config/skillcdn-console/credentials.json` when `XDG_CONFIG_HOME` is unset), readable by the person alone where the system can say so. `CONSOLE_URL` and `CONSOLE_TOKEN` in the environment win over the file, for a hook or a job; `--url <origin>` names another console for one command. `logout` forgets the file; the token itself is removed on the Agents page, by its person or by an administrator. A token is never taken on the command line, never typed, and never printed.

From then on the agent is that person on the board ([ADR-0004](../adr/0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md)): what it does is attributed to the person and shown as done by the agent, called what the person called the token unless `take --agent` says otherwise.

## The project

The board is a project's ([ADR-0008](../adr/0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md)), and every command on it works in one: the one `--project <key>` names, else `CONSOLE_PROJECT` in the environment, else the one `.skillcdn-console.json` names in the working directory or the nearest directory above it. `console use <key>` writes that file, after checking that the console knows the project to the person; it is meant to be committed, so that everyone who works in the checkout, and every agent they run in it, is in the same project without saying so. With none of the three, a command on the board says so and exits with `1`. `console projects` lists the projects the person may work in, with what they are in each; a project the person may not see is not found, as if it were not there.

## The commands

| Command | Asks the console | Says |
|---|---|---|
| `login --url <origin> [--agent <name>] [--token-stdin]` | `POST /api/v1/connect`, then `POST /api/v1/connect/claim` until a person approved, then `GET /api/v1/me` with the token | the address and the code for a person; then who the token is; keeps the credentials |
| `logout` | nothing | that they are forgotten |
| `whoami` | `GET /api/v1/me` | the login, the role, the workspace, the address, and the project this directory works in |
| `projects` | `GET /api/v1/projects` | one line per project: key, name, what the person is in it, what waits in it |
| `use <key>` | `GET /api/v1/projects/<key>` | that the directory works in the project from now on; writes `.skillcdn-console.json` |
| `tasks [--state <state>]` | `GET .../tasks` | one line per task: number, state, priority, title, owner, assignee, what waits on it |
| `task <number\|id>` | `GET .../tasks/<ref>`, the decisions about it, the runs on it | the task in full |
| `task new <title> [--body <markdown>\|--file <path>] [--state <state>] [--priority <priority>]` | `POST .../tasks` | the number and the id |
| `skills` | `GET .../skills` | the project's skills, or the organization's: each with its description and the URI an agent loads it by through its own SkillCDN connection; or why there are none to show |
| `take <number\|id> [--agent <name>]` | `GET .../tasks/<ref>`, then `POST .../runs` | the run that began, the task in full, and what to do next |
| `report <markdown>`, `report --file <path>`, `report -` | `POST .../runs/<id>/reports` | how many reports the run carries |
| `hand-in <https url \| file path> [--label <words>]` | `POST .../runs/<id>/artifacts` for a link; `POST .../runs/<id>/files` for a file, sent as a form with its name and its media type by extension | how many artifacts |
| `ask "<question>" --option "<label>" ... [--body <markdown>\|--file <path>] [--wait <seconds>]` | `POST .../decisions` with `runId`, then `GET .../decisions/<id>?wait=` | the decision raised, its options; then the answer, or that it still waits |
| `decision <id> [--wait <seconds>]` | `GET .../decisions/<id>`, with `?wait=` while waiting | the decision; with a wait, the answer or that it still waits |
| `decisions [--open]` | `GET .../decisions` | one line per decision |
| `finish [--summary <markdown>\|--file <path>]`, `fail [...]` | `POST .../runs/<id>/end` | how the run ended |
| `abandon [<run id>] [--summary <markdown>]` | `POST .../runs/<id>/end`, as `abandoned` | the same |
| `runs [--task <number\|id>] [--open] [--mine]` | `GET .../runs` | one line per run |
| `run <id>` | `GET .../runs/<id>` | the run in full, with its reports, what it handed in and where each file is read |
| `decision <id> --outcome <markdown>\|--file <path>` | `PATCH .../decisions/<id>` | the decision as a record, with what followed written down |
| `docs [<folder>] [--search <words>] [--archived]` | `GET .../docs?folder=` or `?q=` | the folders and the pages of a folder, or the pages found by words: one line per page |
| `doc <path> [--version <n>\|--versions]` | `GET .../docs/<path>`, `.../versions`, `.../versions/<n>` | the page in full: its body, what it refers to, what refers to it, its files; or its versions; or one as it was |
| `write <path> [--title <title>] --body <markdown>\|--file <path> [--base <version>]` | `GET .../docs/<path>` for the title when none is said, then `PUT .../docs/<path>` | the path, the title and the version written, and what the page refers to |
| `attach <path> <file> [--label <words>]` | `POST .../docs/<path>/files`, as a form | how many files the page carries |
| `archive <path>`, `restore <path>` | `POST .../docs/<path>/archive`, `.../restore` | that the page is put away, or back |
| `serve [<dir>] [--port <n>]` | `GET /api/v1/me` once; then every request of the pages under `/api/`, carried with the token | where it serves and as whom; then nothing until stopped ([a console of one's own](#a-console-of-ones-own)) |
| `help [<command>]` | nothing | the usage, written for an agent that meets the command for the first time |
| `--version` (also `version`, `-v`) | nothing | which version of the command this is |

`...` is `/api/v1/projects/<key>`, the project the command works in. Everywhere: `--json` prints the console's own answer as JSON, in the shapes of `@skillcdn/console/api`; `--url <origin>` names another console for this one command; `--project <key>` the project. A Markdown body given as `-` is read from standard input. Every argument is bounded and checked by the console, as the REST API's schemas say; the command sends it as it was given.

## The documents

A project's pages of Markdown ([ADR-0009](../adr/0009-documents-are-pages-of-markdown-in-a-project-addressed-by-path-versioned-and-linked-both-ways.md)), by path (`guides/onboarding`): `console docs` lists a folder, `console doc` reads a page, `console write` writes one, the first version or the next, keeping the title when none is said, `console attach` adds a file from the machine, `console archive` and `console restore` put a page away and bring it back. A link in a body whose destination is a page's path refers to that page, and `console doc` says what refers to a page in return. An agent writes down what it learned where the next agent will read it, and refers to it from its reports and in what it asks.

## The run a command means

`report`, `hand-in`, `ask`, `finish` and `fail` act on a run. Named with `--run <id>`, that one; else the one open run begun with this token in the project (`GET .../runs?open=true&mine=true`). None open, or several: the command exits with `1` and says so, listing the open ones, so that an agent working two tasks at once says which.

## Waiting for a decision

`ask` waits 60 seconds for the answer unless `--wait` says otherwise, within what an agent's shell gives one command; `decision <id> --wait <seconds>` waits as long as it is told, a day at most. The command asks the console to hold each request for up to 50 seconds (`?wait=`), the server's own bound, and repeats while the time lasts, with a breath between requests; the answer arrives as soon as a person gives it, since the console is woken through the database's own channel. A decision that still waits when the time is up is exit code `3`: the run waits with it, so the agent keeps waiting with `console decision <id> --wait 100`, within what its shell gives one command, and goes on meanwhile only with work that does not depend on the answer. `ask` prints the decision's id as soon as it is raised, before any waiting, so that a wait cut short loses nothing; with `--json` it prints the decision then, and again with its answer when that comes.

## A console of one's own

`console serve [<dir>] [--port <n>]` serves a console a person built from the package, for themselves ([ADR-0014](../adr/0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md)): the build in `<dir>` (its `index.html` and files) at `http://127.0.0.1:11197/`, or the port given (`0` for one the system picks), and everything under `/api/` carried to the console the command is signed in to, with its token as `Authorization: Bearer`, so that the pages never hold the token and the organization's console allows no other origin. The command listens on the loopback only and answers no request whose host is not it; a request to the API that the browser says comes from another site's page (`Sec-Fetch-Site`) is refused, as is one from a browser that does not say and names another origin. What is the browser's does not travel: cookies, the page's origin and referrer, the browser's own metadata; what comes back travels decoded, without a cookie. The feed's stream passes through as it streams, and a file handed in as a form. Without a directory only the API is served, for a development server to send its `/api/` requests to with the loopback's host, so that a console is built with its reloading against the real board. The command checks the token against the console first (`GET /api/v1/me`), says where it serves and as whom, and runs until stopped. The pages learn from the same answer that they hold a token (`agent`) and offer nothing a token cannot do. How a console is built from the package is in the [package's README](../../packages/console/README.md#a-console-of-your-own).

## Output and exit codes

Plain text on standard output: one line per thing in a list, a few lines for one thing in full, with ids given, since the commands take them, and the vocabulary's own words (`in_progress`, `waiting`), since the options take them. What went wrong goes to standard error as the console's stable code and its words (`run.task_taken: an agent is at work on the task already`), with a hint when there is something to do about it.

| Exit code | Meaning |
|---|---|
| `0` | Done. |
| `1` | The console refused, or could not be reached; the reason is on standard error. |
| `2` | The command was not understood. |
| `3` | The decision still waits for a person. |

## What an agent is told

`console help` says what the board is, that the agent acts as the person whose token it holds and that everything it sends is shown to people as text, which project the commands work in and how it is named, what each command does (take a task, report at the milestones of the work, hand in what was made, ask when a person must decide, finish when done, write and read the project's pages), and the refusals any command may meet. `console help <command>` adds what the command takes, the limits the console holds it to (how long a report, a summary, a question or an option may be; how many options, reports and links) and the refusals it may meet, by code, so that an agent learns them before it runs into them. The skill `working-the-board` ([skills/working-the-board/SKILL.md](../../skills/working-the-board/SKILL.md), [ADR-0015](../adr/0015-the-consoles-skills-live-in-this-repository-in-the-skillcdn-format-and-the-package-carries-them.md)) says how the work goes: reading, taking, reporting at the milestones, asking and waiting, handing in, writing down, finishing. An organization's own skill for its console adds the rest: which tasks to take, what to report, when to ask.

## Running an agent on a task

What a person does, once the command is signed in where the agent runs; tried with Claude Code on 2026-10-09, with an agent that took a task, reported at each milestone, raised a decision, acted on the answer, handed in and finished, and a person who answered on the board.

1. Write the task on the board of the project, with its body as the work order: what to make, where, the milestones, what to ask.
2. Start the agent in the directory it is to work in, where `console use <key>` has named the project (once, committed), and tell it, in its own words, what this amounts to: run `console help`; take the task with `console take <number>` and follow its body; report at the milestones with `console report`; ask with `console ask` when a person must decide, and keep waiting with `console decision <id> --wait 100` until the answer comes; hand in with `console hand-in`; finish with `console finish --summary`. Say that the command is signed in already and that it must never look for or print a token.
3. Follow the run on the board, and answer the decisions it raises. The agent's reports, what it handed in and its summary are the run's record on the task's page.

## Not yet

Hooks that report an agent's events without being asked ([roadmap](../roadmap.md)).
