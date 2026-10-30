---
name: planning-the-board
description: "Puts work on the board of a SkillCDN Console and sets the board up, as a person asks, with the console command: tasks written from what they say or plan, each with its days, category, goal, parent and workers; goals on the roadmap; a project made or changed, with its mark, its members and its rules; the workspace's categories, people and settings; a private pack connected. Use when a person says 'put this on the board', 'write these as tasks', 'plan next week', 'set up a project for this', 'add Kim to the project', 'write the rules', 'make a category for design'. To work a task that is on the board, use working-the-board, which also writes a single piece of work given in chat before working it. Everything is done as the person may: a task by anyone who works in the project, the rest by an owner of the project or an administrator of the workspace; what they may not, the console refuses, and the step goes back to them. Nothing is spent."
license: MIT
compatibility: Needs a shell with the console command on the PATH (npm install -g @skillcdn/console, Node.js 24 or newer), signed in by a person who works in the project, owns it, or administers the workspace, as the step needs. Nothing else; the agent never sees a token.
metadata:
  author: skillcdn
  version: "1.0"
skillcdn:
  translations:
    ko:
      title: 보드 계획하고 설정하기
      description: "SkillCDN 콘솔의 보드에 일을 올리고 보드를 설정합니다. 사람이 말하거나 계획한 일을 날짜·범주·목표·상위 작업·담당자와 함께 작업으로 쓰고, 로드맵에 목표를 세우고, 프로젝트를 만들거나 바꾸고(마크, 구성원, 규칙), 워크스페이스의 범주·사람·설정을 다루고, 비공개 팩을 연결합니다. '이거 보드에 올려줘', '이것들 작업으로 써줘', '다음 주 계획 세워줘', '이 일로 프로젝트 만들어줘', '김OO 프로젝트에 추가해줘', '규칙 써줘', '디자인 범주 만들어줘'라고 할 때 쓰세요. 보드에 있는 작업을 하는 것은 working-the-board이고, 그 스킬도 채팅으로 받은 일 하나는 먼저 보드에 쓰고 시작합니다. 모든 일은 그 사람이 할 수 있는 만큼 합니다: 작업은 프로젝트에서 일하는 누구나, 나머지는 프로젝트 소유자나 워크스페이스 관리자. 할 수 없는 일은 콘솔이 거부하고 그 단계는 사람에게 돌아갑니다. 비용은 들지 않습니다."
---
# Planning and setting up the board

What a person says goes in: work to put on the board, a plan for a week or a milestone, a project to set up, a member to add, a category, the rules. What comes out is the board changed as they said, and the numbers and the ids the commands printed, told back to them. The board is a SkillCDN Console ([architecture](/docs/architecture.md)): a workspace of projects, each a board of tasks with its roadmap of goals, sorted into the workspace's categories. The agent acts as the person who signed the command in, who works in the project, owns it or administers the workspace, and no further ([ADR-0021](/docs/adr/0021-a-token-configures-as-its-person-does.md)). Writing and setting up need no run: the project's feed of events records every write, with the agent named beside the person.

## How the person is involved

- **Questions:** only what the request and the board leave open, in one message before anything is read or written: the project, when the directory names none and the person has several ("Which project? `console projects` lists them by key."); a time the plan cannot turn into a day ("Which day is the launch?"; a week or a day named needs no question); a person named whom the project's members do not resolve to one login ("Which login is Kim? `console members` lists them."). Nothing else: the category, the goal, the parent, the state and the days are derived as the Inputs say, shown, and changed on request.
- **Checkpoints:** the plan before it is written, whenever more than one task is written, or a day, a category, a state or a worker was derived rather than said, or a goal is set or moved, or tasks that exist are changed: one message with the table of phase 2, the derived cells marked, and "OK" writes it. One task with everything said, a member, a category: written at once and told.
- **Go-ahead:** when the person says to go ahead alone, the plan is written at once and reported as the same table, with the numbers. The rules of a board are written only when the person asked for exactly that, go-ahead or not.
- **Changes mid-run:** a task written wrong is changed (`console task edit`), never written twice; one that should not exist is put away (`console task archive`), since nothing is deleted; a plan changed in the message is rewritten from that point and shown again.

## Requirements

