---
name: running-an-agent
description: "Sets an agent account of a SkillCDN Console up on a machine of its own and keeps it running: the account and its invitation, the machine given its least from one line, the agent's own first task, and what its manager does when it could not go on. Use when a person says 'add an agent account', 'set up a machine for the agent', 'the agent stopped', 'the agent is not heard from', or when an agent account reads its own setup; not for an agent that works for a person with that person's token, which is working-the-board, nor for a person's own desk, which console desk writes."
license: MIT
compatibility: Needs the console command (npm install -g @skillcdn/console, Node.js 24 or newer). The service that keeps a runner running is written for macOS, for Linux and for Windows; on another system the runner is started by hand. An agent product, Claude Code or Codex, signed in with the agent's own subscription.
metadata:
  author: skillcdn
  version: "1.22"
skillcdn:
  translations:
    ko:
      title: 에이전트 계정 운영하기
      description: "SkillCDN 콘솔의 에이전트 계정을 전용 머신에 올리고 계속 운영합니다. 계정과 초대, 한 줄로 최소한만 준비하는 머신, 에이전트가 스스로 하는 첫 작업, 그리고 에이전트가 멈췄을 때 매니저가 할 일을 다룹니다. '에이전트 계정 추가해 줘', '에이전트 머신 설정해 줘', '에이전트가 멈췄어', '에이전트 소식이 없어'라고 말하거나 에이전트 계정이 자신의 셋업을 읽을 때 사용합니다. 사람의 토큰으로 그 사람을 위해 일하는 에이전트는 working-the-board를 사용하고, 사람 자신의 데스크는 console desk가 씁니다."
---
# Running an agent account

An agent account is a member of the console of its own ([ADR-0084](/docs/adr/0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md)): it signs in as itself, works under the rules every member works under, reports to a manager, and is never an administrator. It runs on a machine, in an OS account of its own, where the console's runner keeps one session of its product going and feeds it what the console sends ([the runner](/docs/specs/runner.md)). Four have a part in it:

- **The administrator** makes the account and its invitation.
- **Whoever prepares the machine**, a person and the session they give one line to, gives the machine its least and stops ([ADR-0140](/docs/adr/0140-a-machine-is-given-its-least-and-the-agent-does-the-rest-itself.md)).
- **The agent** does everything after that itself, as its first task.
- **The manager** answers what is asked of them, and looks when the agent could not go on.

Read the part that is yours. What was not seen run yet is said at the end. A person has a desk too, which is not this skill's: `console desk` writes it ([the command](/docs/specs/cli.md#a-desk-of-ones-own)).

## How the person is involved

- **Questions:** which account (its handle), and for a new one what it is called, what it does, whom it reports to and the project it starts in. The services are read from the workspace (`console workspace`).
- **Checkpoints:** making the account, and the invitation, are said before they are done, since the account's login is let in at once. Who makes an account at a provider is the organization's to say: ask, and never assume.
- **Secrets:** never in a chat, a file of the desk, a task or a report. A person signs in themselves, in the machine's browser. An account's secrets live in its store in the console (`console secret`), which only the account reads; a supervisor seeds one write-only, from their own machine (`console agent secret`).
- **Language:** what people read is in their language; the guide, the task and this skill are in English, as the agent reads them.

## The administrator: the account and the invitation

1. **Make the account.** On the Agents page, "Add an agent account", from a few proposals; or `console agent new <handle>` with what `console help agent` lists. What has to be right is the account it signs in with: an address at Google Workspace or a login at the git host, put together from the workspace's services. At Google Workspace it need not be there yet, and has to be before the machine is set up. At a git host it has to be there first, a member of the organization: a login there goes to whoever registers it, so the console asks the organization which account the login is as the agent account is added. Read what the answer says: "confirmed" is that; "not confirmed" means the account is let in only once it is a member, or that this console reads no organization at the host and whoever holds the login is let in. A login a member signs in with already is refused unless you say that the member is to become the account (`--convert`), which is for good. The console makes the account's first task with it, "Set up @<handle>", in the project it starts in.
2. **Make the invitation.** On the account's Settings, "Its machine", or `console agent invite <handle>`. It prints one line, once. The code in it is no credential: it says which account a setup is for and opens the guide, for seven days or until the account's command has signed in; `--revoke` takes it away. A person reads the guide whole at `/setup/<code>`, with no sign-in.
3. **Hand the line to whoever prepares the machine.** Nothing else: no password of yours, no token, and never your own sign-in on the agent's machine.

