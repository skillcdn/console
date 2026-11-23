---
"@skillcdn/console": patch
---

The `slack` wake source wakes an agent account for what a person says in a group conversation it is in, whether the message names it or not, as a direct message does. A channel wakes it the same way once the desk's `runner.json` names it: `"channels": ["C0123ABCD"]`, by the ids the messenger gives its channels, fifty at most. What an app posted there wakes nobody unless it names the agent, and every other channel wakes the agent only by a mention, as before.

A `runner.json` that names no `channels` reads as it did. A wake source of your own is handed the list as `host.channels`.
