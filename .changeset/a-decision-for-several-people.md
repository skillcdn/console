---
"@skillcdn/console": patch
---

A decision may be addressed to several people ([ADR-0057](https://github.com/skillcdn/console/blob/main/docs/adr/0057-a-decision-may-be-addressed-to-several-people-and-the-first-answer-ends-it.md)): `POST .../decisions` takes `deciderIds` beside `deciderId`, `console ask` takes `--to` more than once, the form takes several people where it took one, and a plugin's `ctx.console.decisions.ask` takes `deciderIds`; up to `MAX_DECIDERS` (10), each once and each able to work in the project (`decision.too_many_deciders`, `decision.invalid_decider`). Each of them finds the decision among their own, in `console work` and in the count beside My decisions; any of them may answer, and the first answer ends it. A decision answers `deciders`, everyone it is addressed to in the order named (read as optional, for an older console), beside `decider`, the first of them; the pages show each and the command prints their logins.
