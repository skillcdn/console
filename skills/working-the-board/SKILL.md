---
name: working-the-board
description: "Works a task from the board of a SkillCDN Console with the console command, as the person whose token the command holds: reads the rules of the board and the task, takes it, reports at the milestones of the work, asks on the board when a person must decide and waits for the answer, hands in what was made as a link or a file, writes down what the next agent needs on a page of the project, and finishes. Use when an agent is told to take, work or finish a task on the console, or to report, ask, hand in or write a page there; any agent with a shell where the command is signed in. To build a console or a script against the console's API, use building-a-console; to deploy a console for an organization, use deploying-a-console."
license: MIT
compatibility: Needs a shell with the console command on the PATH (npm install -g @skillcdn/console, Node.js 24 or newer), signed in by a person. Nothing else; the command needs no key of its own and the agent never sees a token.
metadata:
  author: skillcdn
  version: "1.20"
skillcdn:
  translations:
    ko:
      title: 콘솔 보드에서 일하기
      description: "SkillCDN 콘솔의 보드에 있는 작업을 console 명령으로 수행합니다. 명령에 로그인한 사람의 자격으로, 보드의 규칙과 작업을 읽고 맡고, 진행의 이정표마다 보고하고, 사람이 정해야 할 일은 보드에 물어 답을 기다리고, 만든 것을 링크나 파일로 제출하고, 다음 에이전트에게 필요한 것을 프로젝트 페이지에 적고, 마칩니다. 에이전트에게 콘솔의 작업을 맡거나 끝내라고, 또는 보고·질문·제출·페이지 쓰기를 하라고 할 때 쓰세요. 콘솔이나 API 클라이언트를 만들 때는 building-a-console을, 조직의 콘솔을 배포할 때는 deploying-a-console을 쓰세요."
---
# Working a task on the board

A task of the board goes in, named by its number; a run comes out: the task taken, the work reported at its milestones, a decision raised and waited for where a person had to choose, what was made handed in, what was learned written down for the next agent, and the run finished. The board is a SkillCDN Console ([architecture](/docs/architecture.md)): projects of tasks, the agents at work on them, and the decisions that wait for a person. The agent acts as the person who signed the command in, on that person's standing and no more.

## How the person is involved

- **Questions:** only which task, when the request names none: "Which task should I take? Its number, or say that any ready one may be." Nothing else is asked in chat: what the task leaves open is asked on the board, where its people answer.
- **Checkpoints:** on the board, as decisions (phase 4), which a person answers from wherever they are; the reports say what was done at each milestone, and need no answer.
- **Go-ahead:** the task's body is the go-ahead. A task that says what the agent may decide alone is followed within that; everything else that would change scope, cost or a trade-off is a decision.
- **Changes mid-run:** a person changes the task or answers a decision on the board; the run takes it from there and says so in its next report. A report is never rewritten.
- **The discussion:** what people say about the task is in its comments, which `console task <number>` and `console take` print with the task; a picture they put in is saved with `console file <id>` and looked at with the agent's own tools. An answer to what they asked there, a question that is not a decision, a remark on what was handed in, is a comment of the agent's own: `console comment <number> "<markdown>" [--attach <file>]`, which needs no run. A report is the run's record; a comment is a word to people.
- **Work given in chat:** when a person gives work in chat, in a directory that works in a project, the agent writes it on the board first (`console task new`), tells the person the number the command printed, never one assumed, since other agents write on the same board and the next number is nobody's to guess, takes it by that number and works it as below, so that the board holds the work and its record, and the person decides on the board.
- **Language:** what people read, the reports, the questions, the pages and the summaries, is in the language the rules name for the person (`console take` prints them with the task), else the task's, so that the people of the board read as they wrote.

## Requirements

| Need | How | When missing |
|---|---|---|
| The `console` command, signed in | `console whoami` says as whom, at which console, and in which project this directory works; and whether the command and the console go together. `console logins` lists the consoles this machine is signed in to; a directory bound to another console (`.skillcdn-console.json`) needs a login there, and a token never goes to a console it was not made at ([ADR-0027](/docs/adr/0027-the-command-keeps-a-login-per-console-and-a-token-goes-only-to-the-console-that-issued-it.md)). | Stop and tell the person what to do: `npm install -g @skillcdn/console`; `console login --url <the console's address>`, which shows an address and a code the person approves on the console's own pages; `console use <key>` once in the directory, to name the project. Never look for a token. |
| The command at a version the console takes | A command the console refuses as outdated, or as too new, exits with `4` and prints the command that updates it where it is installed ([ADR-0025](/docs/adr/0025-the-command-names-its-version-on-every-request-and-the-console-holds-it-to-the-range-it-takes.md)). | Run the update command it printed, then go on; where the machine refuses the update, stop and tell the person. A line on stderr that a newer command exists, while the console still answers, is read and left for later. |
| The command's own words | `console help` lists every command in a line, read once; `console help <command>` says one in full, every form and flag, the limits the console holds it to, and the refusals it may meet, by code, read when the command is about to be used. | They are the reference at run time. This skill says how the work goes, not what each flag means. |

