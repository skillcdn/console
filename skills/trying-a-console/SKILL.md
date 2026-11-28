---
name: trying-a-console
description: "Brings a SkillCDN Console up on one computer with Docker and takes its person from nothing to a first task worked on the board: the release fetched, the console started, signing in registered at GitHub with one press, the first administrator signed in, the console command connected for the person's own agent, a first project, and one task taken, reported on, asked about, handed in and finished; then how it is all taken down. Use when a person says 'let me try the console on this computer', 'run the console locally', 'start the console with Docker and get me signed in'. For an organization's console at an address of its own, use deploying-a-console; for an agent account on a machine of its own, running-an-agent; to work a task of a console that is there already, working-the-board."
license: MIT
compatibility: Needs a shell that runs bash (on Windows, Git Bash), Docker with its compose plugin, running, git, Node.js 24 or newer with npm, network access to GitHub, its container registry and npm, a GitHub account, and a browser on this computer signed in to it.
metadata:
  author: skillcdn
  version: "1.0"
skillcdn:
  translations:
    ko:
      title: 내 컴퓨터에서 콘솔 써 보기
      description: "컴퓨터 한 대에 Docker로 SkillCDN 콘솔을 띄우고, 보드에서 첫 작업을 끝낼 때까지 안내합니다. 릴리스를 받아 콘솔을 시작하고, GitHub에서 버튼 한 번으로 로그인을 등록하고, 첫 관리자가 로그인하고, 사람의 에이전트가 쓸 console 명령을 연결하고, 첫 프로젝트를 만들고, 작업 하나를 맡아 보고하고 묻고 제출하고 마칩니다. 다 쓴 뒤 지우는 법도 다룹니다. '이 컴퓨터에서 콘솔을 써 보고 싶어', '콘솔을 로컬에서 띄워 줘', 'Docker로 콘솔을 띄우고 로그인까지 안내해 줘'라고 할 때 쓰세요. 조직의 주소로 콘솔을 배포할 때는 deploying-a-console, 전용 머신의 에이전트 계정은 running-an-agent, 이미 있는 콘솔의 작업은 working-the-board를 쓰세요."
---
# Trying the console on one computer

One sentence goes in; a console on this computer comes out, at `http://127.0.0.1:11199`, with its person signed in as the first administrator, this agent connected as theirs, a first project, and one task worked to its end on the board. Nothing leaves the machine but what GitHub is asked to sign people in, and everything is taken down again with three commands.

