// How much of anything the console takes in. Every text a person or an agent writes is bounded
// at the edge (AGENTS.md, rule 2); these are the bounds, shared by the server that enforces them
// and the pages that say so before a request is made.

/** A task's title, a decision's question: one line. */
export const MAX_TITLE_LENGTH = 200;
export const MAX_QUESTION_LENGTH = 500;
/** A body in Markdown: a task's, or the context of a decision. */
export const MAX_BODY_LENGTH = 20_000;
/** The links of a task: a repository, a pull request, a document. */
export const MAX_LINKS = 20;
export const MAX_LINK_LABEL_LENGTH = 120;
export const MAX_URL_LENGTH = 2048;
/** The options of a decision, and how a person words each. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const MAX_OPTION_LABEL_LENGTH = 120;
/** What a person adds to an answer. */
export const MAX_NOTE_LENGTH = 2000;
/** How many tasks or decisions one listing answers with. A board is read whole, for now. */
export const LIST_LIMIT = 500;
/** How many events one page of the feed carries. */
export const EVENTS_PAGE_LIMIT = 100;
/** What an agent calls itself when it takes a task: its kind, where it runs. One line. */
export const MAX_AGENT_LENGTH = 80;
/** What an agent says when it ends a run. Markdown. */
export const MAX_SUMMARY_LENGTH = 2000;
/** How many reports, and how many artifacts, one run may carry. */
export const MAX_REPORTS_PER_RUN = 500;
export const MAX_ARTIFACTS_PER_RUN = 50;
/** A file a run hands in: how many bytes, and its name, one line without a path. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH = 200;
/** What a person calls a token: the agent it is for, where it runs. One line. */
export const MAX_TOKEN_NAME_LENGTH = 80;
/** How long a token may be good for, in days, and how long one is when nothing is said. */
export const MAX_TOKEN_DAYS = 365;
export const DEFAULT_TOKEN_DAYS = 90;
/** How many tokens one person may hold at a time. */
export const MAX_TOKENS_PER_PERSON = 25;
/** A project's key, what paths and the command say: lowercase letters, digits and hyphens. */
export const MAX_PROJECT_KEY_LENGTH = 40;
/** A project's name, one line, and its description, a paragraph. */
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 500;
/** The address of a project's skills, as the standard spells one; the console checks it as one. */
export const MAX_SKILLS_ADDRESS_LENGTH = 2048;