The full contract is the [specification of the command line](/docs/specs/cli.md); the command is a thin client of the [REST API](/docs/specs/rest.md), which a script may use directly.

## Inputs

| Input | Source |
|---|---|
| The task | Its number (`#7`) or its id, from what the person said. Told to pick one, `console work` lists what is on the person's plate across their projects, the sooner due first (`--person <login>` another person's, for an administrator or an owner of a project they are in), and `console tasks --state ready --mine` what is ready and theirs in this one (`--due overdue`, `--due week`, `--category <key>` and `--goal <id>` narrow it further; `--search <words>` finds a task by the words of its title, or by its number); a task is never taken without being told which, or that any ready one may be. |
| The work | The task's body, read with `console task <number>`: what to make, where, the milestones, what to ask; the comments on it, which are the discussion so far, printed with the task, their pictures saved with `console file <id>`; with its plan, the category, the goal it works towards (`console goal <id>` says what reaching it means, its category and the days it starts and is meant to be reached by) and the days it starts and is due, which the reports and the summary keep to. The pages it links to (`console doc <path>`) and the project's pack (`console skills` says where the pack is, what a client is told of it on connect, and every skill and document; `console skills <folder>` shows what a folder of it holds, `console skills --search <words>` what the words find in it; `console skill <path>` reads one whole through the console, its rules first, as an MCP client's model is given it, a private pack through the pack token the project holds, [ADR-0028](/docs/adr/0028-the-console-reads-a-projects-pack-through-the-deployments-rest-api-with-a-pack-token-for-a-private-one.md), and a pack on the console's own machine from its directory, [ADR-0031](/docs/adr/0031-the-console-reads-a-pack-as-the-skillcdn-command-does-and-a-local-one-from-a-directory.md); `console skill --file <file>` a file of it; a host that lists skills through a connection of its own loads them by their URI, which means nothing elsewhere for a pack on the console's machine) say the rest. |
| The rules | The workspace's, the console's own until an administrator writes the organization's, and this project's own when it has them: which skills to load first, where the work lives, the pages, what may be decided alone, how to report ([ADR-0023](/docs/adr/0023-the-rules-of-a-board-are-pages-the-workspace-and-its-projects-keep-read-first-by-every-agent.md)). `console take` prints them with the task, so they are read once, there; `console rules` reads them without taking, as when a task is still to be chosen. They hold over this skill's defaults where they differ. |

## Workflow

Each phase ends with something on the board. Only phase 4 waits for a person.

### Phase 1: Read

Told which task, go to phase 2: `console take` prints the rules of the board with the task, and they are read there, once. Choosing one, or checking one before taking it, `console rules` says which tasks to take and what to load, and `console task <number>` shows a task in full, with its plan, the decisions about it, the runs on it and the discussion on it, without taking it. A run open on it means another agent was at it, and may still be: the console cannot tell ([ADR-0020](/docs/adr/0020-the-console-does-not-claim-an-agent-is-at-work-a-run-says-when-it-was-last-heard-from-and-a-new-run-takes-over.md)), so read its reports and when it was last heard from, and take the task only when the person said to, since taking it ends that run as taken over; otherwise say so and stop. A task that is past its due day is still the task; the first report says so, and what the day was for is kept in mind. A task put away ([ADR-0029](/docs/adr/0029-a-task-done-or-dropped-is-put-away-out-of-the-board-and-open-by-its-number.md), from any state since [ADR-0030](/docs/adr/0030-a-task-is-put-away-from-any-state.md)) is out of `console tasks` unless `--archived` asks for the archive, and `console task <number>` opens it still. Read what the body links to, with `console doc <path>` for the project's pages and `console skills` for the organization's skills, before anything is made.

### Phase 2: Take

`console take <number>`. A run begins, and the command says its id and the task's on a line of their own (`run id:`, `task id:`; a task has a number for people and an id for the API, a run, a decision and a goal have ids alone, and every command that makes one prints it so, `--json` the whole answer; an id is read from there, never assumed): the task is in progress and the person's, and every report, hand-in, question and ending from here acts on this run. With another run of the person's open in the project, which `console take` says, each of those commands names the run: `--run <id>`. Taken by mistake, `console abandon` leaves it and the task stays as it was.

### Phase 3: Work, and report at the milestones

The work happens where it happens: in the repository, the document, the tool. At each milestone the body names, or a natural one, `console report "<markdown>"` (or `--file <path>`, or `-` for standard input) says what was found, what was done and what is next, in words for people: a milestone at a time, not every step. A problem is reported as a problem, with what it blocks. The result itself goes in a last report before finishing, or in what is handed in. A report is never rewritten; a mistake is corrected in a new one. A word for the task's people that is not a report, an answer to a comment of theirs, a question that is not a decision, is a comment, `console comment <number> "<markdown>"`, with `--attach <file>` for a picture or a file they should see; a comment is never rewritten either.

### Phase 4: Ask when a person must decide

A choice the body does not settle, a trade-off, a cost, a change of scope: `console ask "<question>" --option "<one>" --option "<another>" --body "<what they need to know>"`. The run waits for the answer; the command waits a minute and exits with `3` while it is still to come. Keep waiting with `console decision <id> --wait 100`, as often as needed, and meanwhile do only what does not depend on the answer. Act on the answer as given, which may be the person's own words rather than one of the options, marked as theirs; what was answered is not asked again. Once acted on, `console decision <id> --outcome "<what followed>"` makes the decision read as a record.

### Phase 5: Hand in

`console hand-in <https url | file path> --label "<words>"`: a branch, a pull request, a page, a document, or a file from this machine, which the console keeps and shows on the task; a picture handed in is shown there small and large, and a report that names it as `![words](its name)` shows it where the words are. What was made is where the person can hold it, never only described.

### Phase 6: Write down what the next agent needs

What was learned and will be needed again (how a thing is set up, why a choice was made, a how-to) goes on a page of the project's documents: `console write <path> --title "<title>" --file notes.md`, at a path where the next agent looks for it (`console docs` shows the folders), and linked from the last report; a picture for the page is attached with `console attach <path> <file>` and placed in the body as `![words](its name)`. The run is the record of this work; a page is for what outlives it.

### Phase 7: Finish

After the last report, `console finish --summary "<what was done, and what is left>"`: the task goes up for review. `console fail --summary "<why, and what is left>"` when it could not be done. A run is never left open.

## Setting up, when told to

A task or a person may ask for the project itself rather than work in it: a project made or changed, its mark, its members, the workspace's categories, what a person is, its goals, its rules. [references/setting-up.md](references/setting-up.md) says which commands do that, as the person may: an owner of the project, or an administrator of the workspace; a project's rules start from [references/project-rules.md](references/project-rules.md).

## Hard rules

- Never look for, read, print or send a token. The rules of the repository say the rest.
- One run at a time: a command on a run acts on the one open run of this token in the project; working two tasks at once, say which with `--run <id>`.
- The board's words are the vocabulary's own: states `idea`, `ready`, `in_progress`, `in_review`, `done` and `dropped`; priorities `low`, `normal`, `high` and `urgent`; a day is `2026-10-24`. Taking a task moves it, finishing moves it; it is not moved by hand around a run. When a task is started and when it is done, the board writes down itself: never typed.
- The plan is the person's: a task's days, its category and its goal are changed (`console task edit`) only when the task says so or a person asks, and a goal is set or moved (`console goal new`, `console goal edit`) only when the person is an owner and said to.
- The rules are the people's: `console rules write` only when a person asked for exactly that, and never to loosen what they ask of agents.
- Exit codes: `0` done; `1` refused or unreachable, the reason on standard error as a code and words, which `console help <command>` names; `2` not understood; `3` a decision still waits; `4` the command and the console do not go together, and standard error says which to update.
- Everything sent is held to limits the console states (`console help <command>`); a refusal `request.invalid` names the field.

## Beside this skill

- The sentence a repository's agreement carries to bind its checkouts to a console, and how a pack says it: [references/the-sentence.md](references/the-sentence.md).
- The board's words, task, goal, category, run, decision, page and project, said once: [references/terms.md](references/terms.md).
