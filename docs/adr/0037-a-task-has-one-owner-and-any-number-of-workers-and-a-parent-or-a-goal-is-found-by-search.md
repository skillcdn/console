# ADR-0037: A task has one owner and any number of workers, and a parent or a goal is found by search

- Status: Accepted
- Date: 2026-10-18
- Amends [ADR-0019](0019-a-task-is-planned-in-days-the-board-keeps-its-moments-and-goals-and-categories-give-the-work-its-shape.md) in who is on a task, and builds on [ADR-0029](0029-a-task-done-or-dropped-is-put-away-out-of-the-board-and-open-by-its-number.md), by which the pages read the current tasks whole. The contract is in [specs/rest.md](../specs/rest.md#get-apiv1projectskeytasksstateopenarchivedcategorygoalworkerunassignedduebyqlimitoffset) and [specs/cli.md](../specs/cli.md).

## Context

A task had an owner, whoever wrote it, and one assignee, the person at work on it, which a run taking the task set to the agent's person. The first weeks on the board showed work that two or three people share: a person and another's agent at it in turn, a pair reviewing, a task handed on with the first person still on it. One assignee made the board say less than the truth about who is at work, and a take by a second person wiped the first off the task. The owner stays one: a task is somebody's to answer for.

The form of a task offered the task it is part of and the goal it works towards as drop-down lists of every task and every goal of the project, built from the lists the pages hold whole. A board of a few hundred current tasks makes such a list unusable, and a form that needs the whole listing to render is a form that gets slower as the organization works more. The same holds, less sharply, for the goals.

## Decision

1. **A task has one owner and any number of workers.** The owner is whoever wrote it, as before. The workers are the people at work on it, each a person who may work in the project (`task.invalid_worker`), any number up to `MAX_WORKERS`, in the order they came to it; none, while nobody is. The API takes the workers whole (`workerIds`): the same people in another order are no change, and those left out go. Only the newcomers are checked, so that a person already on a task stays a fact of it whatever became of them. A run taking a task puts the agent's person among the workers, beside those there were, each once. The board, the calendars, who has what, a person's plate and the filters read the workers: a task counts for each of them, and a task with none is nobody's yet.
2. **What is set on a task is found by searching, a page at a time, never offered whole.** A listing is narrowed by the words of a title (`q`): every word a substring of it, whatever the case, in any order; a number, with or without its sign, finds the task of it. The roadmap is paged as the board is (`limit`, `offset`, `more`) and narrowed by whether a goal is open. The form's fields for the task this one is part of and for the goal it works towards are a picker: the first page as soon as the field is entered, the words' page once the typing rests, the next page on a press, what is chosen standing as a chip until cleared. The form receives nothing of either listing; it receives a search. The command searches the same way: `console tasks --search <words>`, `console goals --search <words>`.
3. **The pages still read the current tasks whole** ([ADR-0029](0029-a-task-done-or-dropped-is-put-away-out-of-the-board-and-open-by-its-number.md)), since the board, the calendar and the filters draw them all, and the goals the same, page after page now that they are paged. A cursor in place of the offset stays open ([architecture.md](../architecture.md), open question 16).
4. **The column the assignee had stays one release**, unused, as the rollout contract asks (expand, then contract): the migration copies each assignee into `task_workers` and drops nothing; the next release drops the column and its index.

## Consequences

- Who is at work on a task is true when several are, a take adds a person instead of replacing one, and a person's own work lists every task they are on.
- A form costs the same whether the project holds ten tasks or ten thousand, and a parent is found by typing a word of its title, or its number, as an agent finds it with `--search`.
- One more table is read with every task, aggregated as JSON in the same query: a page of tasks stays one query.
- The patch replaces the set: a script that adds a worker reads the task first, as the console does when a run takes one. A flag that adds or removes one person is a question for when it is asked.
- Rejected: a fixed number of worker columns on the task (a set is what the work is); the owner as one of the workers (the owner answers for the task, the workers do it; they are often the same person and need not be); a picker over the lists the page holds (the form must not depend on the whole listing, which is what this decision removes); the database's text search for titles (a title is a line, and a substring per word is what a person expects of a picker; the documents keep their text search, [ADR-0009](0009-documents-are-pages-of-markdown-in-a-project-addressed-by-path-versioned-and-linked-both-ways.md)); a search that reads the archive (what a task to come is part of is current).
