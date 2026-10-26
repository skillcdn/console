# ADR-0042: A decision is addressed to a person, its raiser unless another is named

- Status: Accepted
- Date: 2026-10-26

## Context

A decision waited for anyone of the project: the board showed it to everyone who could see the project, My work listed every open decision of every project a person could see, and nobody's page said which decisions were theirs to answer. In practice a decision has an answerer from the moment it is raised: an agent asks the person it works for, who is the one it waits for, and a person who raises one on the pages usually means a particular colleague, the owner of the project or whoever holds the budget. With several people on a board, each read every decision to find their own, and a decision nobody felt addressed by waited for all of them.

## Decision

1. **A decision is addressed to one person, the decider.** Raised from a run, it is addressed to the person the agent works for; raised on the pages or by `console ask`, to whoever raises it, unless they name another person of the project (`deciderId`; `--to <login>`): someone who may work in the project, as a worker of a task must, and nobody else (`decision.invalid_decider`). The decider is on the decision (`decider`) from then on and does not change.
2. **Anyone of the project may still answer.** The decider is whom the decision waits for, not a lock: a colleague who knows the answer gives it, as before, and the answer names who gave it. A decision shows whom it is for where that is not the one who asked.
3. **A person's decisions are one page.** My decisions, beside My work, lists the decisions addressed to the person across the projects they may see, the ones that wait first and oldest first, then the answered as the record (`GET /api/v1/decisions`, `console decisions --mine`); My work's decisions are those waiting for the person's own answer, and no longer every open decision in sight.

## Consequences

- A person opens one page and sees what waits for them; an agent's question reaches the one it was asked of, and a decision raised for a colleague reaches them without a message beside it.
- The pages that raise a decision take the project's members as the people to name, found by typing, under the same policy as everything else that names a person: a person who may not work in the project cannot be named, and the console says so rather than letting a decision wait for someone who will never see it.
- Existing decisions are addressed to whoever raised them, which is what they waited for in practice.
- Rejected: a decision addressed to several people, or to a role (an owner, an administrator), which brings back the question of whose it is; a decision only its decider may answer, which stops a colleague who knows from answering while the decider is away; and a decider changed after the fact, which would need a reason recorded, for a need nobody has had.
