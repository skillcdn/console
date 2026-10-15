---
"@skillcdn/console": patch
---

The week at the top of My work, and of another person's work page, shows the person's tasks that were done or dropped on their days, struck through as a project's calendar shows them, beside the open ones; the lists below keep to the open tasks. `GET /api/v1/work` and `GET /api/v1/people/<id>/work` carry them as `closed`, which `restWorkSchema` and `restPersonWorkSchema` take as optional, so that a console older than this one still answers; `WorkList` takes them in `work.closed`.
