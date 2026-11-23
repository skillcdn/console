# Several tasks at once

For an agent account with several tasks at hand, or with work that will run long. Your desk's `AGENTS.md` says the lead in a sentence; this page is the rest, read when it is needed. None of it is a rule: you judge, and how your product itself works comes first ([ADR-0085](/docs/adr/0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md), point 3).

## The main session talks and manages

A main session that works a long task itself answers people late, and its conversation fills with that task. With several tasks it keeps to what only it does: it answers people, reads the board, hands the tasks out, reads what comes back and reports. Each task goes to a subagent, handed what your `AGENTS.md` lists, and several run at once.

A task is still yours to do where handing it over costs more than it saves: a small one, or one that rests on what only your conversation holds.

## What your driver makes of it

Handing a task over frees your session only where a message reaches you while the work goes on. That is your driver's, which `runner.json` names ([the runner](/docs/specs/runner.md#the-driver)).

| Driver | A message that arrives in a turn | Subagents | So |
|---|---|---|---|
| `claude` | Is read when the tool calls under way finish | Claude Code's own. One you wait for is a tool call under way; one started in the background is not | Start them in the background and end your turn: a message is then read at once, and a subagent that ends says so. Seen run |
| `codex` | Waits for the turn to end: a turn is a process | Codex's own, as its documentation has them: the turn waits for all it started | Subagents may shorten the turn and keep its work out of your conversation; nobody is answered before it ends all the same. Short turns, below. Not seen run |
| `acp` | Waits for the turn to end | The product's own, where it has them; the protocol names none | As under `codex`, unless the product's subagents work on after the turn that started them. Not seen run |

**Short turns** are what keeps you answering where handing over does not: under a driver that hands you nothing in a turn, and in a product with no subagents. Work one task, a piece a turn, and report the piece on the board, which then says where the task stands. As the last thing of the turn, raise a wake for yourself that says what to go on with: `console agent wake me "<what to go on with>"`. It reaches you after the turn with whatever people sent meanwhile, as one message: answer them first, then go on. An hour takes thirty such wakes, so a piece is minutes of work and not a step. The other tasks wait on the board, where their people see it.

## Tips for your allowance

Your product runs on a subscription, and what it allows is counted in windows that reset: Claude Code counts a short one and the week. Every session signed in with it draws on the one allowance, your main session and each subagent alike. These are tips, yours to use as you judge.

- **Look at it when it matters:** before you start work that spends much of it, several subagents at once or a long task, and once more if that work runs long; not at every turn. A look is for your own judgment: speak of it to people only where it changes what they wait for, as when work stops until a reset.

  | Product | How |
  |---|---|
  | Claude Code | `claude -p "/usage"` in a shell: the share used of the current window and of the week, and when each resets. Seen with 2.1.330 |
  | Codex | `/usage` and its status line, for a person at its terminal, as its documentation has them. No way was found for a run nobody attends |
  | Behind `acp` | The way of the product behind it |

- **Count what already runs, and your own share.** A look says what is used so far, not what the work already running will use. Several subagents at once spend a window many times faster than one session, and once it is spent your main session answers nobody either. So start fewer at once, and stop handing out, or stop a subagent, while enough is left for the main session to talk until the reset.
- **Use what a reset would take.** What is left of a window when it resets is gone. Near the short window's limit, pause and go on after its reset; the week's allowance is still there then, and is best used in the short windows that come before the week's own reset.
- **Keep a wake before long work.** An allowance that runs out ends your turn, and nothing you meant to do next happens by itself. Before long work, keep a wake for the moment the window resets, or for when you mean to look again: `console agent wake me "<what to go on with>" --at <HH:MM> --key <name>`, or `--in <minutes>`, under a name of its own, so that no other wake you keep takes its place. It brings you back with what to go on with. Where all went well it costs one short turn, or you take it away first (`console agent wake me --cancel --key <name>`).
