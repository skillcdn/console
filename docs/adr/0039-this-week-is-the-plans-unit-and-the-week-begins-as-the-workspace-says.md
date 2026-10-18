# ADR-0039: This week is the plan's unit, and the week begins as the workspace says

- Status: Accepted
- Date: 2026-10-18
- Builds on [ADR-0019](0019-a-task-is-planned-in-days-the-board-keeps-its-moments-and-goals-and-categories-give-the-work-its-shape.md) (the plan in days) and [ADR-0035](0035-who-may-see-whom-is-decided-by-one-policy-and-the-workspace-keeps-its-settings.md) (the week start as a setting of the workspace). The contract is in [specs/cli.md](../specs/cli.md).

## Context

The board counted what is soon as seven days from today: who has what said "due in 7 days", My work bucketed the tasks due within seven days as this week, and `console tasks --due week` asked for what is due within seven days. The organization plans its work in weeks: what is due this week is what the week's planning is about, and seven days from a Wednesday is not that. The calendars already begin the week as the workspace says (ADR-0035), `auto` following the language of the pages; the counts and the command did not read that setting, and a second way to say when a week begins, per person or per command, would have two settings mean one thing.

## Decision

1. **This week is the days from today through the last day of the week.** Wherever the board counted seven days, it counts this week: who has what (`dueThisWeek`), the bucket on My work, and `--due week` on the command. A task due today is this week's; one due on the week's first day next week is not.
2. **The week begins as the workspace's one setting says**, `week_start`: `monday`, `sunday`, or `auto`, which follows the language, the person's chosen language on the pages, else the browser's, as the calendars have it since ADR-0035. No setting is added per person or per command.
3. **The command reads the same setting.** `--due week` asks the console who the person is (`GET /api/v1/me`), takes the workspace's week start, and, where it is `auto`, the person's chosen language, else the machine's locale, else English; the week's last day is then the day it asks the board for. One request more, on this flag alone.
4. **A task's own due badge stays what it is**, saying in how many days a task is due while that is near and the day itself otherwise: it is a word about one task, not a count of the week.

## Consequences

- Who has what, My work and the command agree on what this week is, and agree with the calendar's week; a Monday workspace and a Sunday workspace each count their own week.
- A workspace left on `auto` has its week follow each person's language, as its calendars already did; an organization that plans together sets `monday` or `sunday` once, on the Settings page or with `console workspace edit --week-start`.
- Rejected: a week start per person (two settings for one week, and the board's counts would differ between people in one workspace); a week start given to the command as a flag (the week is the workspace's, not the command's); seven days kept beside the week (two meanings of soon).
