# ADR-0068: A decision reaches whom it is addressed to wherever it is, and a plugin's reaches the managers above them

- Status: Accepted; a person's own decision reaching past its project is amended by [ADR-0077](0077-a-persons-own-decision-is-its-projects-and-reaches-nobody-out-of-it.md), a person's own decision being its project's; extended by [ADR-0080](0080-a-plugin-reaches-the-projects-it-is-placed-on-and-whoever-may-use-it-is-a-requester-in-its-board-project.md), a requester raising a plugin's decision in a board project they may not see
- Date: 2026-11-08
- Extends [ADR-0042](0042-a-decision-is-addressed-to-a-person-its-raiser-unless-another-is-named.md) and [ADR-0057](0057-a-decision-may-be-addressed-to-several-people-and-the-first-answer-ends-it.md), which address a decision to people of the project, and [ADR-0052](0052-a-plugins-board-is-a-project-made-or-chosen-when-it-is-enabled-and-what-it-puts-there-carries-its-name.md), whose board project is private. The contract is in [specs/rest.md](../specs/rest.md), [specs/cli.md](../specs/cli.md) and [specs/plugins.md](../specs/plugins.md).

## Context

A plugin's board project is private, made when the plugin is enabled. The first plugin, for leave, raises each request as a decision there, addressed to the person's manager, whom the directory names. Two things followed. A manager is whoever the People page says, not a member of the plugin's project, so the decision could not be addressed to them (`decision.invalid_decider`), and the plugin fell back to whoever it could name; listing every manager in the project would show each of them everyone's requests. And the person who requested, an agent of theirs, could not wait for the decision: `console decision <id>` reads a decision through the project, which the checkout does not name and which the person may not be in at all.

Under the plugin's own rule, whoever is above the nearest manager holds what the manager holds, so a request that waits on someone away should be answerable by the person above them, who is no more a member of the project than they are.

## Decision

1. **A decision addressed to a person is theirs wherever it is.** They find it among their decisions and on their plate, read it and answer it, in a project they may see or not. The same for the person who raised it, to read. Nothing else of the project opens: the project itself, its board, its other decisions stay not found.
2. **A plugin's decision may address anyone active of the workspace,** since a plugin names who decides from the directory and not from the project; a decision a person raises still names people who may work in the project, as ADR-0042 has it.
3. **A plugin's decision reaches the managers above whom it is addressed to:** whoever manages a decider, directly or up the reporting line, reads and answers it as the decider would. A person's own decision climbs no line.
4. **A decision has an address of its own:** `GET /api/v1/decisions/<id>` and `POST /api/v1/decisions/<id>/answer`, for whoever it reaches; `/decisions/<id>` on the pages, where a plugin's page sends a person who may not be in the project. The command reads a decision through the project it works in as before, and then wherever it is, so that `console decision <id> --wait` works from any checkout; a command that raised one is told the project it waits in.
5. **A role may follow the reporting line:** a plugin declares `follows: "reports"` on a role, and whoever someone active reports to holds it, read from the directory on every call and granted by nobody, so that a page or a widget for managers shows to managers alone.

## Consequences

- A manager approves from wherever they are: My decisions, their plate, the decision's own address, or the command; and the person above them where they are away. Nobody is listed in a project to answer one question.
- An agent waits for a plugin's decision with the one command it knows, bound to any project or none.
- What reaches a person past a project is one decision: its question, its options, its files and its answer, with the project's name and key. A private project is otherwise as closed as before, and the policy says in one place who reaches what (`decisionReachableBy`, `decisionAnswerableBy`).
- The climb follows the directory's line, which never loops, and stops with it; a person's own decision never climbs, so that naming someone in a project opens nothing to their managers.
- Rejected: listing the managers in the plugin's project (every request to all of them); a decision addressed to a person who may not work in the project for people too (the project's own decisions stay the project's); answering by the raiser outside the project (they read, as before).
