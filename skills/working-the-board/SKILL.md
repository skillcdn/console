---
name: working-the-board
description: "Works a task from the board of a SkillCDN Console with the console command, as the person whose token the command holds: reads the rules of the board and the task, takes it, reports at the milestones of the work, asks on the board when a person must decide and waits for the answer, hands in what was made as a link or a file, writes down what the next agent needs on a page of the project, and finishes. Use when an agent is told to take, work or finish a task on the console, or to report, ask, hand in or write a page there; any agent with a shell where the command is signed in. To build a console or a script against the console's API, use building-a-console; to deploy a console for an organization, use deploying-a-console."
license: MIT
compatibility: Needs a shell with the console command on the PATH (npm install -g @skillcdn/console, Node.js 24 or newer), signed in by a person. Nothing else; the command needs no key of its own and the agent never sees a token.
metadata:
  author: skillcdn
  version: "1.4"
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
- **Language:** reports, questions, pages and summaries are in the language the task is written in, so that the people of the board read them as they wrote.

## Requirements

| Need | How | When missing |
|---|---|---|
| The `console` command, signed in | `console whoami` says as whom, at which console, and in which project this directory works. | Stop and tell the person what to do: `npm install -g @skillcdn/console`; `console login --url <the console's address>`, which shows an address and a code the person approves on the console's own pages; `console use <key>` once in the directory, to name the project. Never look for a token. |
| The command's own words | `console help`, and `console help <command>`: what each command takes, the limits the console holds it to, and the refusals it may meet, by code. | They are the reference at run time. This skill says how the work goes, not what each flag means. |

The full contract is the [specification of the command line](/docs/specs/cli.md); the command is a thin client of the [REST API](/docs/specs/rest.md), which a script may use directly.

## Inputs

| Input | Source |
|---|---|
| The task | Its number (`#7`) or its id, from what the person said. Told to pick one, `console work` lists what is on the person's plate across their projects, the sooner due first (`--person <login>` another person's, for an administrator or an owner of a project they are in), and `console tasks --state ready --mine` what is ready and theirs in this one (`--due overdue`, `--due week`, `--category <key>` and `--goal <id>` narrow it further); a task is never taken without being told which, or that any ready one may be. |
| The work | The task's body, read with `console task <number>`: what to make, where, the milestones, what to ask; with its plan, the category, the goal it works towards (`console goal <id>` says what reaching it means) and the days it starts and is due, which the reports and the summary keep to. The pages it links to (`console doc <path>`) and the project's skills (`console skills`, each loaded through the agent's own SkillCDN connection to the address; with none that covers it, stop and tell the person, who connects the agent at the address's page) say the rest. |
| The rules | `console rules`: the workspace's, the console's own until an administrator writes the organization's, and this project's own when it has them: which skills to load first, where the work lives, the pages, what may be decided alone, how to report ([ADR-0023](/docs/adr/0023-the-rules-of-a-board-are-pages-the-workspace-and-its-projects-keep-read-first-by-every-agent.md)). Read once before a task is chosen; `console take` prints them again with the task. They hold over this skill's defaults where they differ. |

## Workflow

Each phase ends with something on the board. Only phase 4 waits for a person.

### Phase 1: Read

The rules first, `console rules`, once in a session: they say which tasks to take and what to load before anything is made. Then `console task <number>` shows the task in full, with its plan, the decisions about it and the runs on it. A run open on it means another agent was at it, and may still be: the console cannot tell ([ADR-0020](/docs/adr/0020-the-console-does-not-claim-an-agent-is-at-work-a-run-says-when-it-was-last-heard-from-and-a-new-run-takes-over.md)), so read its reports and when it was last heard from, and take the task only when the person said to, since taking it ends that run as taken over; otherwise say so and stop. A task that is past its due day is still the task; the first report says so, and what the day was for is kept in mind. Read what the body links to, with `console doc <path>` for the project's pages and `console skills` for the organization's skills, before anything is made.

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

## Setting up, when told to

A task or a person may ask for the project itself rather than work in it: a project made or changed (`console project new <key> "<name>"`, `console project edit <key>`), its mark (`console project icon <key> <file>`), its members (`console member add <login>`, `console member role`, `console member remove`), the workspace's categories (`console category new <key> "<name>"`, `console category edit`, `console category remove`), what a person is (`console person role <login> <admin|member>`), its goals (`console goal new`), and its rules (`console rules write --file <path>`, from [the example](references/project-rules.md); the workspace's with `--workspace`, for an administrator). The agent does these as its person may, an owner of the project or an administrator of the workspace ([ADR-0021](/docs/adr/0021-a-token-configures-as-its-person-does.md)); the feed names the agent beside the person on each. What the person may not, the console refuses (`auth.forbidden`): that step goes back to the person in the report, never worked around. `console people` and `console members` say who is who, by login.

## Hard rules

- Never look for, read, print or send a token. The rules of the repository say the rest.
- One run at a time: a command on a run acts on the one open run of this token in the project; working two tasks at once, say which with `--run <id>`.
- The board's words are the vocabulary's own: states `idea`, `ready`, `in_progress`, `in_review`, `done` and `dropped`; priorities `low`, `normal`, `high` and `urgent`; a day is `2026-10-24`. Taking a task moves it, finishing moves it; it is not moved by hand around a run. When a task is started and when it is done, the board writes down itself: never typed.
- The plan is the person's: a task's days, its category and its goal are changed (`console task edit`) only when the task says so or a person asks, and a goal is set or moved (`console goal new`, `console goal edit`) only when the person is an owner and said to.
- The rules are the people's: `console rules write` only when a person asked for exactly that, and never to loosen what they ask of agents.
- Exit codes: `0` done; `1` refused or unreachable, the reason on standard error as a code and words, which `console help <command>` names; `2` not understood; `3` a decision still waits.
- Everything sent is held to limits the console states (`console help <command>`); a refusal `request.invalid` names the field.

## Terms

- **Task**: what is to be done, numbered per project, with its plan (a category, a goal, the days it starts and is due) and its moments (when it was started and done, which the board keeps). **Goal**: what the project works towards, on its roadmap, with the day it is meant to be reached by; its progress is its tasks. **Category**: a kind of work, the workspace's word for it, by key. **Run**: one agent at work on one task for one person, with its reports, what it handed in, and what it waits for. **Decision**: a question with options, which a person answers on the board. **Page**: a document of the project, Markdown at a path that does not change. **Project**: a board of its own, with its members and its skills address.