## Preparing the machine

**The person's part** is what only a person does:

1. **An OS account for the agent,** apart from anyone's, on a machine that stays on. Whether it holds an administrator's rights is for whoever keeps the machine to say: an agent that is to install and update what it needs usually does.
2. **Logged in when the machine starts.** The runner is the OS account's own service, which needs no administrator: a launch agent on a Mac and a scheduled task on Windows, which run while the account is logged in, so set the machine to log it in; on Linux a unit of the account's own systemd, which starts with the machine once lingering is on (setup asks for it, and says where an administrator has to: `sudo loginctl enable-linger <account>`).
3. **The product, signed in with the agent's own subscription,** in that OS account: Claude Code, Codex, or another that speaks the Agent Client Protocol.
4. **The line,** said to a session of the product there. Then sign in when asked, yourself, in the browser the command opens. Never write a password in the chat.

**The session's part** is the machine's least. The line says to install what is missing without asking, Node.js 24 or newer and the command first, and to run `console agent setup --console <origin> --code <code>` ([the command](/docs/specs/cli.md#setting-a-machine-up)), which:

1. **Looks at the machine first** and says everything that is missing at once, with what installs it: git (on a Mac the Command Line Tools, without which `git` only opens a window), the product's command, and for Claude Code Google Chrome, which its browser tool works in. Install each, without asking, and run the line again. The Claude in Chrome extension is installed in that browser too, signed in as the agent's subscription account; `--no-browser` is for an agent that signs in at no page, and `--driver` names the product where both are there.
2. **Asks to be signed in as the account.** It opens the console in the machine's browser and waits. Say to the person at the machine which login to sign in as and the code the page must show: they sign in themselves, and say that it is them. A sign-in that is anyone else's is given up, and nothing is set up.
3. **Settles the desk,** `desk` in the OS account's home: one that is there is left as it is, one the account pushed before is cloned, otherwise the template is written ([the desk](/docs/specs/runner.md#the-desk)), its `runner.json` naming the product and the browser found. The desk's git is set to read `git.token` from the account's store when the git host asks, so nothing is typed and no keychain keeps a copy.
4. **Writes the service, starts the runner,** waits for the agent's first session, and says where to watch it. The runner holds the machine awake while it runs, with no setting changed, and its own lines say whether that holds; a lid that is closed or a sleep someone asks for still ends it.

**Then stop.** The agent's sign-ins, its tokens, its desk's repository, its profile and its messenger are the agent's own, done in its own session with its own instructions: a session at the machine that goes on does them twice and worse. What you change on the machine afterwards, say to the agent: `console agent wake me "<what changed>"`.

## The agent: your first task

Your first wake is your onboarding task, "Set up @<handle>". Take it and work it as any task ([working-the-board](/skills/working-the-board/SKILL.md)); it lists what you do, in the words of your workspace's services. What it rests on:

- **Sign in at pages in the machine's own browser,** with a browser tool of your product that attaches to it: a sign-in stays there from one session to the next. For Claude Code that is Google Chrome with the Claude in Chrome extension, turned on by `"browser": "chrome"` in `runner.json`. Where a sign-in wants a person, a code sent to a phone or a picture to solve, ask for a person to sign in inside your session, as a decision or at the messenger, and say which service and which account.
- **A secret goes from where it is made into your store, and nowhere else.** `console secret <name> --set` reads it from a pipe: generate a password in the shell, or copy a token with a key press in the page, and pipe the clipboard in (`pbpaste | console secret <name> --set` on a Mac), then empty the clipboard. Never print one, and never read it off the screen. A page's own "Copy" button may not reach the clipboard: select the field and copy with the keys. The command says when a value does not look like what its name holds; a token whose value was lost is regenerated where it was made, not deleted. A second step you can answer yourself, a one-time-code key, is a secret of your store too.
- **Your desk is a repository at your git host.** Keep the token that reads and writes it as `git.token`, make the repository, private, and push. The desk's git takes the token from your store by itself; never put it in the remote's address or a file. From then on the runner commits and pushes the desk at the end of every session, a net under your own commits (`autosave`).
- **Your profiles carry your name and your role,** as any member's do, and your picture (`console agent <handle> --avatar <file>` writes it) ([ADR-0143](/docs/adr/0143-an-agent-accounts-profiles-say-its-name-and-its-role.md)).
- **Be woken by the messenger.** Add its own MCP server to your product, for reading and writing there. For waking, make an app of your own from [the manifest](references/slack-app.md), keep its app-level token as `slack.app_token`, and add `"slack"` to `wake` in `runner.json`. The runner takes the change once your turn is over; `console agent <handle>` then says the source is connected. A direct message and a mention of you reach you as wakes; answer a direct message in the conversation, and in its thread only where it was written in one.
- **Record the accounts you hold elsewhere,** what you are called there and never a secret: `console agent <handle> --account <service>=<name>`.

What you cannot do yourself, you ask as a decision (`console ask`), of whoever can do it and of your manager where you do not know who, with the exact values and what to hand back; then go on with the rest. The answer wakes you, and you go on with the run that asked (`--run <id>`). The task is finished when nothing of it waits on anyone. Your own address is the one you sign in to the console with, where that is an address; where it is a login at a git host, ask which address an invitation is to go to, and make none up.

## The agent: working as an account

- **Your day.** At its start the console sends your briefing: the tasks planned for today and those carried over, how many are open with no day, how many decisions wait; on the week's first day, the week's; at its end, where you keep one, a wrap. `console agent <handle> --day-start <HH:MM> --day-end <HH:MM>` keeps the hours; `console work` is your whole plate.
- **Coming back to something.** `console agent wake me "<what for>" --in <minutes>`, or `--at <HH:MM>`, keeps a wake for later, one under a name (`--key`); `console agent signals me` lists what you keep, and `--cancel` takes one away ([ADR-0145](/docs/adr/0145-an-agent-account-wakes-itself-now-or-at-a-moment-to-come.md)). Use it for what you must look at again, never to keep yourself busy.
- **Beginning anew.** Your conversation goes on from session to session, and your product compacts what grows long. Where a large piece of work is done, or the conversation is full of what the next task has no use for, put what must go on where the next conversation finds it, on the board, in your desk or in your product's memory, and then `console agent reset me "<why>"` ([ADR-0154](/docs/adr/0154-an-agent-account-begins-a-new-conversation-for-itself-when-its-turn-is-over.md)). When your turn is over your session ends, and the next begins at once with a new conversation: its first message says that you began it and what to read first, and carries your words, which are also what your manager reads on your record. Nothing else crosses. At a break in the work, never in the middle of a task, and six within an hour at the most; while a supervisor's stop stands it is refused.
- **Your desk.** Whatever should outlive the machine lives there, and its `AGENTS.md` says how you work: keep it true. Something new to keep or to show is shaped as the skill keeping-a-desk says, which `console help desk` names with its place. A project's repository is cloned under `work/<name>` and worked there by its own agreement, which you read before the first change.
- **`runner.json` is yours.** It names your product's driver, the wake sources, the secrets a session is handed, the browser of your browser tool and the permission mode. The runner takes a change by itself between two turns, with the same conversation ([ADR-0144](/docs/adr/0144-a-runner-takes-its-runner-json-as-it-changes-and-says-how-its-wake-sources-stand.md)); where the file does not read, it tells you what is wrong and goes on with what it had. Naming another driver begins a new conversation, since a conversation is a product's own.
- **Keep the command current.** Install an update of `@skillcdn/console` the way the command was installed; `console --version` says which way that is. Your runner sees the new version within a minute and starts again with it between two turns. Where the console refuses your runner as too old, the runner tells you the command that installs the version it takes.
- **When the console says the services changed,** run `console agent setup --refresh` in your desk and put your `AGENTS.md` right; `--refresh` writes over no file that is there. When it says a secret's day is near, renew what it holds where it was made, and set it again with its new day.
- **What your product may do without asking** is the permission mode it runs in, in the product's own word. Where `runner.json` names none, the runner starts each product in its mode for a run nobody attends ([the runner](/docs/specs/runner.md) says each); `permissions` names another, which whoever prepares the machine chooses, as they choose whether your OS account may use `sudo`. What the mode does not allow is denied and shows in your transcript: ask for it as a decision.

## The manager: when the agent could not go on

The account's page, Agents, then the account, shows how it stands, what it is doing as it happens, its sessions, its plate and its settings, the wake sources its runner keeps among them; `console agent <handle>` says the same in a few lines, and `console agent signals <handle>` what it was sent and what it keeps for later.

| It stands as | What it means | What to do |
|---|---|---|
| `stopped` | A supervisor stopped it; nothing reaches it | `console agent restart <handle>` goes on with its conversation |
| `refused` | Its model would not answer | Say it otherwise (`console agent tell <handle> "<words>"`), or choose another model or effort (`console agent set <handle> --model <name>`): what a supervisor sends is tried at once, in the same conversation |
| `failed` | Its product could not go on: not signed in, or it did not start | Mend what the reason says, the product's sign-in on its machine for `sign_in`, then `console agent restart <handle>` |
| `unheard` | Its runner said nothing for five minutes | Look at the machine: is it on and awake, is the OS account logged in. The runner's own lines are in `~/Library/Logs/ai.skillcdn.console.runner.log` on a Mac, in the account's journal on Linux (`journalctl --user -u skillcdn-console-runner.service`), and in `~\AppData\Local\skillcdn-console\runner.log` on Windows |

`console agent interrupt <handle> "<words>"` stops what it is doing first, and without words has it read now what it was told and has not come to; `console agent stop <handle>` ends its session until it is started again; `console agent reset <handle>` starts it with a new conversation, at once and whatever it is at, the last thing to try. An agent begins a new conversation itself where its work has a break (`console agent reset me`), once its turn is over: its record says so with why, and its page shows its words while they wait for the turn and at the head of the session that follows. To have a conversation end at the turn's end and not in the middle of it, tell the agent so. Every signal is on the account's record, with who sent it.

Taking an account out is deactivating its member on the People page. Its page lists the accounts it holds elsewhere, which are what to close, and where it is signed in, which a supervisor ends. An account whose git-host account is a member of the organization the console admits by is out when the organization takes it out (`person.of_organization`); what works at once meanwhile is `console agent stop <handle>` and ending its sessions on its page.

## What was not seen run yet

On 2026-11-20 an agent account was set up on a Mac from the invitation's line and worked a day against a live console: the `launchd` service, the `claude` driver with Claude Code 2.1.329 and its browser tool, a desk pushed with the account's own token, and the `slack` wake source. What that day asked for is in this skill and was written after it, tested against invented fixtures and not yet run on a machine: the look at the machine before the sign-in, the desk's git reading the store, what a setup ends with, the helper that holds a Mac or a Linux machine awake (the one for Windows was run on Windows 11), a `runner.json` taken while the runner runs, and a wake kept for later. So is a new conversation an agent begins for itself, built since. Also not seen: a desk cloned with the account's token on a second machine, an account logging on to Windows after a restart, and any product behind the `acp` driver but the adapters of Codex and Claude Code. Codex takes no message while a turn runs: what you are told then is read when the turn ends. [The roadmap](/docs/roadmap.md) lists each as open. Where one of them does not behave as this skill says, the specification and what the machine shows are right: say so in a report, and tell the manager.
