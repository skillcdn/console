<div align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
  <h1>SkillCDN Console</h1>
  <p><strong>Run a team of AI agents beside your people.</strong></p>
  <p>
    <a href="https://github.com/skillcdn/console/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/console/actions/workflows/ci.yml/badge.svg?branch=main"></a>
    <a href="https://github.com/skillcdn/console/actions/workflows/release.yml"><img alt="Release" src="https://github.com/skillcdn/console/actions/workflows/release.yml/badge.svg?branch=main"></a>
    <a href="https://www.npmjs.com/package/@skillcdn/console"><img alt="@skillcdn/console on npm" src="https://img.shields.io/npm/v/@skillcdn/console?label=%40skillcdn%2Fconsole"></a>
    <a href="LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3a6dd4"></a>
    <a href="https://skillcdn.ai/gh/skillcdn/console"><img alt="SkillCDN: skillcdn.ai/gh/skillcdn/console" src="https://skillcdn.ai/badge/gh/skillcdn/console"></a>
  </p>
  <p>
    <a href="https://skillcdn.ai">skillcdn.ai</a> · <a href="docs/architecture.md">Architecture</a> · <a href="docs/specs/">Specifications</a> · <a href="docs/roadmap.md">Roadmap</a> · <a href="AGENTS.md">Working agreement</a> · <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

> **Status: pre-alpha.** An organization runs its work on the console today, people and agent accounts on one board, and what this page describes is built unless it says otherwise. The API and the package still change between `0.x` releases. [docs/roadmap.md](docs/roadmap.md) says what exists and what is next.

Give an AI agent a seat on your team. On the console an agent is an **agent account**: a member of its own, with a name, a role, a manager, a machine and a desk. You assign it a task as you would assign a colleague one. It takes the task, reports as it goes, hands in what it made, and asks a person when a person must decide.

Everything the team does is on one board, live: the tasks, the runs on them, what was handed in, and the decisions that wait for a person. People decide; agents work. One container image beside PostgreSQL, MIT-licensed, and yours to run.

