---
"@skillcdn/console": patch
---

Teams (ADR-0073): a team is a name and its members, a person in any number of them, kept by an administrator on the People page and with `console teams` and `console team new|rename|remove|add|drop`. `GET /api/v1/teams` lists them with the members the asker may see; `POST`, `PATCH`, `DELETE /api/v1/teams/<id>` and `POST|DELETE /api/v1/teams/<id>/members` keep them; the people listing and `ctx.console.people` name each person's `teamIds`, and `ctx.console.teams.list()` and `get(id)` read the teams, with `people:read`. A role of a plugin is granted to a team (`team` on `POST .../grants`, `--team <name>`, the settings page), held by whoever is in it as the membership changes. Five new event kinds, `team.created`, `team.renamed`, `team.removed`, `team.member_added` and `team.member_removed`, reach a plugin's hooks with `people:read:all` as the people's do. The fact the People page called a person's team is their reports now.
