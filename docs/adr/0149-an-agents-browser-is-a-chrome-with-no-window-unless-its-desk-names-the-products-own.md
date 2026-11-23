# ADR-0149: An agent's browser is a Chrome with no window, unless its desk names the product's own

- Status: Accepted
- Date: 2026-11-24
- Amends [ADR-0140](0140-a-machine-is-given-its-least-and-the-agent-does-the-rest-itself.md), points 2 and 6, in which browser a setup looks for and a new desk names; and [ADR-0094](0094-the-account-an-agent-signs-in-with-is-named-and-who-makes-it-is-the-organizations-to-say.md), point 5, in which browser a sign-in at a page is kept.

## Context

An agent's browser was its product's own browser tool and nothing else: for Claude Code, the Google Chrome of the agent's OS account, open with its window, with the product's extension installed in it and signed in with the agent's subscription.

- **What a setup cannot see is what an agent then lacks.** A setup sees the browser and neither the extension nor its sign-in ([ADR-0140](0140-a-machine-is-given-its-least-and-the-agent-does-the-rest-itself.md), point 2), so it says them in a line and goes on. Where either is missing, the agent starts with a browser tool that does nothing.
- **It takes a person for each agent.** A browser to open in the OS account, an extension to install and a sign-in to make there, in a window, before the agent can sign in anywhere itself.
- **It takes a screen.** A machine without one, a server, has no window for the browser to open in.

## Decision

1. **`browser` in `runner.json` takes a second name, `headless`.** A Google Chrome with no window, started by a program that is no part of the product: Chrome DevTools for agents (`chrome-devtools-mcp`), which the product starts beside itself as a server of the Model Context Protocol. `chrome` stays what it was, the product's own browser tool in a Chrome with a window. A file that names neither is started with no browser, as before.
2. **The driver names the program to the product when it starts it, for that run alone.** The `claude` driver hands the product one server, `chrome-devtools`, with `--mcp-config`. No file of the product's settings is written, and the server's tools are leave for nothing: the mode decides of them as of every tool. The program is started with no window and with nothing sent of the agent's work to its maker, its usage statistics and its lookups of a page's address both off. It keeps a profile of its own in the OS account's home, the same one every time, so that a sign-in stays from one session to the next. On Windows, where npm installs a program as a script, it is started through the system's own interpreter.
3. **The program is installed on the machine, neither carried nor fetched.** The package gains no dependency, and a session fetches nothing from a registry when it starts. The setup looks for the program as it looks for the product's command, and says what installs it.
4. **A setup looks for a headless browser unless it is told otherwise.** For a product its driver starts with one: Google Chrome where the program looks for it, and the program, each said with what installs it where it is missing. `--browser chrome` looks for the product's own browser tool instead, as before, and `--no-browser` for none. A new desk names what was looked for and found.
5. **The agent is told which browser it has**, in the guide, in its first task and in the skill: where it signs in, that a sign-in stays there, and that a browser with no window has none for a person, so that an agent whose services go on wanting a person at a sign-in asks for `chrome`.

## Consequences

- **A new agent has a browser with nothing to connect**, on macOS, on Windows and on Linux, on a machine without a screen too. What the setup looks for is all there is to it, and the setup sees all of it.
- **A desk that was there is left as it is.** One that names `chrome` runs as it did, and one that names none has none. An agent, or whoever manages it, changes the name in its `runner.json`, which the runner takes by itself ([ADR-0144](0144-a-runner-takes-its-runner-json-as-it-changes-and-says-how-its-wake-sources-stand.md)).
- **A person cannot step into a browser with no window.** A sign-in that wants a person every time is what `chrome` is still for. The two browsers keep a profile each, so what was signed in at in one is not signed in at in the other.
- **The machine carries one more program**, kept current by whoever keeps the agent's product current. It drives its maker's Chrome where the system keeps it: a copy in an OS account's own Applications on a Mac, and a Chromium of another name, are none it finds by itself.
- **Only the `claude` driver starts its product with a browser.** `codex` and `acp` take nothing of `browser` yet, and a setup says so of a product of theirs.
- **Rejected:** making `headless` what a `runner.json` without `browser` means, which would hand a browser to every desk that names none, those set up to have none among them; starting the program through the registry's own runner at every session (`npx`), which fetches whatever was published last into the agent's OS account and needs the network to start; carrying the program as a dependency of the package, which every console built from the package would then install; and writing the server into the product's own settings, which are its operator's and the agent's.
- **Not run on a machine yet.** Claude Code 2.1.330 was started with a server named this way and called its tool in the mode for a run nobody attends, with a stand-in for the program. The program itself, with a Chrome under it, was run on none of the three systems: what is said of it here is from its documentation and its source.
