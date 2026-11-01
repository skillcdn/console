---
"@skillcdn/console": patch
---

A plugin reaches the board and hears of it (ADR-0052, `docs/specs/plugins.md`, "The board" and "Events, hooks and jobs"): a task, a decision and a document answer `plugin`, the key of the plugin that made them, or `null`, and the feed says "through the plugin <key>" after what a plugin did on the board (`feed.throughPlugin`); `GET /api/v1/plugins/<key>/plugin-events?after=&limit=` lists the events a plugin emitted (`restPluginEventSchema`, `restPluginEventsSchema`), for its frames. On the console's side, `ctx.console` reaches the people, the projects, the tasks, the decisions, the documents and the runs by capability and the console's policy, `ctx.events.emit` keeps a plugin's events, `ctx.fetch` makes outbound requests to the hosts consented to with the secret put in by the console, `ctx.plugins.get(key).api` calls another plugin, and hooks and jobs run from the dispatcher and the scheduler. Additions only: the floors stay.
