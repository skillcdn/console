---
"@skillcdn/console": patch
---

Breaking: the `codex` driver of `console runner` speaks to the product's app server, `codex app-server`, one process a session, where it ran `codex exec`, a process a turn (ADR-0153). A message that arrives while a turn runs is put into that turn and read after the step under way, as with Claude Code, and the agent's page says so (`steer: true`): a supervisor's words no longer wait out a long turn. A message is taken when the product says it back, and one that was put into a turn and never read is the next turn's. What the product asks of a person is refused and recorded as a `permission` event.

A desk needs a Codex whose app server has `turn/steer`: 0.139.0 and later answered it, and an older one does not start, with a line that says why. `runner.json`, the modes, the product's own sign-in and the conversation a desk kept stay as they are. No build of Codex is listed as tried until a turn of a signed-in product ran through the driver, so the agent's page says its version is untried.

The `acp` driver is as it was. The Agent Client Protocol's version 1 has no message in a turn; what its version 2, a preview, and the adapters offer for one is said in the runner's spec, with why the driver waits for the protocol.
