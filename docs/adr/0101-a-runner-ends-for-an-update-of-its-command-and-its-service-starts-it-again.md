# ADR-0101: A runner ends for an update of its command, and its service starts it again

- Status: Accepted
- Date: 2026-11-12
- Amends point 13 of [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md), which had an update of the command take effect when the runner is started again, "which the runner does not do for itself", and had a runner refused as too old tell its agent only to say so to whom it reports to. The rest of that decision stands.

## Context

The command and the console go together by version ([ADR-0025](0025-the-command-names-its-version-on-every-request-and-the-console-holds-it-to-the-range-it-takes.md), [ADR-0038](0038-the-command-and-the-console-go-together-within-a-line-and-a-release-that-changes-what-passes-between-them-raises-the-floors.md)): a console of a new line refuses the commands of the line before. An agent account keeps its command current itself, as its base instructions ask ([ADR-0088](0088-an-agent-account-has-a-desk-and-is-set-up-from-an-invitation-by-signing-in-as-itself.md)). The runner is that command, running: it read its code when it was started, and goes on running it after the package was replaced under it. Until someone started it again the machine had the new command and ran the old runner, which a console that had moved on refused, and nobody is at the machine. A runner refused as too old told its agent to tell its manager, who could do nothing about a machine without going to it either.

Each service that keeps a runner starts it again whenever it ends.

## Decision

1. **The runner looks at the version of the package it runs from at every heartbeat,** as the package's manifest on the machine says it now. A version other than its own, seen twice running, a heartbeat apart, is an update: twice, so that an install under way has put its last file down before the runner is started on it. A manifest that does not read says nothing.
2. **It ends for the update when no turn is under way,** at once where none is. From the moment the update is seen nothing more is handed to the product; the turn under way ends in its own time; the open session ends as `restarted`, with a line on its record that says why; and the runner ends as it ends when it is stopped. What it was sent and did not hand over is the console's to send again, in order, to the runner started after, whose next session goes on with the same conversation.
3. **Its service starts it again, and nothing else does.** The runner starts no process in its own place: it ends with exit code 0, and the service that keeps it starts the new command, as it starts the runner after any end. One started by hand ends too, says so, and is started again by hand.
4. **A runner the console refuses as too old tells its agent what installs the console's version,** once, in the open session: the command for the way this command was installed, a machine's package manager, a project's or a checkout's build, at the version the console's answers name. The agent installs it as it installs any update, and the runner takes it (points 1 to 3). Where the agent cannot, it says so to whom it reports to, as before. With no session open there is nobody to tell: the runner's own output carries the same command, for whoever reads it.

## Consequences

- An update needs nobody at the machine: the agent installs it, the runner takes it within a minute of the last turn's end, and the console hears from the new version.
- The cool-down of an agent that could not go on is not kept across the end: what arrives by itself is tried once when the runner starts again. A supervisor's stop is kept, since the console holds it.
- The command's entry point reads the package's manifest again every thirty seconds, a file of a few hundred bytes. `RunnerOptions` gains `installed` and `updateCommand`, both optional: a runner given neither behaves as it did.
- A version below the runner's own is taken as one above it is: the runner runs what the machine has.
- Rejected: the runner replacing its own process (a service that keeps a process knows nothing of one started in its place, and a second runner of the account takes the first one's session over); ending in the middle of a turn (work would be cut for an update that can wait for the turn); the runner installing the update itself (what is installed on a machine, and when, is the account's and its organization's, and a console that could have every runner install a version would be a way onto every machine); acting on a version seen once (a manifest may be written before the files beside it).
