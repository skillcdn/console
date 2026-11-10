# Spec: the runner

- Status: **Draft, written before the runner is** ([ADR-0085](../adr/0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md), [ADR-0086](../adr/0086-a-session-leaves-a-transcript-that-is-kept-for-good.md)). Milestone 42 of the [roadmap](../roadmap.md) builds it in the order this page is written in; a section says "built" in the change that builds it, and until then it is the contract the change is held to.
- Where things live: the runner, its modules and their registries in `packages/console/src/runner/` (`console runner`); what passes between it and the console in `@skillcdn/console/api` (the schemas) and [rest.md](rest.md#agent-accounts) (the routes); the console's side in `apps/console/src/http/` and `apps/console/src/db/queries/`.

The runner is the program on an agent account's machine that keeps its agent going with nobody at the screen. It runs in the agent's own OS account, signed in as the account ([ADR-0084](../adr/0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md), point 9): the command's session is its only credential to the console. It starts the agent's product as a child process, the product's own unmodified binary under the agent's own subscription; feeds it what the console sends; reports what the product does; and says every thirty seconds that it is there. The console calls no model API and starts no agent, still.

## Words

| Word | Meaning |
|---|---|
| runner | `console runner`: one process per agent account on its machine, started by hand or kept running by a service |
| product | The agent product the runner starts: Claude Code first. The runner never modifies it and holds none of its credentials |
| driver | The module that speaks to one product: starts it, sends it messages, reads what it does. `claude` first |
| wake source | A module that raises wakes from outside the console, a messenger say. `console`, the console's own stream of signals, is built in |
| service | The module that keeps the runner running across restarts of the machine: `launchd` first |
| boundary | What keeps one agent apart from another on a machine: `os-user`, an OS account each |
| session | The lifetime of one process of the product. One main session per agent account at a time |
| conversation | What the product resumes from one session to the next: continuous unless the configuration or a supervisor says otherwise |
| signal | What the console sends the runner for its agent: a record numbered per account, with who sent it |
| event | One whole block of a session's transcript, numbered per session by the runner |
| state | How the agent stands, in one word: `running`, `stopped`, `refused`, `failed`, `unheard` |

## The heartbeat

`PUT /api/v1/agents/me/runner`, every thirty seconds, and at once when the state changes. For an agent account on the session of its command signed in as itself, which is the runner's one credential: its browser, or a token it made, is `agent.own_command`. Built on the console's side ([rest.md](rest.md#the-runner-put-apiv1agentsmerunner-and-the-signals)). The body:

```json
{
  "state": "running",
  "reason": "started",
  "delivered": 8812,
  "session": "0199c4d8-0000-7000-8000-0000000000a1",
  "machine": { "name": "mac-mini", "os": "macOS 15.1", "user": "mira" },
  "runner": "0.4.8",
  "product": { "driver": "claude", "name": "Claude Code", "version": "2.1.0", "tried": true },
  "offers": { "models": ["opus", "sonnet"], "efforts": ["low", "medium", "high"], "steer": true, "images": true, "resume": true },
  "running": { "model": "opus", "effort": "high" }
}
```

- `state` is what the runner says of its agent: `running`, the session open or ready to open; `stopped`, by a supervisor's `stop`; `refused`, the model refused and the agent waits; `failed`, the product could not start or sign in. `unheard` is the console's word, never the runner's.
- `reason` is one of a short list, never what was said: `started`, `resumed`, `reset`, `completed` (a turn completed after a wait) for `running`; `stop` for `stopped`; `model_refused` for `refused`; `sign_in`, `start`, `crashed` for `failed`.
- `delivered` is the number of the last signal the runner handed to the product, `0` for none.
- `session` is the open session's id, or `null`.
- `machine`, `runner`, `product`, `offers` and `running` say where it runs, with what, what the product offers to choose from, and what the open session runs with; each a line, bounded. `tried` says whether the driver was tried with that version of the product.

The console answers what the account's settings are and where the record stands:

```json
{ "latest": 8815, "settings": { "model": "opus", "effort": "high" }, "state": "running" }
```

`latest` is the number of the newest signal of the account; `settings` is what its supervisors or the account chose, `null` each where nothing was; `state` is how the console has the agent, which is `stopped` whatever the runner says while a supervisor's `stop` stands. The console keeps when it last heard from the runner and claims nothing more ([ADR-0020](../adr/0020-the-console-does-not-claim-an-agent-is-at-work-a-run-says-when-it-was-last-heard-from-and-a-new-run-takes-over.md)).

A change of state is `agent.state_changed` in the workspace's feed, with `login`, `handle`, `state`, `was` and `detail`, the reason: by the supervisor whose `stop` stopped it, by the account for what its runner reported, by nobody for an account the worker found unheard, which it does for one whose runner was last heard from more than five minutes ago.

## Signals

A signal is a record of the console's, numbered per agent account from 1, whoever raised it:

```json
{
  "number": 8812,
  "kind": "tell",
  "by": { "id": "...", "login": "jane", "name": "Jane" },
  "agent": "Claude Code",
  "plugin": null,
  "source": "person",
  "key": null,
  "text": "Hold the release until the migration is checked.",
  "set": null,
  "attachments": [],
  "at": "2026-11-10T14:02:11.000Z"
}
```

- `kind`: `wake` (there is something to do), `tell` (a supervisor's words), `interrupt` (stop the current turn, then take these words), `stop`, `restart`, `reset`, `set` (the model and the level of effort, in `set`: `{ "model", "effort" }`, the whole choice from then on, either `null` for the product's own).
- `by` is the member who sent it, with the `agent` and the `plugin` they acted through, or `null` for the console itself.
- `source`: `person` (a supervisor's own signal), `board`, `schedule`, `messenger`, or `console` (the console's own housekeeping), with a reference in `key` (`#412`, `day`, a thread, `services`).
- `text` is a paragraph of up to `MAX_SIGNAL_LENGTH` characters; `attachments` the pictures sent with a `tell`, each `{ "id", "name", "size", "contentType" }`, which come with the agent's page: the list is empty until then.

`POST /api/v1/agents/<handle>/signals`, for a supervisor, with a session or a token, takes `{ "kind", "text", "set" }` and answers `201` with the signal. `tell` and `interrupt` need words; `stop`, `restart` and `reset` take them for the agent; `set` takes `{ "model", "effort" }`, one or both, a field left out staying as it is and `null` meaning the product's own again, each among those the runner last offered, where it offered any (`signal.not_offered`). A `stop` sets the agent's state to `stopped` at once, by whoever sent it, and it stays so until a `restart` or a `reset` is sent, whatever the runner says meanwhile.

`GET /api/v1/agents/<handle>/signals?before=&limit=` reads the record, the newest first, for the account's supervisors, and `GET /api/v1/agents/me/signals` for the account itself. A signal is not an event of the board's feed. Sending, the record and the stream are built on the console's side.

`GET /api/v1/agents/me/signals/stream?after=<number>` is the runner's: a stream of server-sent events, each `signal` with a signal as its data and its number as its id, from the number after `after` on, in order; a comment every fifteen seconds keeps the connection known to be alive. For the account on its command's session, and ended when that session is. The runner connects again from the last number it delivered, in `after` or as `Last-Event-ID`, so that nothing is lost and nothing delivered twice; a signal it raised itself, from a wake source on the machine, it reports with `POST /api/v1/agents/me/signals` (`wake` alone, with its `source` and `key`), which comes with the first wake source ([roadmap](../roadmap.md), milestone 43), and receives back in order like any other.

`interrupt` and `stop` are for the session open when they are sent: the runner delivers neither to a session begun later.

## How a signal reaches the product

A signal is fed into the open session as a message with a header, never by restarting the product:

```
[console k3f9a2 #8812 · tell · Jane (through Claude Code) · 14:02]
Hold the release until the migration is checked.
```

- The header is one line: `console`, the session's mark, the signal's number, its kind, who sent it or its source and reference (`board: #412 ready, by Tom`), and the time in the workspace's zone.
- The mark is six characters the runner makes for each session and tells the agent in the session's first message, with what a header is. Nothing outside the session knows it, so nothing the agent reads elsewhere can pass for a header.
- What came from outside the console, a messenger's message say, is carried in a block fenced longer than any run of fence characters it holds, after a header that names where it came from.
- `tell`, `wake` and the words of a `restart` or a `reset` are sent at the product's priority for "after the current tool call" where the driver can steer, after the turn otherwise; `interrupt` stops the turn first.
- Signals are grouped, never capped: the runner holds what arrives within 1.5 seconds and delivers one message, the signals in order under a header each, the same `source` and `key` merged with a count; beyond 20 signals or 16,000 characters a message, the rest is said as "N more" with the command that reads them (`console agent signals`).

What the agent itself does on the board raises no wake to it.

## A session's life

- There is one main session per account. The runner begins one when there is something to deliver and none is open: `POST /api/v1/agents/me/sessions` with what it runs (`product`, `model`, `effort`, `resumed`, `machine`, as the heartbeat spells them), answered `201` with the session, its id in it. A session begun while another of the account is open takes that one over: the console ends the older as taken over, as a run takes over a run.
- The conversation is the product's, resumed from the session before where the driver can (`resume`) and `conversation` in `runner.json` is `continuous`.
- A session ends when a supervisor stops or restarts the agent, when the process dies, or when the machine restarts: `POST /api/v1/agents/me/sessions/<id>/end` with `{ "how" }` (`stopped`, `restarted`, `reset`, `crashed`, `exited`), answered with the session; one that ended already stays as it ended, `taken_over` among it, which is the console's word. The next signal begins the next.
- **An agent that cannot go on waits.** The driver says that the model refused or that the product failed, and why. The runner reports the state and restarts nothing. A supervisor's signal (`source: "person"`) is tried at once, in the same conversation. What arrives by itself waits out a cool-down, fifteen minutes at first and twice as long after each try that ends the same way, four hours at most, and then goes together as one message. A turn that completes ends the waiting.
- A supervisor's `stop` ends the session, and nothing is delivered until a `restart` or a `reset`: what arrives meanwhile is kept and delivered then, grouped. `restart` begins the next session with the same conversation; `reset` with a new one, the agent told in its first message that it was reset, by whom, and that what it was doing is on the board and in its desk.
- `set` is applied through the driver at once where the product takes it in a running session, and at the next session otherwise; the heartbeat's `running` says what the session runs with.
- Nobody is at the terminal: what the product's policy does not allow is denied and recorded, and the tool by which the product would ask a person at its terminal is taken away.

## The transcript

Built on the console's side ([rest.md](rest.md#the-sessions-and-the-transcript)). The runner reports every event of the driver, in order, as whole blocks ([ADR-0086](../adr/0086-a-session-leaves-a-transcript-that-is-kept-for-good.md)): `POST /api/v1/agents/me/sessions/<id>/events` with a batch, about once a second while there is something to send:

```json
{ "events": [
  { "n": 41, "kind": "tool_call", "at": "2026-11-10T14:02:15.120Z", "text": "git status", "data": { "tool": "Bash", "id": "toolu_01" } }
] }
```

- `n` numbers the events of the session from 1, one after another. The console answers `{ "last": 41 }`, the number of the session's last event now. An event whose number the session has already is left as it is, whatever is sent, so a batch may be sent twice; a batch out of order is `transcript.out_of_order`, and one that would leave a gap is `transcript.gap`, with the number expected in its words, so that whoever reads from a number on misses nothing: the runner asks the session where it stands and sends from there. A batch is at most 100 events and 2 MiB; nothing is added to a session that is over (`transcript.session_over`).
- `kind`: `wake` and `person` (what the agent was sent, a signal's number in `data.signal`), `assistant`, `thinking`, `tool_call`, `tool_result`, `permission` (asked and how it was answered), `status` (the product compacted, the model changed, the session began or ended) and `error`.
- `text` is what a person reads, up to 256 KiB of UTF-8, and whatever the product said: markup, escapes and control characters are kept as they are and shown as text. The console keeps the beginning in the row, up to 16 KiB cut between characters, and the whole on the month's shelf of the blob store where it is longer; an event read back says `whole`, the size of the whole, and `.../events/<n>/text` reads it.
- `data` is a small object of facts about the block: up to 32 of them, each a word, a number, a yes or no, or nothing, under a name of up to 64 characters, a word up to 1,000. Never nested, shown as text and never run.
- `files` names the pictures of the block, up to 8, by the ids their upload answered: `POST /api/v1/agents/me/sessions/<id>/files`, a form with one part `file`, a PNG, a JPEG, a GIF or a WebP up to the bound on a file, answered `{ "id", "name", "size", "contentType" }`. An event names its own session's pictures and nothing else (`transcript.unknown_file`); a session hands in at most 60 a minute (`transcript.too_fast`).
- Before an event leaves the machine the runner takes out of it every value of the account's secret store, as it is and in the encodings a value is commonly carried in.

The console deletes none of it. `GET /api/v1/agents/<handle>/sessions` lists the sessions, the newest first, and `.../sessions/<id>/events?after=` reads the events, a page at a time, for the account's supervisors and for the account; `.../sessions/<id>/events/stream?after=` is the same as it happens, each `event` under its number, and an `end` with the session once it is over and everything of it was sent. A run the account's command begins while a session is open names it (`sessionId`), so that what the agent did for a task is found in its transcript.

Everything of a session is kept under the month it began in, by the clock everyone shares: its events and its pictures in tables of that month, and the bytes on the month's shelf of the blob store, a table of the month where the database keeps the bytes and the prefix `transcript/<month>/` in a bucket. The session's own row stays, and says `away: true` while its month is not with the database; its events then read as none, and an open session of that month takes nothing more (`transcript.away`). [deploy/README.md](../../deploy/README.md#the-transcript-of-a-month-that-is-past) says how a month is put away and brought back.

An administrator seals an event that must not be kept, `POST /api/v1/agents/<handle>/sessions/<id>/events/<n>/seal` with `{ "reason" }`: its text, its facts and its pictures are replaced by who sealed it, when and why, its bytes are taken off the month's shelf where no other event of the month says the same, and its number, its kind and its time stay. Nothing else of a transcript changes, ever.

## `runner.json`

In the desk, the working directory the runner is started in; written by setup, the agent's from then on; no secret in it.

```json
{
  "driver": "claude",
  "wake": ["console"],
  "conversation": "continuous",
  "secrets": { "env": { "GIT_TOKEN": "git.token" }, "files": { ".netrc": "netrc" } },
  "autosave": true
}
```

- `driver`: the product's driver, `claude` when the file names none. `wake`: the wake sources beside the console's own.
- `conversation`: `continuous`, or `daily` or `weekly` to begin a new conversation with that briefing when the session is idle then.
- `secrets`: which secrets of the account's store the runner hands a session, as environment variables and as files of mode 600 under the desk's ignored `work/`, written at the session's start and removed at its end.
- A runner started where there is no `runner.json` runs with these defaults and hands the session no secret.

## The driver

A driver is a module of the package's registry, a product each:

```ts
interface Driver {
  readonly name: string;
  /** What the product is called, and the versions of it the driver was tried with. */
  readonly product: { readonly name: string; readonly tried: readonly string[] };
  /** What the installed product is and offers, asked without starting a session. */
  probe(): Promise<{ version: string | undefined; models: string[]; efforts: string[] }>;
  /** Starts the product: resuming the conversation before where `resume` is given, with a model and an effort where they are. */
  start(options: StartOptions): DriverSession;
  readonly can: { readonly steer: boolean; readonly images: boolean; readonly resume: boolean; readonly set: boolean };
}

interface DriverSession {
  /** A message for the agent, with pictures; `now` stops the turn first, `next` goes after the current tool call. */
  send(message: { text: string; images: Picture[]; priority: "now" | "next" }): Promise<void>;
  interrupt(): Promise<void>;
  /** The model and the effort, where the product takes them in a running session; false where it does not. */
  set(choice: { model?: string; effort?: string }): Promise<boolean>;
  stop(): Promise<void>;
  /** What the product does, as whole blocks, until it ends. */
  readonly events: AsyncIterable<DriverEvent>;
}
```

A `DriverEvent` is a transcript event before its number (`kind`, `text`, `data`, attachments), or one of the driver's own words to the runner: `turn_completed`; `cannot_go_on` with `refused` or `failed` and a reason of the heartbeat's list; `conversation`, the id the product resumes from next time; `ended`, with how.

### The `claude` driver

The Claude Code binary, unmodified, over its streaming JSON input and output, as its own documentation has them. What the documentation states is relied on; what it leaves unsaid is held by fixtures recorded per version of the binary, in tests that call nobody, and a version the driver was not tried with is started all the same and said on the Live page.

- **Started** as `claude -p --input-format stream-json --output-format stream-json --verbose`, in the desk, with `--model` and `--effort` where the account's settings name them, `--resume <id>` where a conversation is resumed, `--settings` naming the settings setup wrote, and `--permission-prompts none`: nobody is at the terminal, so what would prompt is denied, the agent is told not to try it again, and the tool that asks a person at the terminal is taken away. The process stays open, reading one message a line from its standard input.
- **A message** is one line: `{"type":"user","message":{"role":"user","content":[...]},"parent_tool_use_id":null,"priority":"next"}`, the content a text block and an image block for each picture (`base64`, of the kinds the product takes). `priority` is the product's own: `next` is read when the tool calls under way finish, or starts the next turn; `now` stops the turn first, which is how an `interrupt` with its words is delivered. A build that does not take `priority` on its input delivers after the turn, and the driver says `steer: false` of it.
- **What it reads**, a line each: `system` with `init` (the conversation's id as `session_id`, the model, the effort, the product's version) becomes a `status` event and the driver's `conversation`; `assistant` becomes `assistant`, `thinking` and `tool_call` events, a block each; `user` carrying tool results becomes `tool_result` events, a picture among them an attachment; `system` with `compact_boundary`, `api_retry` or `permission_denied` becomes `status`, `error` and `permission`; `result` ends a turn: `turn_completed`, with the denials of `permission_denials` as `permission` events.
- **An agent that cannot go on.** A result that says the model would not answer, by its `stop_reason` or by the product's own words for it, is `cannot_go_on` with `refused` and `model_refused`. A result or an exit that says the product is not signed in, its login expired or its key is refused is `failed` with `sign_in`; a process that does not start is `start`, and one that dies mid-turn `crashed`.
- **The model and the effort** are the product's aliases and levels, as its documentation lists them; the binary offers no list of its own to ask. They are given when the process starts, so a `set` is applied at the next session: the runner begins that session, with the same conversation, as soon as no turn is under way, and at once for an agent that waits.
- **Stopping**: the standard input is closed and the process is given a moment to end; then it is ended. A turn alone is stopped with the signal the product documents for it.
- **Signing in** is the product's: a subscription signed in through its own flow in the agent's OS account, or the long-lived token its own command issues, which the runner provides in the environment the product reads it from when `runner.json` maps a secret to it. The driver never reads or keeps either.
