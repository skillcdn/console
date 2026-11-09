---
"@skillcdn/console": patch
---

A workspace has a language for whoever has none of their own (ADR-0081): an administrator sets one the console speaks on the Settings page or with `console workspace edit --language <en|ko|none>` (`PATCH /api/v1/workspace`, `language`), and `GET /api/v1/me` answers it. `ctx.console.workspace()` answers `language`, the workspace's or `en`, and `languageSet`, with `languages` putting it first, and the frame's `init.workspace` carries `language`; a call for a person with no language, and the console's own hooks, jobs, enabling, disabling and upgrades, run in it, and the pages fall back on it after the browser's languages. `chooseLanguage` takes it as a fourth argument; `languagesFirst` and the type `ConsoleLanguage` are exported.
