# ADR-0077: A person's own decision is its project's, and reaches nobody out of it

- Status: Accepted
- Date: 2026-11-08
- Amends [ADR-0068](0068-a-decision-reaches-whom-it-is-addressed-to-wherever-it-is-and-a-plugins-reaches-the-managers-above-them.md), whose first point made a decision addressed to a person theirs "wherever it is", a person's own decision as much as a plugin's. The contract is in [specs/rest.md](../specs/rest.md) and [specs/plugins.md](../specs/plugins.md).

## Context

ADR-0068 let a decision reach past its project so that a plugin, which names who decides from the directory, could ask a manager who is not in its private board project. It said so of every decision: one addressed to a person is theirs wherever it is, and whoever raised one reads it. A person's own decision addresses people who may work in its project ([ADR-0042](0042-a-decision-is-addressed-to-a-person-its-raiser-unless-another-is-named.md)), and ADR-0068 rejected addressing anyone else: the project's own decisions stay the project's. Yet one addressed to someone who then left a private project, or raised by them, went on reaching them: they read its question, its context and its files, answered it, and found it among their decisions and on their plate, in a project closed to them. Taking a person out of a private project is how the project is closed to them, and permissions fail closed.

## Decision

1. **A person's own decision is its project's.** Whom it is addressed to and who raised it reach it, at its address, among their decisions and on their plate, only while they are members of its project or administer the workspace. Out of the project it is not found, as nothing else of the project is; listed again, they have it back.
2. **A plugin's decision reaches past its project as ADR-0068 has it:** whom it is addressed to, who raised it and the managers above a decider, wherever they are.
3. **What a plugin answers for a person is held to the same** ([ADR-0076](0076-a-plugin-acting-for-a-person-stands-as-a-member-and-answers-only-what-is-on-their-plate.md)): a person's own decision is on their plate only while they are a member of its project.

## Consequences

- Taking someone out of a private project takes its decisions from them, those addressed to them included. A decision stays open in the project, where anyone of it may answer it.
- A plugin's decisions are as before: a manager answers a request in a board project they are not in.
- The rule is one place in the policy (`decisionReachableBy`, `decisionOnPlateOf`, `decisionWaitsFor`, `decisionRaisedBy`), read by the decision's address, its files, the answer, My decisions, the plate and the count beside My decisions alike.
