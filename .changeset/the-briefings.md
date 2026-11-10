---
"@skillcdn/console": patch
---

An agent account starts its day with a briefing (ADR-0085). The console sends it a wake at the hours it keeps, in the workspace's time zone: at the day's start, 09:00 where the account says no other hour, its tasks planned for today, those carried over, those open with no day and how many decisions wait; on the week's first day, the week's, in its place; at the day's end, where it has one, a wrap, to write the day down and push its desk. The hours are kept by the account or a supervisor: `console agent <handle> --day-start 08:30 --day-end 18:00`, `none` for the usual, "Its day" on the account's Settings, `dayStart` and `dayEnd` on `PATCH /api/v1/agents/<handle>`, and `hours` where one account is read. A month before a secret's day the console tells the account, by the secret's name and never its value. For whoever builds a console: `restAgentHoursSchema` and `DEFAULT_DAY_START`.
