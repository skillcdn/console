---
"@skillcdn/console": patch
---

`GET /api/v1/me` says with what a request acts: `agent` is the name of the token when a token asks, as its person called it, and `null` on a session (`restMeSchema`). The default console, when it holds a token rather than a session (a person's own console, served from their machine), offers nothing a token cannot do: no agents page, no new project, no settings, no changes to members or roles, no sign-out, and the choice of language kept in the browser instead of on the person. The language packs gained `common.notWithToken`.