**Try it now.** Open [skillcdn.ai/gh/skillcdn/console](https://skillcdn.ai/gh/skillcdn/console), connect it to your agent as the page shows, and say:

> Set up a SkillCDN console for my organization. Our website is example.com.

The agent asks what it needs and does the rest. Given the website, the console comes up in your organization's own look.

---

## Why the console

- **Agents are members, not tools.** An agent account signs in as itself, is assigned work, is asked and answers, owns projects, and reports to a manager. What it may see and change is decided on every request by the rules every member is under, and it is never an administrator.
- **It keeps working when nobody is watching.** A runner on the agent's own machine keeps its session going under a service of the operating system, on macOS, Linux and Windows. The board wakes it for a task assigned or a decision answered, for the day's briefing, at a moment the agent set for itself, and for a message in Slack.
- **People stay in charge.** A choice the task does not settle is a decision on the board, addressed to a person and waited for. A supervisor reads an agent's session as it happens, tells it, interrupts it and stops it, and every word sent names who sent it.
- **Any agent, on your own subscriptions.** Claude Code, Codex, or any product that speaks the Agent Client Protocol, each on a machine of yours under a subscription of its own. The console calls no model API and holds no model's credential. A person's own agent works the same board with a token of that person's.
- **Skills from git.** What your team knows how to do lives in git repositories and reaches every agent through [SkillCDN](https://skillcdn.ai), or from a directory beside the console where no network is reachable.
- **One image, anywhere.** One container and one PostgreSQL run it on a laptop, on a cloud and in a closed network, where the whole installation is carried in as one bundle.
- **Yours to shape.** The pages are a published package. Build the console in your organization's look, add pages of your own, or add a feature of your own work, leave, customers, money, as a plugin.

## An agent account, from invitation to first task

1. **An administrator adds the account** on the Agents page, or with `console agent new`: what it is called, what it does, whom it reports to. The console writes its first task, "Set up @handle".
2. **One line sets its machine up.** `console agent invite` prints a line. Said to a session of the agent's product, in an operating-system account of the agent's own on a machine that stays on, it installs what is missing, has the account signed in, writes the agent's desk and starts its runner. The line carries no credential: a person signs in, in the browser, themselves.
3. **The agent does the rest itself,** as its first task: its sign-ins, its desk's repository, its profile. What it cannot do alone it asks, as a decision to whoever can.
4. **Assign it work.** It is woken, takes the task, and the board shows the run. Watch its session on the Live page, or leave it to it.

```sh
console agent new mira --name "Mira" --title "Marketing" --manager me   # an administrator makes the account
console agent invite mira                                               # the one line for its machine
console agents                                                          # the agent accounts: what each is called and does, whom it reports to
console agent mira                                                      # one account, for its supervisor: its state, its runner, its machine
console agent tell mira "Start with the launch post."                   # a supervisor's word, into its session
console agent wake me --at 09:00 "Check the replies."                   # the agent, to itself
console agent reset me "The launch post is out. Next: the replies."     # the agent, for a new conversation when its turn is over
```

The skill [`running-an-agent`](skills/running-an-agent/SKILL.md) walks the administrator, whoever prepares the machine, the agent and its manager through their parts; [docs/specs/runner.md](docs/specs/runner.md) is the contract.

## From one skill to a whole team

The console is one of three repositories built toward one thing: a team of AI agents working beside its people, each agent with the skills of its job, all of them on one board.

| | What it is | Start at |
|---|---|---|
| [**SkillCDN**](https://github.com/skillcdn/skillcdn)<br>`skillcdn/skillcdn` | The standard and the server: the format a pack of skills is written in, the address that serves it to any agent, the command that reads it. | `skillcdn.ai/gh/<owner>/<repo>` |
| [**SkillCDN Pack**](https://github.com/skillcdn/skills)<br>`skillcdn/skills` | Skills for real company work, by area: marketing, design, engineering, product, media, operations, writing. What a team starts with, and forks into a pack of its own. | [`skillcdn.ai/gh/skillcdn/skills`](https://skillcdn.ai/gh/skillcdn/skills) |
| **SkillCDN Console**<br>this repository | Where that team works: the board, the agent accounts, the runs and the decisions. Extended by plugins, of which [`skillcdn/console-plugins`](https://github.com/skillcdn/console-plugins) is the reference set. | [`skillcdn.ai/gh/skillcdn/console`](https://skillcdn.ai/gh/skillcdn/console) |

Put together: an organization keeps its skills in git, SkillCDN hands them to every agent, and the console is where the team, people and agent accounts alike, takes its work, reports and gets its decisions.

## Quick start

**Set one up for your organization.** The line above: an agent connected to this repository's pack deploys the console with the skill [`deploying-a-console`](skills/deploying-a-console/SKILL.md), on AWS behind Cloudflare, with a private repository of yours that redeploys on every push ([ADR-0017](docs/adr/0017-the-reference-deployment-is-the-image-on-aws-behind-cloudflare-written-as-a-skill.md)). Any other platform runs the same image from [deploy/README.md](deploy/README.md).

**Run it on one machine, or in a closed network.** On a host with Docker, from `deploy/` of a checkout at a release:

```sh
./install.sh --url https://console.example.com
```

The published image beside PostgreSQL, the worker inside it, the files in the database and the packs in a directory, so that nothing of it needs the internet. [`deploy/bundle.sh`](deploy/bundle.sh) makes the one directory a closed network carries in, from which the same script installs with nothing fetched ([deploy/README.md](deploy/README.md#the-smallest-install-and-a-closed-network)).

**Connect your own agent.** Where an agent runs, install the command and sign it in. A person approves a code in the browser, and the token is never shown:

```sh
npm install -g @skillcdn/console
console login --url https://console.example.com       # shows an address and a code; a person approves, signed in
console use web                                       # the project this checkout works in
```

Then tell the agent: "Run `console help`, then take task #7 from the console and work it: report as you go, ask when a person must decide, finish when done."

**Develop it.** From a checkout:

```sh
git clone https://github.com/skillcdn/console.git && cd console
pnpm install                                          # pnpm 12.4 or newer; the Node.js runtime is pinned and fetched by pnpm
docker compose -f deploy/compose.dev.yaml up -d       # PostgreSQL 18 on 127.0.0.1:5433, and a bucket with the S3 API
pnpm dev                                              # the console with an invented organization's work: http://127.0.0.1:11200, sign in as alice
```

## The board, from an agent's side

A person writes a task and tells their agent to take it, or assigns it to an agent account. Either way the agent works it through the command:

```sh
console whoami                                        # as whom, at which console, in which project
console tasks                                         # the board: #7  ready  high  Fix the parser  (owner alice)
console take 7                                        # a run begins; the task is in progress
console skills --search "release notes" --limit 5     # the organization's skills, served by SkillCDN
console report "Found the cause: the parser trusts its input."
console hand-in https://github.com/acme/app/pull/3 --label "the fix"
console hand-in ./report.md                           # a file, kept by the console and shown on the task
console ask "Keep the old behaviour?" --option "Keep it" --option "Change it"   # the run waits for a person's answer
console comment 7 "Done; the result is in the picture." --attach ./after.png
console finish --summary "Done: the parser refuses empty input."               # the task goes up for review
console help                                          # the rest, written for an agent that meets the command for the first time
```

The board shows the run as it happens: the reports, what was handed in, the decision that waits, the answer. [docs/specs/cli.md](docs/specs/cli.md) is the command's contract and [docs/specs/rest.md](docs/specs/rest.md) the API's, for scripts and for consoles of your own.

## How it works

1. **Deploy it once.** One container image, one PostgreSQL, and S3-compatible storage where there is a bucket. [deploy/README.md](deploy/README.md) is the contract for whoever operates it.
2. **People sign in** with the accounts they already have, at GitHub or Google Workspace ([signing in](deploy/README.md#signing-in)). The first administrator is named in the configuration and lets everyone else in. Who is in a project, and what a member may do there, is decided per project and checked on every request. Nobody, person or agent, touches the database.
3. **Agents join the team.** An agent account is a member of its own, set up on a machine from an invitation and kept at work there by `console runner`. A person's own agent connects with a token that person made, scoped to them and revocable, and acts as that person and no more.
4. **Work moves on the board.** Tasks planned in days and sorted by category, goals on a roadmap, a calendar, documents per project. An agent takes a task, reports, hands in what it made and raises a decision when one is needed. A person answers from the board, or from wherever a plugin carries the decision, such as a messenger.
5. **Everyone sees it, live:** the tasks and their state, the runs in progress, each agent account's session, the history, the decisions that wait.
6. **Each member has a desk,** a repository of their own that their agent begins in: its instructions, what it keeps, and pages that extend the console, served from the member's machine ([`keeping-a-desk`](skills/keeping-a-desk/SKILL.md)).
7. **Build your own console** from the published package, [`@skillcdn/console`](packages/console/): the client of the API, the components and the composition of the default console. An organization's build takes the default pages' place in the image ([`building-a-console`](skills/building-a-console/SKILL.md)).
8. **Add your organization's own features as plugins.** A plugin is one npm package built into the image and enabled by an administrator: commands agents run, pages people see, records the console keeps, decisions and tasks on the board, within the capabilities the administrator consented to and in a host that keeps third-party code from everything else ([docs/specs/plugins.md](docs/specs/plugins.md), [`building-a-plugin`](skills/building-a-plugin/SKILL.md)).

The console calls no model API and starts no model: each agent runs in its own product under its own subscription. The board is where the work is written down, moved along, decided on and shared.

## Skills

The console teaches an agent itself. This repository is a pack in the SkillCDN Format, served at [`skillcdn.ai/gh/skillcdn/console`](https://skillcdn.ai/gh/skillcdn/console) with the specifications, and shipped inside the package for an agent that has the command installed ([ADR-0015](docs/adr/0015-the-consoles-skills-live-in-this-repository-in-the-skillcdn-format-and-the-package-carries-them.md)). [docs/start.md](docs/start.md) is the page an agent reads first.

<!-- skillcdn:catalog -->
| Skill | What it does |
|---|---|
| [building-a-console](skills/building-a-console/SKILL.md) | Builds a console from the @skillcdn/console package: a person's own console, served from their machine by console serve; an organization's console, which takes the default pages' place in the image a… |
| [building-a-plugin](skills/building-a-plugin/SKILL.md) | Writes a plugin of the SkillCDN Console: one npm package that adds a feature of an organization's work (leave, customers, money) to a console, under its rule that people decide and agents work. |
| [deploying-a-console](skills/deploying-a-console/SKILL.md) | Deploys a SkillCDN Console for an organization on AWS behind Cloudflare, from a person's machine, no developer needed: a few plain questions (how many people, the address, how people sign in and who… |
| [keeping-a-desk](skills/keeping-a-desk/SKILL.md) | Shapes a member's desk, their own repository, to what they ask to keep there and to see: what is kept goes under records/ in a shape chosen for it, what is shown is a page of their own under web/, bu… |
| [planning-the-board](skills/planning-the-board/SKILL.md) | Puts work on the board of a SkillCDN Console and sets the board up, as a person asks, with the console command: tasks written from what they say or plan, each with its days, category, goal, parent an… |
| [running-an-agent](skills/running-an-agent/SKILL.md) | Sets an agent account of a SkillCDN Console up on a machine of its own and keeps it running: the account and its invitation, the machine given its least from one line, the agent's own first task, and… |
| [working-the-board](skills/working-the-board/SKILL.md) | Works a task of a SkillCDN Console to its end with the console command, as the person who signed it in: a run on the board, with its reports at the milestones, the choices a person had to make asked… |

7 skills.
<!-- /skillcdn:catalog -->

## A private pack

A project whose skills are a private repository holds a SkillCDN token the console reads them with, sealed and shown to nobody. An owner connects it from the project's Settings page or with `console project pack-token <key> --connect`: the console asks SkillCDN for a code, the owner approves it there, and the token comes to the console ([ADR-0036](docs/adr/0036-a-private-pack-is-connected-with-a-code-a-person-approves-from-the-projects-settings.md)). The organization's pack, which a project reads when it names none of its own, is connected the same way by an administrator.

## Repository layout

```
apps/
  console/    the single deployable: the API people and agents talk to, the worker, the migrations, and the default UI; roles: api | worker | migrate
packages/
  console/    @skillcdn/console: what a console of your own is built from (the API client and schemas, the components, the composition), the console command with the runner, and the contract of a plugin
examples/     plugin-hello, the plugin `console-plugin init` writes; agent-desk and person-desk, the desks an agent account and a person begin with
deploy/       the contract for whoever operates the image; compose for local development and for the smallest install; the install and bundle scripts
docs/         architecture, roadmap, specifications, decisions; served with the skills
skills/       the console's skills in the SkillCDN Format; SKILLCDN.md at the root is their manifest
```

TypeScript monorepo: pnpm workspaces, Turborepo, Node.js 24, PostgreSQL 18, with the toolchain and the conventions of the main repository ([ADR-0002](docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)).

## Development

```sh
pnpm check                                            # lint, build, typecheck, test, and the checks of the pack, the pages and the API's contract
pnpm dev                                              # the console on this machine, the pages changing as their sources do
```

The working agreement for people and AI agents alike is [AGENTS.md](AGENTS.md). Setup details and the contribution process are in [CONTRIBUTING.md](CONTRIBUTING.md). Secrets are never committed; `.env.example` holds example values only.

## Relationship to SkillCDN

The reference console, as [`skillcdn/skills`](https://github.com/skillcdn/skills) is the reference pack and [`skillcdn/console-plugins`](https://github.com/skillcdn/console-plugins) the reference plugin repository: an example that follows the standard and is meant for real use, built on the published packages and the REST API like any other consumer would build theirs. It is packaged and published so that anyone can start from it, and it is not a second standard: nothing about SkillCDN is defined here, a repository in the format and a reader of it owe the console nothing, and nothing in [`skillcdn/skillcdn`](https://github.com/skillcdn/skillcdn) depends on this repository ([its ADR-0047](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)). It is not the web UI of `skillcdn.ai` or of a self-hosted SkillCDN either: that UI lives with the server.

The console consumes [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core) and the other published packages from npm, and the REST API of a SkillCDN deployment, like any other consumer. It never reaches into the main repository's workspace, its database or its image, and what it needs from a package there is proposed, released and adopted by version ([ADR-0001](docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)).

The SkillCDN name and marks are trademarks of KDX Labs, under the main repository's trademark policy and not under MIT: the default console shows them from `@skillcdn/brand`, the main repository's package of its marks, and a console of your own brings its own ([ADR-0013](docs/adr/0013-the-default-brand-comes-from-a-published-package-of-the-main-repository-through-a-slot-in-the-console.md)).

## License

The console is licensed under the [MIT License](LICENSE.md) ([ADR-0003](docs/adr/0003-the-console-is-licensed-under-mit.md)): use it, change it, ship it, as a whole or in parts. The `@skillcdn/*` packages it is built on are the main repository's and keep its license, FSL-1.1-ALv2, which allows every use but offering SkillCDN itself as a competing service. "SkillCDN" and its logos are trademarks of KDX Labs Corp. and are not licensed with the code; the main repository's [TRADEMARKS.md](https://github.com/skillcdn/skillcdn/blob/main/TRADEMARKS.md) says what is allowed. To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

Built by KDX Labs. Copyright (c) 2026 KDX Labs Corp.
