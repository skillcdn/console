# ADR-0153: The `codex` driver speaks to the product's app server and takes a message in a turn

- Status: Accepted
- Date: 2026-11-24
- Amends points 2 and 3 of [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md) in how the `codex` driver runs its product, a process a turn there; both stand otherwise, and so does the driver's interface. The contract is in [specs/runner.md](../specs/runner.md#the-codex-driver).

## Context

What an agent is sent while it works is read after the tool call under way where its driver can put a message into a turn, and after the turn where it cannot (ADR-0085, point 8). Only the `claude` driver could. The `codex` driver ran `codex exec --json`, a process a turn, which takes nothing once the turn began: a supervisor's words waited out the turn, however long it ran, or stopped it. ADR-0085 named the way out and left it for later: the product's app server, which takes a message in a turn.

Looked at on 2026-11-24. The app server is what the product's own terminal and its editor extension speak, and the binary writes its protocol out. `turn/steer` puts input into the turn under way, and is there in one shape from 0.139.0 to 0.172.0; the product's help still calls the app server experimental. Spoken to signed out, three builds answered alike but for one thing: 0.139.0 answered that a message was put into a turn and, the turn being stopped before it was read, kept nothing of it.

The Agent Client Protocol was looked at the same day, since the `acp` driver waits for a turn's end too.

## Decision

1. **The `codex` driver runs the product as its app server, one process a session:** `codex app-server`, a JSON-RPC message a line on its standard input and output. The conversation is a thread of the product's, begun or gone on with when the session opens. What a desk says of the driver stays: its name, its modes, the model and the effort, the product's own sign-in.
2. **A message that arrives while a turn runs is put into that turn** (`turn/steer`), where the product reads it after the step under way; one that is to be read now stops the turn first (`turn/interrupt`). The driver says that it steers.
3. **A message is taken when the product says it back,** under the id the driver handed it over with, the one a turn starts with and one put into it alike. One that was put in and not said back by the turn's end is the next turn's, before whatever else waits: handed over once more, and never let go without a word.
4. **Only what the product offers outside its experiments is spoken.** The driver asks for none of them, reads whole blocks, and refuses and records what the product asks of a person.
5. **The `acp` driver stays as it is.** The protocol's version 1 has no message in a turn. Its version 2 has a client prompt while the agent works, and is a preview that may change in any release. The two adapters the driver was run against take a request of their own beside the protocol, which answers that a message joined the turn and never that it was read; one of them lets go of it where the turn is stopped first. A driver that spoke it would say `taken` of what it cannot know, so it is not spoken. The driver takes a message in a turn when the protocol has one and says when it was read.

## Consequences

- A supervisor's words reach an agent on Codex after the step under way, as on Claude Code, and its page says so.
- A desk needs a Codex whose app server has these methods: 0.139.0 and later answered them. An older one does not start, with a line that says why. Nothing else of a desk or of setting a machine up changes, and the conversation a desk kept is gone on with.
- The product's process stays for the session, where a turn's process ended with the turn. A sign-in mended while it runs may take a `restart` to be read; that was not seen.
- The driver is held to a protocol the product may still change. A change shows as a product that does not start or a block that is not read, and the fixtures are written down again from the binary.
- No build is listed as tried until a turn of a signed-in product ran through the driver.
- An agent over the protocol waits for the end of a turn as before. Codex and Claude Code each have a driver of their own that does not.
- Rejected: a second driver beside `codex`, which is two ways to run one product and a choice every desk would have to make; `exec` kept inside the driver as a way back, which is two transports held to one contract for builds no desk needs; saying `taken` when the product answers that a message was put in, which is sooner and was seen to be wrong; the protocol's version 2 for `acp` now, which is another driver's worth of reading for a preview.