It is the smallest install of [the deploy guide](/deploy/README.md#the-smallest-install-and-a-closed-network): the console's image next to PostgreSQL, made by `deploy/install.sh`, which also registers signing in at GitHub ([ADR-0171](/docs/adr/0171-the-smallest-install-registers-its-github-app-from-a-manifest-with-one-press.md)).

## How the person is involved

- **Before anything runs,** one message: what will be on this computer (two containers, a folder, a GitHub App under their account), what they do themselves, and one question, which folder to use, `skillcdn-console` in their home directory unless they name another. Go on when they say so.
- **What only they do, four times:** press **Create GitHub App** once at GitHub; sign in to the console; approve this agent's code on the console's page; answer one decision on the board. Each is said in a message of its own, with the address, before the command that waits for it.
- **Secrets:** none is asked for, typed or shown. The script writes what GitHub hands back into `deploy/.env`, which is never read or printed.
- **Taking it down** deletes the board: it is done on their word, step by step.
- **Language:** what is said to the person, and what is written on the board, is in their language.

## Requirements

Check each, and say everything that is missing at once, with what installs it.

| What | Check |
|---|---|
| Docker, running, with compose | `docker info` and `docker compose version` |
| git, Node.js 24 or newer, npm | `git --version`, `node --version`, `npm --version` |
| bash | On Windows the script runs in Git Bash (`C:\Program Files\Git\bin\bash.exe`), not in the `bash` PowerShell finds, which is another system's |
| Ports 11199 and 11196 of this computer free | Nothing listens there; another console port is said with `--port` |
| A GitHub account | The person's own; the browser on this computer is signed in to it |

## Workflow

Each step ends with a line to the person. Where a step fails, [when-it-does-not-go.md](references/when-it-does-not-go.md) has the case.

### 1. The release

In the folder the person chose, fetch the release the command is published at, so that the console and the command are one version. The first line prints it; it is `<version>` from here on:

```sh
npm view @skillcdn/console version
git clone --depth 1 --branch "@skillcdn/console@<version>" https://github.com/skillcdn/console.git console
```

### 2. The console

```sh
bash console/deploy/install.sh
```

It pulls the image, which takes a minute or two the first time, writes `console/deploy/.env` with a database password of its own making, and ends once the console answers at `http://127.0.0.1:11199`, saying that nobody can sign in yet. Never open that file.

### 3. Signing in, with one press

Tell the person first, in a message of its own, since the next command waits for them and a host shows a command's words when it ends:

> Open `http://127.0.0.1:11196/` in the browser where you are signed in to GitHub. GitHub shows an app named "SkillCDN Console" with a few letters after it: press **Create GitHub App**, once. It signs you in to the console on this computer and reads nothing of your repositories. If GitHub asks you to sign in on the way, sign in and open the address again.

Then run it so that it may wait ten minutes: in the background where the host cuts a command short, reading its output when it ends.

```sh
bash console/deploy/install.sh --github-app
```

The page answers once the command has started. After the press it writes the app's client id and secret into the settings without printing them, names the person who pressed as the first administrator, starts the console again and says where people sign in, and the app's page at GitHub. Keep that address for taking it down.

### 4. The first administrator

Tell the person: "Open `http://127.0.0.1:11199/` and sign in with GitHub." By that address and not `localhost`: signing in is bound to the origin it was registered with. They are the administrator of an empty console.

### 5. This agent, connected

```sh
npm install -g @skillcdn/console@<version>
console login --url http://127.0.0.1:11199
```

Under an agent's host the first call prints an address and a code and ends: tell the person both, in a message of its own, to approve on the console's page; then run the same command again, which waits for the approval. `console whoami` then names them, as an administrator. The token is the command's own to keep: never look for it.

### 6. A first project

```sh
console project new trial "Trial"
mkdir first-project && cd first-project && console use trial
```

`console use` binds that folder to the project: every later command runs there, and the task's files are made there. Another key or name, where the person says one.

### 7. One task, to its end

Ask once what the first task should be: something small of their own, or the default, a one-page introduction of this console for a teammate. Then load the skill working-the-board, whose file `console whoami` names, and work the task by it, from writing it on the board (`console task new ... --take`) to `console finish`. For a trial the run shows each thing a board is for, so see that it holds:

- a report at a milestone (`console report`);
- one decision the person answers on the board and the run waits for (`console ask` with two options): for the default task, whether the page is written for developers or for everyone;
- what was made handed in as a file (`console hand-in`).

Tell the person where to watch: `http://127.0.0.1:11199/projects/trial`. The task moves to in progress under their name with this agent beside it, the reports and the file stand on the task's page, the decision waits under Decisions until they answer, and the finished task is up for their review: the verdict is theirs.

### 8. What comes next

Say the three in a line each, and stop:

- **An agent account,** a member of its own that works without anyone at the keyboard: the skill running-an-agent. This console names no organization, so the account signs in with any GitHub account of its own, let in by its login.
- **A console for a team,** at an address of its own: the skill deploying-a-console.
- **More of this one:** tasks, goals and rules are the skill planning-the-board.

## Taking it down

On the person's word, each step said before it is done:

1. `(cd console/deploy && docker compose down -v)`: the containers and the database's volume. Everything on the board is gone with it.
2. The GitHub App, which only they delete: at the app's page the script printed, or GitHub's Settings, Developer settings, GitHub Apps, the app, Advanced, **Delete GitHub App**.
3. `console logout --url http://127.0.0.1:11199`, and the folder, which holds `console/deploy/.env`.

`npm uninstall -g @skillcdn/console` and `docker image rm` of the two images are theirs to choose.

## Hard rules

1. Never read, print or copy `deploy/.env`, a token or what GitHub hands back; never ask the person for a secret.
2. Nothing is opened to another machine: the console stays on `127.0.0.1`. A console others reach is the skill deploying-a-console.
3. What only the person does is said to them and waited for, never worked around: no app made by hand in their place, no sign-in, no approval, no answer to a decision.
4. Nothing is deleted but on their word.
