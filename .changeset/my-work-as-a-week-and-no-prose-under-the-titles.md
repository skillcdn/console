---
"@skillcdn/console": patch
---

My work as a week, and the pages without the prose under their titles.

- **The default UI.** My work opens on the week: the person's open tasks on its seven days, a task planned across days as a bar, each with its project's mark, today marked, and the weeks around a step away; the address says which week (`/work?week=<day>`). The lists below stay, a page at a time. The descriptions that stood under every page's title are gone; what remains under a title is what the page is about: a project's description on its board, its visibility on its members, the address the skills are served from.
- **The package.** `Week` (`WeekProps`): one week of tasks on its own, with `weekHref` for the weeks around and `markOf` for what stands before a task; `WorkList` takes `week` and `weekHref`; `weekOf(day, firstDay)` and `formatDays(from, to, language)` beside the other days; `workHref(week?)`, and the route `work` carries `week`. The words of the descriptions left the packs (`projects.lead`, `projects.members.leadWorkspace`, `leadPrivate` and `leadRoles`, `projects.settings.leadBefore` and `leadAfter`, `decisions.recordLead`, `calendar.lead`, `calendar.workload.lead`, `roadmap.lead`, `work.lead`, `categories.lead`, `onlyAdmin` and `inUse`, `skills.howLoaded`, `people.lead`, `people.agentsLead`, `agents.lead`, `connect.lead`), `calendar.week` came in, and `skills.servedBy` is shorter. The styles gained `sc-week` and `sc-work-lists`.
