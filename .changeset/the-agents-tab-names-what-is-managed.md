---
"@skillcdn/console": patch
---

The Agents tab's views are named for what they hold: "Agent accounts you manage", since a manager owns nothing, and "Connected agents". The view that listed every account for an administrator is gone (`?view=all`, `AGENTS_VIEWS` without `all`): an administrator finds the accounts someone else manages under their own, beneath a heading. For whoever builds a console: `agentAccountGroups(agents, me, people)` says which accounts are managed and which are the others; the words `agents.views.all` and `agents.accounts.allIntro` are gone, and `agents.accounts.others` and `othersIntro` are new.
