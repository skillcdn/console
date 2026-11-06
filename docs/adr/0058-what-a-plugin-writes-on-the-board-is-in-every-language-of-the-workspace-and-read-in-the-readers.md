# ADR-0058: What a plugin writes on the board is in every language of the workspace, and read in the reader's

- Status: Accepted
- Date: 2026-11-06
- Refines [ADR-0012](0012-the-pages-speak-the-persons-language-from-packs-that-ship-with-the-package.md), which gave the pages the person's language, and [ADR-0052](0052-a-plugins-board-is-a-project-made-or-chosen-when-it-is-enabled-and-what-it-puts-there-carries-its-name.md), which put a plugin's decisions, tasks and comments on the board. The contract is in [specs/plugins.md](../specs/plugins.md) and [specs/rest.md](../specs/rest.md).

## Context

A plugin writes on the board for people: the approval of a leave as a decision, the settlement of the year as a task, a word on a task as a comment. The pages speak each person's language (ADR-0012), but the plugin cannot know who will read what it writes: a decision is answered by anyone of the project, a task is taken by whoever takes it, and a person changes their language when they like. The first plugin wrote in the workspace's first language and the Korean approver read an English question. The alternative looked at, telling the plugin each person's language so that it writes for the one named, is wrong as soon as another reads it, and stale as soon as the person changes their language.

## Decision

1. **A plugin may write a text in every language of the workspace.** `ctx.console.decisions.ask` takes its `question`, its `body` and each option's `label`, `ctx.console.tasks.create` its `title` and `body`, and `ctx.console.tasks.comment` its `body`, as one string or as a map of language tag to text, at least one of the console's languages among them, within the field's bound in each. A person's own words, the answer, the note, the outcome and a comment of their own, stay one string.
2. **The board keeps the map whole, and one text beside it.** The decision, the task and the comment carry `translations`, the texts per language, and keep in the field itself the text the readers of before read: the English one where the map has it, else the first of the console's languages it has. Everything of the board that reads the field, the search, the feed's event, the command, reads that text.
3. **Every reader reads in their own language.** The API answers `question`, `body`, a label, `title` in the reader's language, the person the session or the token belongs to, as the language they chose for the pages; the text as kept where they chose none or the map lacks theirs; and answers `translations` beside it. The pages read the map again in the language they speak, so that the menu's choice of language changes the text as it changes the words around it, and the feed's event carries the map of the title or the question for the same. The command prints what the API answered, in the language of the token's person.

## Consequences

- A Korean approver reads a Korean question and an English colleague the English one, from the one decision; the plugin writes once, for the workspace's languages, and never asks who will read.
- The field a reader of before reads holds English where there is English, so a console or a command of before loses nothing but the other languages.
- A text in one language is as it was: nothing changes for a plugin, a person or an agent that writes in one.
- Rejected: a person's language exposed to plugins (wrong for the next reader, stale after a change); a text per reader chosen when written (a decision has many readers); translating on the console's side (the console calls no model, ADR-0004).
