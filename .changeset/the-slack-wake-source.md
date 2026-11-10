---
"@skillcdn/console": patch
---

`console runner` keeps wake sources (ADR-0085): modules that raise a wake for what is said to the agent outside the console, named in `runner.json` (`"wake": ["console", "slack"]`). The runner keeps each listening, starts one again that ended, and raises what it hears to the console, which records it as a wake from the messenger and sends it back in order; its words reach the agent as someone else's. `slack` is the first: one app for one agent account, over Socket Mode, with the app's token kept in the account's store as `slack.app_token`; a direct message and a mention of the agent's member wake it, by the thread they are in. It is written from the messenger's documentation and was not run in a workspace yet. For whoever writes a source: the `WakeSource`, `WakeHost` and `WakeSocket` types, `slack`, `slackWakeOf` and `SLACK_APP_TOKEN` in `@skillcdn/console/runner`, `client.raiseWake`, `restRunnerWakeSchema` and `MAX_SIGNAL_KEY_LENGTH`.