| Need | How | When missing |
|---|---|---|
| The `console` command, signed in as the person | `console whoami` says as whom, at which console and in which project this directory works. `console projects` says what the person is in each project; `console people` and `console members` say who is who, by login. | Stop and tell the person: `npm install -g @skillcdn/console`, then `console login --url <the console's address>`, which shows an address and a code they approve on the console's own pages. Never look for a token. Refused because the person is out (`auth.deactivated`, `auth.not_admitted`, [ADR-0044](/docs/adr/0044-a-token-of-a-person-who-is-out-is-kept-and-refused-with-the-reason-until-they-are-back-in.md)), nothing is written, and the person is told. |
| The standing the step needs: what the person is in the project or the workspace | A task written, changed or put away: anyone who works in the project. A goal, the project's settings, its mark, its members, its rules, its pack token: an owner of the project (an administrator owns every project). A project made, the workspace's categories, people and settings, its rules and its pack token: an administrator ([ADR-0045](/docs/adr/0045-a-project-is-made-by-an-administrator.md)). | What the person may not, the console refuses (`auth.forbidden`): the step is told back to them with who may do it, and never worked around. |
| The command's own words | `console help <command>` says every form and flag, the limits (a title's length, how many tasks a project holds) and the refusals by code, read when the command is about to be used. | They are the reference at run time; this skill says what to write, and in what order. |

The board's words, task, goal, category, run, decision, page and project, are said once in [terms.md](/skills/working-the-board/references/terms.md); the command's contract is the [specification of the command line](/docs/specs/cli.md). A page this skill links by a path from the root (`/docs/...`, `/skills/...`) is a file of the console's repository: read it through the connection that served this skill, or in the package on this machine, where `console whoami` prints the skills are.

## Inputs

| Input | Source |
|---|---|
| The project | The one the directory works in (`console whoami`), else `--project <key>` on every command, from what the person said or the question above. |
| The work, or the plan | What the person said, in chat or in a document they point to: the pieces of work, their time, who does what. One piece of work is one task; a milestone that several tasks reach is a goal; a task waits for another only when the person said so, and a list is not an order. |
| The board as it is | `console categories`, the keys a task is sorted by; `console goals`, the roadmap; `console tasks --open` and `console tasks --search <words>`, so that a task is not written twice and a parent is found by its title; `console workspace`, the day the week begins and the time zone; `console rules`, which may say how tasks are written here: the language, the folders of the pages, who decides what. |
| The people | `console members` for the project, `console people` for the workspace, by login, which `--worker`, `member` and `person` take. A name is matched against the members' logins and names: exactly one match is the login, shown at the checkpoint; none, or several, is the question above. A login is matched as typed, so a person the list hides (where who sees whom is narrowed) is still named by their login. |
| The days | From the plan's words, by this machine's clock: `today`, `tomorrow`, `+7`, or a day as `2026-11-03`. A week named ("next week", "this week") is a start on its first day and a due on its last, the week beginning as `console workspace` says, and on Monday when it says `auto`; "by Friday" is a due day alone; a span the person gave in working days ends on its Friday only when they said so. A time that is not a day ("by the launch") is the question above. A due day is never before the start. |
| Everything else | Derived and marked in the plan: the category whose name the task's words name or imply, and when two fit alike the one the project's tasks of that kind use (`console tasks --search`), else left empty and named in the account; the state, `ready` when the task can be taken from today on, its start day being the plan and not a gate, and `idea` only when a decision or a fact the body lacks must come first; the priority, `normal` unless the person said otherwise; the goal from the milestone the person named, found with `console goals --search <words>`. |

## Workflow

The questions of "How the person is involved" are asked before phase 1 when the request leaves them open; after that, each phase ends with one line to the person, and only phase 2 stops for them.

### Phase 1: Read the board

Produces the **shape of the board**: the project, its categories, its goals, its open tasks, its members and its rules, read with the commands of the Inputs. A project that does not exist yet goes to phase 4 first, for an administrator. A category the plan needs and the workspace lacks is left empty on the task and proposed in the account, for an administrator to make; it is never made unasked.

### Phase 2: Shape the plan

Produces the **plan**: one line per task, as a table the person reads at a glance (title, category, start and due day, priority, goal, parent, workers, state, with the derived cells marked), and the goals to set or move. A task is one piece of work that one agent or person finishes and hands in. Its title says what is to be done, in plain words that stand on their own, up to 200 characters: a noun the person gave ("the pricing table") takes the plainest verb that makes it work to do ("Make the pricing table"), shown at the checkpoint, and the scope stays theirs; what the title refers to (a milestone, a commit, a page) goes in the body, linked where it can be. The body is the work order for the agent that takes the task, in the shape of [a-task.md](references/a-task.md), holding only what the person said: what to make in their words, where and the milestones when they said them, and under "Ask" what they did not say, so that the agent asks on the board rather than guesses; what the rules say is read first goes under "Read first". A task that exists already, one open task whose title names the same piece of work, is changed in what the person said of it (its days, its workers), not written again. Stop for the checkpoint as "How the person is involved" says.

