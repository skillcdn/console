# ADR-0020: The console does not claim an agent is at work; a run says when it was last heard from, and a new run takes over

- Status: Accepted
- Date: 2026-10-11

## Context

A run began when an agent took a task and ended when the agent said so, or when a person marked it abandoned. In between, the board showed the task as "at work" by that agent: a badge on the card, a count on the project, and a refusal to any other agent sent to the task (`run.task_taken`). The console learns of an agent only from what it sends; it starts no agent and holds no connection to one ([ADR-0004](0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md), [ADR-0006](0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)). An agent killed with its terminal, one whose machine slept, one that simply stopped, left a run open and a task "at work" for nobody until a person noticed, and a second agent sent to the task was refused by a run that would never end. A claim the console could not check was shown as a fact, and it was in the way.

## Decision

1. **The console makes no claim about whether an agent is at work.** A run is the record of what an agent did on a task for a person: when it began, what it reported, what it handed in, what it asked, and when it was last heard from (`lastHeardAt`: its start, then each report, hand-in and question). An open run is one that has not ended; the pages say "open" and when it was last heard from, never "at work". The board's cards, the list of projects and the people's pages carry no agent-at-work badge or count; a task and a project keep `openRuns` as a number, for whoever wants to look, and nothing more is read into it.
2. **A run begun on a task takes over the one open on it.** Taking a task with a run open on it ends that run as `abandoned`, with a summary that says who took over, and tells the board (`run.taken_over`, naming the agent that was at it); the new run begins as any run does. The refusal `run.task_taken` is gone. A person who sends a second agent to a task has decided; an agent sent to a task reads the runs on it first, and the skill says so.
3. **Nothing ends a run by itself.** A run not heard from for long stays open until an agent takes the task over or a person marks it abandoned; the moment it was last heard from is there to judge by.

## Consequences

- A person reads from a run when it was last heard from and decides; the console shows what it knows and not what it guesses. A task whose agent is gone is taken by the next agent without a person first marking anything.
- Two agents sent to one task by mistake end up with one run and one abandoned run that says who took over, in the feed and on the task: a visible mistake, not a silent refusal, and the person who sent the second one sees it at once.
- `lastHeardAt` moves only with what the agent sends through the run. An agent working long without reporting looks silent, which is right: reporting at the milestones is what the skill asks of it.
- Rejected: heartbeats from the command (a process that is killed sends none and a process that hangs sends them anyway, so a heartbeat would say no more than the last report does, at the cost of traffic and a timer); the board ending a run itself after a quiet while (a threshold right for one kind of work is wrong for another, and the console would be claiming to know again; left open, with the last-heard moment there should it come back); keeping the refusal behind a flag to force past it (every agent would learn to force, and a person's decision to send a second agent is the force already).
