# ADR-0140: A machine is given its least, and the agent does the rest itself

- Status: Accepted; which browser a setup looks for and a new desk names (points 2 and 6), and what a desk that names none is started with, amended by [ADR-0151](0151-an-agents-browser-is-a-chrome-with-no-window-unless-its-desk-names-the-products-own.md)
- Date: 2026-11-20
- Amends [ADR-0088](0088-an-agent-account-has-a-desk-and-is-set-up-from-an-invitation-by-signing-in-as-itself.md), point 5, in what the invitation's line says, what the command prints of the guide and what it does before and after the sign-in; and the sentence of [ADR-0094](0094-the-account-an-agent-signs-in-with-is-named-and-who-makes-it-is-the-organizations-to-say.md) by which the session at the machine may be handed what the account signs in with.

## Context

An agent account was set up on a new Mac from the invitation's line and worked a day against a live console. What the day showed of the setup:

- **The line assumed a prepared machine.** Node.js, git and the product's command were not there. The session that was given the line asked a person before each install, the runner was started with no product to start, and its first session ended in a second with a line nobody could read a reason from.
- **Two sessions did the same work.** The command printed the whole guide, what the agent does when it starts among it, and the line said "do what it prints". The session at the machine went on into the agent's sign-ins, its tokens and its desk's repository while the agent, awake by then, asked its manager for the same things. The session at the machine has none of the agent's instructions, and did them worse: a token kept under a wrong value, a profile left half done.
- **What the machine lacked went to the manager.** The agent asked for a browser and for git as decisions on the board, which a look at the machine before the sign-in finds.
- **A password went through a chat.** The guide had the session offer to type what the account signs in with; the person wrote two passwords into the chat, the product refused to type them, and both had to be changed.
- **A token was copied into a keychain.** The machine's own git kept the token of the agent's first push, which the agent found and removed.
- **The machine went to sleep.** With nobody at its screen it slept when idle, and the agent was not heard from.

## Decision

1. **The line says who does what.** It has whoever is given it install what is missing without asking, Node.js and the console's command first, run the command and do what it prints, and ask a person for a sign-in or an administrator's password alone. A page says it in the language of whoever reads it, the command and the install as written.
2. **The command looks at the machine before it asks anyone to sign in.** git, where on a Mac the Command Line Tools are asked for first, since without them `git` opens a window and answers nothing; the command of the agent's product, the first of those the package has a driver for that answers, or the one `--driver` names; and for a product whose browser tool works in a browser of its own, that browser, unless `--no-browser` says the agent signs in at no page. Everything missing is said at once, each with what installs it, and the command ends there: nobody signs in on a machine the runner could not work on, and no service is written for a product that is not there. What the command cannot see, a product's sign-in and a browser's extension, it says in a line and goes on.
3. **The command prints the part of whoever prepares the machine, and no more.** The guide a code opens is whole on its page and in `--json`; the command prints the sections of whoever prepares the machine, which end with "Then stop". What the agent does when it starts is its first task, read by the agent in its own session.
4. **A person signs in themselves.** The guide has the session tell the person which login and which code, and says that no password is written in a chat: a secret the agent is to hold is seeded from the person's own machine.
5. **A setup ends by handing over.** Once the runner is heard from, the command waits a little for the agent's first session and says whether it began, where to watch it, which task is the agent's first, that the machine's part ends there, and how to tell the agent what changed on the machine afterwards ([ADR-0145](0145-an-agent-account-wakes-itself-now-or-at-a-moment-to-come.md)).
6. **A new desk names what was found.** Its `runner.json` names the product's driver and, where the product has a browser tool and its browser is there, `"browser": "chrome"`, which the `claude` driver turns into the product's own option. `browser` is a name of a short list: a desk never writes words onto a product's command line.
7. **The desk's git reads the token from the account's store.** A desk the setup wrote or cloned is a repository whose own configuration names, for the workspace's git host alone and in place of the machine's helpers, a credential helper that asks the account's command for `git.token`. The agent pushes with nothing typed, and no copy is kept in a keychain or a file.
8. **The runner holds the machine awake while it runs.** Through the system's own helper, which needs no administrator and changes no setting: `caffeinate` on a Mac, the system's request held by a small script on Windows, `systemd-inhibit` on Linux. It ends with the runner. The runner says in its own lines whether it holds, the setup asks the system where it can and says what is left to whoever keeps the machine: a sleep someone asks for, a lid that is closed, and logging the OS account in after a restart.
9. **A secret's value is looked at as it is kept.** `console secret <name> --set` and a supervisor's seeding keep whatever they are given, and say when a value holds a space or is not of the shape its name says, for the names the package itself reads. Nothing of the value is said.

## Consequences

- **A session at the machine has a short job with an end.** It installs, has a person sign in once, and stops. The agent does its own setup with its own instructions, and asks its manager for what only a person can do.
- **A machine that lacks something is told so in one pass**, with the commands, before a person is called to the screen.
- **A setup on a machine that deliberately has no browser, or runs another product, says so** with `--no-browser` and `--driver`. A product behind the `acp` driver is not looked for, since its command is the desk's to name.
- **A desk that was there is left as it is**, its git and its `runner.json` among it: an account set up before this turns the browser tool on, and gives its desk the helper, itself. The skill says how.
- **The helper that holds a machine awake is best effort.** Where the system has none, or refuses, the runner says so and goes on; the machine's own setting is then the only thing that keeps it awake.
- **Not checked on a machine yet**: the look, the hand-over, the helper on a Mac and on Linux and the desk's git were written after the run that asked for them, and are held by tests against invented machines. The helper for Windows was run on Windows 11.