### Phase 3: Write

Produces the **tasks and goals on the board**. A goal first, for an owner: `console goal new "<title>" [--body <markdown>] [--category <key>] [--starts <day>] [--due <day>]`, and `goal id:` is read from the line printed; a goal is changed with `console goal edit <id> [the same flags]`, `none` clearing a category or a day. Then each task: `console task new "<title>" --body <markdown>|--file <path> --state <state> [--priority <priority>] [--category <key>] [--goal <id>] [--starts <day>] [--due <day>] [--worker <login|me>]... [--parent <number|id>]`, `--state` given every time, since a task written without it is an `idea`, and a body longer than a line given with `--file` from a scratch file of the run. The number and the id are read from the lines printed (`Task #<n> written`, `task id:`), never assumed, since other agents write on the same board; `--json` prints the whole answer for a script. A change is `console task edit <number> [the same flags]`, `none` clearing a field; a task that should not exist is put away, `console task archive <number>`, and `console task restore <number>` brings it back. What the console refuses is named by its code and fixed or told back: `task.invalid_category`, `task.invalid_goal`, `task.invalid_dates`, `task.invalid_parent`, `task.too_many`; `task.invalid_worker` says the person may not work in the project, and listing them is a step of phase 4 the person asks for.

### Phase 4: Set up, when asked

Produces the **project and the workspace as asked**: a project made or changed, its mark, its members, the workspace's categories and people, its settings, the rules, a private pack connected, each with the command and the standing [setting-up.md](references/setting-up.md) gives it. A project's rules start from [project-rules.md](references/project-rules.md) and are written only when a person asked for exactly that. What the person may not do goes back to them, with who may.

### Phase 5: Tell

Produces the **account**: the table of phase 2 as it stands on the board, with the numbers and the ids, and the console's address from `console whoami`; what was derived (a category, a day, a state, a login) and how to change it (`console task edit <number> ...`); what was refused, and whose step it is. In the person's language, in one message.

## Verdicts

| Result | Verdict |
|---|---|
| Every piece of work the person named is one task on the board, with the plan as they said it, no task twice, and the numbers told back | Done |
| A day, a category, a goal or a login could not be read from what was said: the task is written without it, and the account says so and how to set it | Done, with the gap named |
| A step was refused for the person's standing (`auth.forbidden`), a key was taken, a login was not of the workspace or not of the project | Told back, with who may do it or what to change; never worked around |
| A task was written twice, or in the wrong project | The extra one put away, and said so; nothing is deleted |

## Hard rules

- The plan is the person's: nothing on the board is changed that they did not ask for, and a task's days, category, goal and workers are set from their words by the rules of the Inputs, never from the agent's own view of what should come first.
- The board writes its moments itself: when a task was started and done is never typed. The state is set by hand only as the plan says (`idea`, `ready`, or `done` for work that was done elsewhere), and never around a run, which `console take` and `console finish` move.
- A number or an id is read from what the command printed, never assumed; a task whose number is not known is found with `console tasks --search <words>`, a goal's id with `console goals --search <words>`.
- Nothing is deleted: a task, a page and the rules are put away, and come back.
- A project is made by an administrator ([ADR-0045](/docs/adr/0045-a-project-is-made-by-an-administrator.md)), and a private one tells a member nothing of itself; a key does not change once made, so it is chosen with the person, and a key the console says is taken (`project.key_taken`) is not guessed around.
- The rules of a board are the people's: written only when a person asked for exactly that, from the example, and never to loosen what they ask of agents.
- Never look for, read, print or send a token. A pack token is connected with a code the person approves at SkillCDN, or read from standard input, never an argument.
- What the console refuses goes back to the person, in their words, with who may do it: the console decides on every request, and the agent tries no other way.

## Beside this skill

- The commands of setting up, with the standing each needs: [references/setting-up.md](references/setting-up.md).
- An example of a task written as a work order: [references/a-task.md](references/a-task.md).
- An example of a project's rules: [references/project-rules.md](references/project-rules.md).
- Working a task that is on the board: [working-the-board](/skills/working-the-board/SKILL.md).
