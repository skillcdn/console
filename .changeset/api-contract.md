---
"@skillcdn/console": minor
---

The first layer of the package: the contract of the console's REST API. `@skillcdn/console/api` (and the root entry point) exports the vocabulary of the board (`TASK_STATES`, `TASK_PRIORITIES`, `RUN_STATUSES`, `EVENT_KINDS`), the bounds every input is held to, the routes, the schemas every request and answer is parsed with (`restTaskSchema`, `restDecisionSchema`, `restEventSchema`, their inputs, and the rest), and `createClient`, a typed client of the API that takes a `fetch` and a base URL and reads nothing else.
