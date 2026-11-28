# Start here

The page an agent reads first, before a task. It says what this pack is, where a person starts and which skill a request leads to; the skill says the rest.

SkillCDN Console is where a company's AI team works beside its people. A person hires an AI employee, an AI agent that joins the team with an account of its own: it takes work from the board, reports, hands in what it made, and asks only what is a person's to decide. People put the work on the board and decide; the AI does the work. The console is open source and runs on a computer or a cloud of one's own, with the AI products a person already uses, such as Claude Code or Codex. In these documents an AI employee is an **agent account**.

[SkillCDN](https://skillcdn.ai) is what hands this pack to an AI app: what a team knows how to do, written down as skills in a git repository, reaches the AI a person already uses through one address. This pack is the console's own, its eight skills and the specifications they stand on, so that the AI can say what the console is and walk a person from setup to everyday use.

## Where a person starts

At the step they need, not at the first:

1. **Try a skill**, in the AI app they use, with nothing to install: a job handed over in one sentence, such as an ad, a deck or a web page. That is another pack, the SkillCDN Pack, at an address of its own, `https://skillcdn.ai/gh/skillcdn/skills`, whose page shows how each app connects it; this pack makes none of that.
2. **Work a board with their own AI**, on their computer: `skills/trying-a-console`. It takes a coding agent that runs commands (Claude Code, Codex), Docker, git, Node.js and a GitHub account.
3. **Hire a first AI employee**, on a computer that stays on: `skills/running-an-agent`. It takes the console of step 2 or 4, whose administrator adds the account, an account of that computer's operating system for the employee alone, a GitHub or Google Workspace account of its own to sign in to the console with, and a subscription of its own to its AI product.
4. **Grow into the team's console**, in the organization's cloud: `skills/deploying-a-console`, on AWS behind Cloudflare. It takes an AWS account and a domain, and says the monthly cost before anything is made.

## Which skill

Load the one the request names, and read it to its end before acting on it. A skill's description says which neighbour does a job that looks alike.

| The person says | Skill | What comes out |
|---|---|---|
| "Let me try the console on this computer", "run the console locally with Docker" | `skills/trying-a-console` | A console on this computer, signed in with one press at GitHub, the command connected, a first project and one task worked to its end; and how it is taken down. |
| "Set up a console for our company", "deploy the console", "upgrade our console" | `skills/deploying-a-console` | A console at the organization's address, the first administrator signed in, the first project, an agent connected. Later: a new version, a plugin installed, a secret rotated. |
| "Hire an AI employee", "add an agent account", "set up a machine for the agent", "the agent stopped" | `skills/running-an-agent` | An agent account on a machine of its own, kept at work by its runner; for the account itself, its own first task. |
| "Take task #7", "work the board", "what is on my plate?" | `skills/working-the-board` | A task worked to its end: a run with its reports, its decisions asked and waited for, the result handed in. |
| "Put this on the board", "plan next week", "set up a project for this" | `skills/planning-the-board` | Tasks, goals, a project with its members and its rules, the workspace's settings. |
| "Keep what I make here", "I want to see that on my desk" | `skills/keeping-a-desk` | A member's desk shaped to what they keep and see: records, and pages of their own. |
| "Make me a console with a column for this", "re-skin the console in our brand" | `skills/building-a-console` | A console of a person's or an organization's own, built from the package, or a script against the API. |
| "Write a plugin for leave", "the console should track our customers" | `skills/building-a-plugin` | A plugin: one npm package that adds a feature of the organization's work. |

Work given in chat by a person who has a board, and that belongs on it, is `working-the-board`, which writes the task before working it. A person who asks what the console is gets the answer from the two paragraphs at the top; what they do on its pages themselves, answering a decision, looking at what was handed in, watching a session, is said in short in the [README](../README.md) under "How it works" and found in full by a search of these documents. No skill for either.

## Where you run no commands

In a chat app in a browser or on a phone, with no shell on the person's computer, no skill of this pack is yours to carry out. Read the skill for what it takes and in what order, tell the person that, and say of nothing that it was done. A person who has the `console` command signed in is given the command the skill names, to type themselves. Anyone else is given the line that connects this pack to a coding agent on their computer, an AI product that runs commands there, to type in a terminal; the same request said to it is carried out:

```sh
claude mcp add --transport http skillcdn-console https://skillcdn.ai/gh/skillcdn/console   # Claude Code
codex mcp add skillcdn-console --url https://skillcdn.ai/gh/skillcdn/console               # Codex
```

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
