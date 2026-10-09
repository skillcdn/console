---
"@skillcdn/console": minor
---

The organization's skills, by address. The console answers `GET /api/v1/skills` with what the SkillCDN deployment serves at its configured address: `restSkillsSchema` (`address`, `source`, `page`, `status` among `SKILLS_STATUSES`, `items`) and `restSkillSchema` (`name`, `description`, `directory`, `path`, the skill's `page` for a person, the `uri` an agent loads it by through its own SkillCDN connection, and `translations`), with `REST_ROUTES.skills` and `client.skills()`. The default console gains a Skills page at `PATHS.skills` (`/skills`, route `skills`), the `SkillList` component, which `ConsoleComponents` names, and `useConsoleData().skills`, loaded on its own so that the board stands without it. The command gains `console skills`.
