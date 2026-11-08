---
"@skillcdn/console": patch
---

A person, a project or a goal is chosen by searching wherever one is chosen (ADR-0037), as a task's parent and its goal were: a person's manager on the People page, whom to add to a project, a worker on a task, the person and the goal the board is narrowed to, a plugin's `person` and `project` settings and their lists, the board project a plugin is enabled with, and whom a role is granted to, one field over everyone, the projects, the people and the plugins. Each is the `Picker`, searching the listing the page already holds; the chosen stands in the field's place and a press clears it. Short and fixed lists, a state, a priority, a category, a role, stay lists. `Picker` takes `id`, for a label to point at, and `listSearch`, `peopleSearch`, `projectsSearch` and `goalsSearch` are exported, so that a custom console searches its own listings the same way.
