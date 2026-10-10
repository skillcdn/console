---
name: working-the-board
description: "Works a task from the board of a SkillCDN Console with the console command, as the person whose token the command holds: reads the task, takes it, reports at the milestones of the work, asks on the board when a person must decide and waits for the answer, hands in what was made as a link or a file, writes down what the next agent needs on a page of the project, and finishes. Use when an agent is told to take, work or finish a task on the console, or to report, ask, hand in or write a page there; any agent with a shell where the command is signed in. To build a console or a script against the console's API, use building-a-console."
license: MIT
compatibility: Needs a shell with the console command on the PATH (npm install -g @skillcdn/console, Node.js 24 or newer), signed in by a person. Nothing else; the command needs no key of its own and the agent never sees a token.
metadata:
  author: skillcdn
  version: "1.0"
skillcdn:
  translations:
    ko:
      title: 콘솔 보드에서 일하기
      description: "SkillCDN 콘솔의 보드에 있는 작업을 console 명령으로 수행합니다. 명령에 로그인한 사람의 자격으로, 작업을 읽고 맡고, 진행의 이정표마다 보고하고, 사람이 정해야 할 일은 보드에 물어 답을 기다리고, 만든 것을 링크나 파일로 제출하고, 다음 에이전트에게 필요한 것을 프로젝트 페이지에 적고, 마칩니다. 에이전트에게 콘솔의 작업을 맡거나 끝내라고, 또는 보고·질문·제출·페이지 쓰기를 하라고 할 때 쓰세요. 콘솔이나 API 클라이언트를 만들 때는 building-a-console을 쓰세요."
---
# Working a task on the board

A task of the board goes in, named by its number; a run comes out: the task taken, the work reported at its milestones, a decision raised and waited for where a person had to choose, what was made handed in, what was learned written down for the next agent, and the run finished. The board is a SkillCDN Console ([architecture](/docs/architecture.md)): projects of tasks, the agents at work on them, and the decisions that wait for a person. The agent acts as the person who signed the command in, on that person's standing and no more.

## Requirements

| Need | How | When missing |
|---|---|---|
| The `console` command, signed in | `console whoami` says as whom, at which console, and in which project this directory works. | Stop and tell the person what to do: `npm install -g @skillcdn/console`; `console login --url <the console's address>`, which shows an address and a code the person approves on the console's own pages; `console use <key>` once in the directory, to name the project. Never look for a token. |
| The command's own words | `console help`, and `console help <command>`: what each command takes, the limits the console holds it to, and the refusals it may meet, by code. | They are the reference at run time. This skill says how the work goes, not what each flag means. |

The full contract is the [specification of the command line](/docs/specs/cli.md); the command is a thin client of the [REST API](/docs/specs/rest.md), which a script may use directly.

## Inputs

| Input | Source |
|---|---|
| The task | Its number (`#7`) or its id, from what the person said. Told to pick one, `console tasks --state ready` lists what is ready; a task is never taken without being told which, or that any ready one may be. |
| The work | The task's body, read with `console task <number>`: what to make, where, the milestones, what to ask. The pages it links to (`console doc <path>`) and the project's skills (`console skills`, each loaded through the agent's own SkillCDN connection) say the rest. |
| The organization's way | Its own skill for its console, when it has one, adds which tasks to take, what to report and when to ask; it comes through the same kind of address as its other skills. |

## Workflow

Each phase ends with something on the board. Only phase 4 waits for a person.

### Phase 1: Read

`console task <number>` shows the task in full, the decisions about it and the runs on it. A run open on it by another agent means the task is taken: say so and stop. Read what the body links to, with `console doc <path>` for the project's pages and `console skills` for the organization's skills, before anything is made.

### Phase 2: Take

`console take <number>`. A run begins: the task is in progress and the person's, and every report, hand-in, question and ending from here acts on this run. Taken by mistake, `console abandon` leaves it and the task stays as it was.

### Phase 3: Work, and report at the milestones

The work happens where it happens: in the repository, the document, the tool. At each milestone the body names, or a natural one, `console report "<markdown>"` (or `--file <path>`, or `-` for standard input) says what was found, what was done and what is next, in words for people: a milestone at a time, not every step. A problem is reported as a problem, with what it blocks. The result itself goes in a last report before finishing, or in what is handed in. A report is never rewritten; a mistake is corrected in a new one.

### Phase 4: Ask when a person must decide

A choice the body does not settle, a trade-off, a cost, a change of scope: `console ask "<question>" --option "<one>" --option "<another>" --body "<what they need to know>"`. The run waits for the answer; the command waits a minute and exits with `3` while it is still to come. Keep waiting with `console decision <id> --wait 100`, as often as needed, and meanwhile do only what does not depend on the answer. Act on the answer as given; what was answered is not asked again. Once acted on, `console decision <id> --outcome "<what followed>"` makes the decision read as a record.

### Phase 5: Hand in

`console hand-in <https url | file path> --label "<words>"`: a branch, a pull request, a page, a document, or a file from this machine, which the console keeps and shows on the task. What was made is where the person can hold it, never only described.

### Phase 6: Write down what the next agent needs

What was learned and will be needed again (how a thing is set up, why a choice was made, a how-to) goes on a page of the project's documents: `console write <path> --title "<title>" --file notes.md`, at a path where the next agent looks for it (`console docs` shows the folders), and linked from the last report. The run is the record of this work; a page is for what outlives it.

### Phase 7: Finish

After the last report, `console finish --summary "<what was done, and what is left>"`: the task goes up for review. `console fail --summary "<why, and what is left>"` when it could not be done. A run is never left open.

## Hard rules

- Never look for, read, print or send a token. The rules of the repository say the rest.
- One run at a time: a command on a run acts on the one open run of this token in the project; working two tasks at once, say which with `--run <id>`.
- The board's words are the vocabulary's own: states `idea`, `ready`, `in_progress`, `in_review`, `done` and `dropped`; priorities `low`, `normal`, `high` and `urgent`. Taking a task moves it, finishing moves it; it is not moved by hand around a run.
- Exit codes: `0` done; `1` refused or unreachable, the reason on standard error as a code and words, which `console help <command>` names; `2` not understood; `3` a decision still waits.
- Everything sent is held to limits the console states (`console help <command>`); a refusal `request.invalid` names the field.

## Terms

- **Task**: what is to be done, numbered per project. **Run**: one agent at work on one task for one person, with its reports, what it handed in, and what it waits for. **Decision**: a question with options, which a person answers on the board. **Page**: a document of the project, Markdown at a path that does not change. **Project**: a board of its own, with its members and its skills address.
