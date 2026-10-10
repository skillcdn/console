# ADR-0009: Documents are pages of Markdown in a project, addressed by path, versioned, and linked both ways

- Status: Accepted
- Date: 2026-10-10

## Context

The board holds what is to be done and what was decided; the knowledge the work rests on, playbooks, designs, notes, findings, has no place of its own and lives in conversations, in agents' memories or in files on machines. People and their agents need to write it down next to the tasks, refer to it from tasks and decisions, find it again, and see what rests on a page before changing it. A decision, answered once, is read later as a record: what it rested on, why it was answered so, what followed. This is open question 11 of [architecture.md](../architecture.md).

## Decision

1. **A document is a page of Markdown in a project**, with a title, kept under a path: lowercase segments of letters, digits and hyphens, separated by `/`, as a repository keeps files. The path is the document's address and does not change; the folders are what the paths say, and a folder exists while a page is in it. What a person, and the agent acting for them, may do with a project's documents is what they may do with its board: read them when they may see the project, write them when they may work in it.
2. **Every write is a version**: the title and the body as they were, who wrote them, through which agent, and when. The document is its latest version; the earlier ones stay readable. A writer may say which version they started from, and is refused when the document has moved on since.
3. **Links are kept both ways.** A Markdown link whose destination is a document path, read from the project's root wherever the link is written, refers to that document, whether it exists yet or not. Written in a document, in a task's body, or in a decision's context, answer or outcome, the link is recorded when the text is, and a document's page says what refers to it.
4. **Nothing is deleted: a document is archived**, and may be restored. Archived, it is kept out of the folders and the search, readable at its path, and not written to.
5. **A folder lists its pages and its folders; a search finds pages by their words**, in the title and the body, within a project, through the database's own text search.
6. **Files attach to a document** as a run hands them in: kept in the blob store under their hash, named, bounded in size and in number, and read back by whoever may see the project.
7. **A decision reads as a record**: its context, what a person needs to know, in Markdown; the answer with the rationale given alongside it; and what followed, written afterwards by whoever works in the project. The record is the decision's own, kept on it, not a document.
8. **The surfaces follow.** The REST API serves documents under `/api/v1/projects/<key>/docs`, with the path as one encoded segment of the URL; the command gets `docs`, `doc`, `write`, `attach`, `archive` and `restore`; the default UI puts a project's documents under `/p/<key>/docs/<path>`.

## Consequences

- The organization's knowledge is on the board with its work, written by people and agents alike, attributed as everything else is, and readable from the pages and the command.
- Rendering stays what it is: Markdown to elements, never HTML, no plugins, no syntax of the console's own; a link to a document is a link to its page in the project.
- A path cannot change. Moving a page is archiving it and writing it at the new path; should moves be needed, they come with the links rewritten, in a decision of their own.
- The search is the database's: words, in the languages its parser knows. Good enough for a project's pages; a search service is neither needed nor planned.
- Bodies, versions per document and files per document are bounded; what grows past a bound is split into pages.
- Rejected: documents as a git repository served through SkillCDN (the organization's playbooks and skills stay there; the console's documents are the work's own record, written by agents mid-run, with no commit in the way); a wiki syntax such as `[[path]]` (Markdown has a way to link already); links resolved from the document's folder (two readers would resolve one link differently, and a link copied elsewhere would break); deleting documents (what referred to them would dangle); a decision as a document (a decision is a question answered once, and its record grows on it).
