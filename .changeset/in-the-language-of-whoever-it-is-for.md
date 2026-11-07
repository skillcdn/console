---
"@skillcdn/console": patch
---

A person's language is kept on them from the first time the pages see them, and a plugin reads it, to write for them ([ADR-0065](https://github.com/skillcdn/console/blob/main/docs/adr/0065-a-plugin-writes-one-text-and-a-persons-language-is-kept-from-the-first-time-the-pages-see-them.md)). A person carries `language` (read as optional), in `ctx.console.people` and in `GET /api/v1/people`: the one they chose, else the one their browser asked for when they first opened the pages, `null` until then. The pages keep it with `PATCH /api/v1/me`, a custom console built with `createConsole` too, and a person changes it on the menu; a browser in another language no longer does. A browser that asks only for a language the pages do not speak leaves none. The rules' `{language}` reads the same value: an agent of a person who never chose wrote in the task's language, and writes in theirs once they have opened the pages.
