# ADR-0008: A workspace holds projects, and what a person may see and change is decided per project

- Status: Accepted
- Date: 2026-10-10

## Context

The board was one: every task, run and decision of the workspace, seen and changed by every member. An organization runs several efforts at once, each with its own people, its own playbooks and skills, and soon its own documents; who may see what has to be decided per effort, and a person's agent must be held to the same line as the person. The first agents at work also showed two gaps: what an agent does to a task itself, taking or editing it, should name the agent as a run does, and everything that happened to one task should be readable in one place. This is open question 5 of [architecture.md](../architecture.md).

## Decision

1. **A project is the unit of work and of permission.** A workspace holds projects. A project has a key (short, lowercase, immutable: what paths and the command say), a name, a description, a visibility, and a skills address or none. Every task, run and decision belongs to one project, tasks are numbered per project, and the events about them carry the project.
2. **Sign-in, membership, roles and tokens stay the workspace's.** A person is a member of the workspace as before, and a token is its person. Within a project a person is an `owner`, who configures it (its settings, its members), or a `member`, who works on it. A workspace administrator is an owner of every project. A project's visibility is `workspace`, every member of the workspace being a member of it, or `private`, only those listed. Whether a person, or the agent acting for them, may see or change anything in a project is decided on every request from these records; a project that cannot be confirmed theirs is not found.
3. **The REST API nests the board under the project** (`/api/v1/projects/<key>/...`): the tasks, the decisions, the runs and their files, the events with their stream, and the skills. The projects and their members are resources of their own; the people, the tokens and the workspace's own events stay at the workspace. Configuring a project, making one, its settings, its members, is a person's own doing on the console's own pages, never with a token, as roles and tokens are.
4. **The skills address is the project's.** The deployment's `SKILLS_ADDRESS` stays as the organization's default for a project that names none.
5. **Every event says who, and as which agent.** An event made with a token carries the name of the agent beside the person, so that a task an agent edited reads as a run does. The events about one task, one run or one decision are read from the project's feed by a filter, which is how a page shows everything that happened to it.
6. **The command takes a project**: `--project`, else `CONSOLE_PROJECT`, else `.skillcdn-console.json` in the working directory or one above it, which `console use` writes. The default UI routes a project's pages under `/p/<key>`.

## Consequences

- One function decides access for every route of the board, before any work is done, and nothing a person may not see is found.
- A breaking change to the REST API, the package and the default UI before 1.0: the paths, the client (`client.project(key)`), the pages. Released on the 0.1 line with a changelog that says so ([ADR-0007](0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md)).
- The migration makes a project `general` of visibility `workspace` in every workspace and moves the board into it, so that nothing is lost and nobody loses sight of it.
- A second workspace in one deployment is less likely to be needed; the question stays open.
- Rejected: the project as a parameter of flat paths (every route would decide access from the item it finds, after finding it); roles at the workspace only (a private project would need a second workspace); the project remembered in the person's credentials file (a file in the checkout is shared by everyone who works in it and by every agent they run); a read-only role (a member who should not change a project is not in it, until a need appears).
