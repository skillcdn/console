---
"@skillcdn/console": patch
---

Breaking: `DecisionForm` finds the task a decision is about by searching the board a page at a time (ADR-0037): it takes `findTasks`, the search the task form takes, in place of `tasks`, every task of the board; given `taskId`, raised from a task's page, it is about that task and shows no field, as before. The words `decisions.form.noTask` stand in the empty search field.
