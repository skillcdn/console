---
"@skillcdn/console": patch
---

An agent account shows at the messenger that it is at work (ADR-0170).

- **Its runner sets its member's status at Slack, and takes it back.** `:thought_balloon:` Thinking, from when a message at the messenger reaches the runner until the turn it began is over; `:hammer_and_wrench:` Working · a reply may take a while, once the agent has been at work for more than thirty seconds, whatever woke it, and for as long as sub-agents work on in its background; `:low_battery:` Out of usage · back at 05:40, while the usage limit of its product stops it, until the moment it resets. In the workspace's language where the console speaks it. Nothing stands when a turn is over, when the session ended, was stopped or failed, and when the runner stops.
- **The agent's app needs one scope more:** the user scope `users.profile:write`, which the manifest in the skill `running-an-agent` (`references/slack-app.md`) now asks for. An app made before is given the scope on its own settings and installed again; until then nothing is shown, the runner says so once in its lines, and the agent is told once in a line of a wake. Nothing else is the worse for it.
- **`status` in `runner.json`** names an emoji and words of the desk's own for each of the three, the seconds a turn is given before the agent is shown at work (`after`, 5 to 600), or `false` for no status at all: `{ "status": { "after": 60, "working": { "emoji": ":construction:", "text": "Heads down" } } }`. What does not read there is refused with the file, in words that name the key.
- **It is written sparingly.** Only when what is shown changes; three calls at once and one more every eight seconds at the most; after a `429`, when `Retry-After` says; and every status ends by itself, so that a runner gone with its machine leaves nothing for long. The runner takes back the status it set and no other: where it set none it leaves whatever stands, and it writes over a status the agent set itself.

Written from the messenger's documentation of `users.profile.set` and from what a trial at a workspace found, and held by tests with invented answers: it was not run against a workspace from here.

For whoever builds on the package: a `WakeSource` may have `show(host, status, options)`, told an `AgentStatus` (`idle`, `thinking`, `working`, `limited` with `until`) when it changes, again every heartbeat, and `idle` with `last` as the runner ends; `WakeHost.fetch` takes a `body` and answers `status` and `headers` where the host has them; `RunnerOptions.language` is the workspace's language; `AgentStatus`, `StatusWords` and `StatusLook` are exported from `@skillcdn/console/runner`; the language packs have `agents.status`, which a pack of your own carries too.
