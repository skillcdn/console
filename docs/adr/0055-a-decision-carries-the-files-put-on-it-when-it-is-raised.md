# ADR-0055: A decision carries the files put on it when it is raised

- Status: Accepted
- Date: 2026-11-06

## Context

A decision asks a person to choose, and what they choose between is often a picture: a screenshot of what was made, two looks of one page, a chart. A comment carries files ([ADR-0024](0024-a-task-carries-a-discussion-of-comments-with-their-files-read-as-one-thread-with-the-runs-and-the-decisions.md)) and a run hands them in, but a decision had only its Markdown, which shows pictures from elsewhere over https alone. An agent that had to put a picture before the person it asked had to say it in words, or put the picture in a comment beside the decision, where the person answering did not look; a person raising a decision from the pages could not attach one at all.

## Decision

1. **A decision carries files, put on it when it is raised.** At most `MAX_FILES_PER_DECISION` of them, together at most `MAX_FILE_BYTES`, each checked as a file handed in is. The files are the blob store's, rows of their own (`decision_files`) that name a hash, as a comment's are ([ADR-0016](0016-the-bucket-is-reached-through-the-s3-api-with-the-consoles-own-signing-and-reads-what-the-rows-kept-before-it.md)); they count toward what a project's files may hold together.
2. **One request, one decision, one event.** As JSON, as before; or as one form whose part `decision` says what the JSON would, with a part `file` for each file, read whole and found good before any byte is kept. The board is told once (`decision.raised`, with how many files came) and sees the decision with its pictures at once. The command: `console ask ... --attach <path>`.
3. **Pictures are seen where they are.** A picture among the files is placed in the context as `![words](its name)` and shown there; the files the context does not place follow it, pictures in place and the rest as links; every page that shows a decision shows them. The bytes are read at the project's one address for files (`GET .../files/<id>`), and the command names each file with `console file <id>`, as it does a comment's.
4. **The answer and the outcome stay Markdown.** What an answer rests on is said in its note; a picture that belongs with an answer goes in a comment on the task, where the discussion is. Whether an answer may carry files of its own stays open, as does a decision a plugin raises with files (`ctx.console.decisions.ask` takes none yet; a plugin's record has files of its own).

## Consequences

- An agent puts the picture a decision rests on before the person in the one request, and a person raising a decision from the pages chooses or pastes one, as in a comment.
- `RestDecision` gains `files`, read as optional so that a console built on the package reads an older console's decisions; `DecisionCard`, `DecisionList`, `TaskThread` and `MyDecisions` take `fileHref`; `DecisionForm` hands over the files chosen; the client's `raiseDecision` takes them; `MAX_FILES_PER_DECISION` is exported.
- Rejected: files uploaded before the decision that names them (files nothing refers to); a decision's files as the task's comment (the person answering reads the decision, not the thread, and a decision about no task has no thread); files added to a decision afterwards (the record of what was asked must stay what was asked).
