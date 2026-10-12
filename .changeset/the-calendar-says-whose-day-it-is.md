---
"@skillcdn/console": patch
---

The calendar says whose day it is, and the Agents page what to paste.

- **A task with one day alone**, a due day or a start, sits on that day as any task on its day: a dot in its category's colour before its title, and the title in the tip; a task with a start alone is never late. The mark for a start alone (`sc-calendar-task-start`) and the word `calendar.startsOnly` are gone.
- **Who has a task**, on a project's calendar: the person's picture, or their initial, stands before the title, on a bar and on a day alike, and the tip names them; nothing for a task nobody has, and nothing on the week of My work or of a person's work, which is one person's. `Avatar` takes the size `xs`.
- **The words for an agent**, on the Agents page, are a text to paste as it is, in a box with a button that copies it: the two commands, `npm install -g @skillcdn/console` and `console login --url <origin>`, and what to tell back. The paragraph on approving is gone, since the agent says what to do next; `connect.words.thenApprove` with it, and `connect.words.quote` now answers several lines. `CopyButton` is exported, with the words `common.copy` and `common.copied`; `agents.fresh.copy` and `agents.fresh.copied` are gone, and `NewToken` copies through it. New class: `sc-copyable`.
- **The People page says add**: "Add a person", "Add", "Added, not signed in yet", "Added by an administrator", and the feed's "added <login>", in both languages; the keys stay (`people.letIn`, `people.letInAria`, `people.notSignedIn`, `people.source.listed`, `people.form.submit`, `feed.event.personListed`).
