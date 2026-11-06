---
"@skillcdn/console": patch
---

A decision carries the files put on it when it is raised (ADR-0055), as a comment carries its files: `console ask --attach <path>` puts a picture of what is to be chosen between on the decision, in the one request, and `console decision` and `console task` name each file with `console file <id>`. Over REST, `POST .../decisions` takes a form whose part `decision` says what the JSON would, with a part `file` per file, at most `MAX_FILES_PER_DECISION`; a decision answers its `files`, read as optional so that an older console's decisions still read. On the pages, the decision form takes files chosen or pasted, a pasted picture placed in the context, and every card shows the pictures where the context names them, the rest after it: `DecisionCard`, `DecisionList`, `TaskThread` and `MyDecisions` take `fileHref`, `DecisionForm` and `TaskView` hand the files over with the decision, and the client's `raiseDecision` and the data's take them.
