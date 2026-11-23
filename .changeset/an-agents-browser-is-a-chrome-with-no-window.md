---
"@skillcdn/console": patch
---

Breaking: an agent account's browser is a Google Chrome with no window, unless its desk names the product's own browser tool ([ADR-0149](https://github.com/skillcdn/console/blob/main/docs/adr/0149-an-agents-browser-is-a-chrome-with-no-window-unless-its-desk-names-the-products-own.md)).

- **`runner.json` takes `"browser": "headless"`, and means it where it names no browser.** The `claude` driver starts Claude Code with the program that drives a headless Chrome, `chrome-devtools-mcp`, as a server of its own for that run (`--mcp-config`), with no window and with its usage statistics off. Such a browser needs no screen, no extension and no sign-in of its own, and keeps a profile in the OS account's home, so that a sign-in stays from one session to the next. The program is installed on the machine, `npm install -g chrome-devtools-mcp`; the package neither carries it nor fetches it.
- **A desk that is there and names no browser changes.** It was started with no browser, and is started with a headless one from its runner's next start. Install the program on its machine, beside Google Chrome: until it is there, Claude Code says that the server failed and the session goes on with no browser, as before. A desk that is to have none names `"browser": "none"`, which `--no-browser` now writes. A desk that names `"browser": "chrome"` starts Claude Code with `--chrome` as it did.
- **`console agent setup` looks for a headless browser unless told otherwise**: Google Chrome where that program looks for it, and the program, each said with what installs it where it is missing. A setup that went on with Chrome alone now asks for the program too. `--browser chrome` looks for Claude Code's own browser tool, as before, and `--no-browser` for none. A new desk names what was looked for and found.
- **The guide, an account's first task and the skill `running-an-agent`** say what each browser is. Which of the two an agent uses is its own to choose, by the name in its `runner.json`.

For a driver of your own, `DriverHost` gains `platform`, the system the runner is on, and `RunnerConfig.browser` is always a name. The `codex` and `acp` drivers start their products with no browser yet. Seen run on a Mac by hand, with Claude Code 2.1.330 and the program at 1.13.0; not run on Windows or on Linux.
