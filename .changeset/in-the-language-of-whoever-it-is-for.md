---
"@skillcdn/console": patch
---

A person's language is kept on them from the first time the pages see them, and a plugin reads it, to write for them ([ADR-0065](https://github.com/skillcdn/console/blob/main/docs/adr/0065-a-plugin-writes-one-text-and-a-persons-language-is-kept-from-the-first-time-the-pages-see-them.md)). A person carries `language` (read as optional), in `ctx.console.people` and in `GET /api/v1/people`: the one they chose, else the one their browser asked for when they first opened the pages, `null` until then. The pages keep it with `PATCH /api/v1/me`, a custom console built with `createConsole` too, and a person changes it on the menu; a browser in another language no longer does.
