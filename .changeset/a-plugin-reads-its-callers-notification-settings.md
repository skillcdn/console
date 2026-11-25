---
"@skillcdn/console": patch
---

A plugin with `notifications:read` reads what whoever calls it chose to be told of in the console (ADR-0165): `ctx.console.notifications.settings()`, as `GET /api/v1/notifications/settings` answers it, with the projects turned off being those the plugin is on. A plugin that carries notifications elsewhere shows with it that a kind is off in the console, where none comes to carry. It answers a member in a call of their own, a person, their agent or an agent account, and refuses every other caller; nothing is asked of an administrator anew. `createTestContext` takes it as `console.notifications`.
