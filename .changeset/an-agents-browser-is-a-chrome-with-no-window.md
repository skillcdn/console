---
"@skillcdn/console": patch
---

Breaking: an agent account's browser is a Google Chrome with no window, unless whoever sets its machine up names the product's own browser tool ([ADR-0149](https://github.com/skillcdn/console/blob/main/docs/adr/0149-an-agents-browser-is-a-chrome-with-no-window-unless-its-desk-names-the-products-own.md)).

- **`runner.json` takes `"browser": "headless"`.** The `claude` driver starts Claude Code with the program that drives a headless Chrome, `chrome-devtools-mcp`, as a server of its own for that run (`--mcp-config`), with no window and with its usage statistics off. Such a browser needs no screen, no extension and no sign-in of its own, and keeps a profile in the OS account's home, so that a sign-in stays from one session to the next. The program is installed on the machine, `npm install -g chrome-devtools-mcp`; the package neither carries it nor fetches it.
- **`console agent setup` looks for it unless told otherwise**: Google Chrome where that program looks for it, and the program, each said with what installs it where it is missing. A setup that went on with Chrome alone now asks for the program too. `--browser chrome` looks for Claude Code's own browser tool, as before, and `--no-browser` for none. A new desk names what was looked for and found.
- **A desk that was there is left as it is.** `"browser": "chrome"` starts Claude Code with `--chrome` as it did, and a `runner.json` that names no browser has none.
- **The guide, an account's first task and the skill `running-an-agent`** say which browser an agent has, and that one with no window has none for a person to sign in at: an agent whose services go on wanting a person at a sign-in asks for `chrome`.

For a driver of your own, `DriverHost` gains `platform`, the system the runner is on. The `codex` and `acp` drivers start their products with no browser yet. Not run on a machine yet: Claude Code was seen to start a server named this way and to call its tool, with a stand-in for the program.
