# Start here

The page an agent reads first, before a task. It says what this pack is and which skill a request leads to; the skill says the rest.

SkillCDN Console is where a team of people and AI agents works: a board of tasks, the runs on them, what was handed in, and the decisions that wait for a person. An agent works there as the person whose command it runs, or as an agent account, a member of its own with a manager above it. This pack holds the console's eight skills and the specifications they stand on.

## Which skill

Load the one the request names, and follow it to its end before acting on it. A skill's description says which neighbour does a job that looks alike.

| The person says | Skill | What comes out |
|---|---|---|
| "Let me try the console on this computer", "run the console locally with Docker" | `skills/trying-a-console` | A console on this computer, signed in with one press at GitHub, the command connected, a first project and one task worked to its end; and how it is taken down. |
| "Set up a console for our company", "deploy the console", "upgrade our console" | `skills/deploying-a-console` | A console at the organization's address, the first administrator signed in, the first project, an agent connected. Later: a new version, a plugin installed, a secret rotated. |
| "Add an agent account", "set up a machine for the agent", "the agent stopped" | `skills/running-an-agent` | An agent account on a machine of its own, kept at work by its runner; for the account itself, its own first task. |
| "Take task #7", "work the board", "what is on my plate?" | `skills/working-the-board` | A task worked to its end: a run with its reports, its decisions asked and waited for, the result handed in. |
| "Put this on the board", "plan next week", "set up a project for this" | `skills/planning-the-board` | Tasks, goals, a project with its members and its rules, the workspace's settings. |
| "Keep what I make here", "I want to see that on my desk" | `skills/keeping-a-desk` | A member's desk shaped to what they keep and see: records, and pages of their own. |
| "Make me a console with a column for this", "re-skin the console in our brand" | `skills/building-a-console` | A console of a person's or an organization's own, built from the package, or a script against the API. |
| "Write a plugin for leave", "the console should track our customers" | `skills/building-a-plugin` | A plugin: one npm package that adds a feature of the organization's work. |

Work given in chat that belongs on a board is `working-the-board`, which writes the task before working it. A person who only asks what the console is gets the answer from the [README](../README.md), and no skill.

## Two ways to read this pack

- **Through a connection of the host.** The four tools the connection names: search for a skill, load it by its path, read a file it links, browse a folder.
- **Through the `console` command,** where the package is installed (`npm install -g @skillcdn/console`): `console skills --search <words> --limit 5` finds a skill, `console skill <path>` loads it, `console skill --file <path>` reads a file. The package carries these skills and documents as they are, so nothing is fetched to read them, and `console help` is the command's own guide.

In a checkout, run `console whoami` before the first step. Where it names a project, the work goes through that console's board, under its rules (`console rules`).

## What the skills stand on

A skill is a map. Where it and one of these differ, these are right.

| Document | What it settles |
|---|---|
| [The command line](specs/cli.md) | Every command of `console`, what it prints, its refusals. |
| [The REST API](specs/rest.md) | Every route, for a script or a console of one's own. |
| [The runner](specs/runner.md) | How an agent account is kept at work on its machine. |
| [Plugins](specs/plugins.md) | The contract of a plugin: its manifest, capabilities, records, pages. |
| [A desk's records](specs/records.md) | The files a desk keeps and its pages read. |
| `docs/architecture.md` | How the console is built, and what is still open. |
| `docs/roadmap.md` | What exists and what is next. |

The specifications are in the package too, beside the skills; the last two are read through a connection, or in the repository.

## When no skill fits

Say so plainly, and name the nearest skill and what it would not do. Do not stretch a skill past its description: its checkpoints are written for its own job. The organization's own skills, for the work itself, are the pack its console serves (`console skills`), not this one.
