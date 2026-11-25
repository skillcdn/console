# ADR-0165: A plugin reads what its caller chose to be told of, and nobody else's

- Status: Accepted
- Date: 2026-11-25
- Adds to [ADR-0157](0157-the-console-decides-who-is-told-of-what-and-keeps-the-record-and-a-plugin-carries-it-out.md), under which the console decides who is told of what and a plugin with `notifications:read` carries it elsewhere.

## Context

A plugin that carries notifications to a messenger lets a member choose which of them it sends there, on a page and by a command of its own, and keeps the choice itself. What it sends is at the most what the console tells: a kind that is off in the console makes no notification to carry. The plugin could not read which those are. Its page showed every kind as on that the member had chosen there, the eight of nine among them that are off for a person who chose nothing in the console, and `data.told` does not tell a kind that is off from a thing that did not happen.

## Decision

1. **`ctx.console.notifications.settings()`** answers what the caller chose to be told of, as `GET /api/v1/notifications/settings` answers it: the kinds on and off, the defaults, the projects turned off and whether their own agents count.
2. **It is the caller's own, in a call of their own.** A person from a page or by the command, their agent, and an agent account. A hook, a job, a plugin as itself and a call a plugin makes for a person (ADR-0072) are refused (`plugin.forbidden`): under a capability to act for people, the last would read anyone's.
3. **The projects named are those the plugin is on**, of those the caller may see: a person's call takes a plugin nowhere it is not placed (ADR-0080).
4. **Under `notifications:read`, as it stands, with no consent asked anew.** Its reach was "what each member chose to be told of" already, read from whom the console told over time; the sentence an administrator reads says the settings of whoever uses it from now on.
5. **It is read and never written.** The console's settings are changed at the console, as ADR-0157 has it.

## Consequences

- A plugin shows a kind that is off in the console as off, and says why nothing of it comes, with the member's own choice there kept as it was.
- A plugin that runs on a console of before asks whether `ctx.console.notifications` is there.
- Rejected: the settings of any member by their id, which no page or command needs; the settings beside each `told`, which is of events and not of a page; a capability of its own, an administrator asked twice for what one sentence covers.
