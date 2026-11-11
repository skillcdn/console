# ADR-0095: A tell carries files of any kind, handed to the agent in its desk

- Status: Accepted
- Date: 2026-11-12
- Extends [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md) (a driver takes a message with its pictures) and [ADR-0086](0086-a-session-leaves-a-transcript-that-is-kept-for-good.md), point 4, under which a `tell` takes files as a comment takes them and the runner hands them to the driver as image blocks: what was built took pictures alone, and a product that takes no picture was handed nothing and told nothing.

## Context

A supervisor says something to an agent on its page and sends pictures with it. Only pictures: a spreadsheet, a document, a log could not be sent, where every agent product lets a person hand it a file. And a picture reached the agent only where its driver took pictures as bytes. The `codex` driver said it took none, since the product takes a picture as a file and the driver had nowhere to write one; a picture sent to such an agent stayed on the signal's record and was left out of what the product was handed, with nothing said to the agent and nothing to whoever sent it.

The product does take pictures. Run against the binary (0.167.0), `codex exec -i <file>` and `codex exec resume -i <file>` attach a picture to the prompt, and the product described the pictures it was handed. What was missing was a place for the file.

An agent has such a place: its desk, with `work/`, which the desk ignores and where a session's own files are written already.

## Decision

1. **A `tell` and an `interrupt` carry files of any kind,** up to eight, together within the bound on a file. A picture is one by its bytes, a PNG, a JPEG, a GIF or a WebP, whatever it was called, and is the one kind shown in place; any other file is kept as what its sender called it and handed over to save, never shown in place and never run; a file called a picture that is none by its bytes is kept as bytes of no kind. A signal still needs words: a file alone says nothing an agent can act on.
2. **The runner writes every file of a signal in the desk,** at `work/inbox/<number>/<name>`, for its owner alone, before the message is handed over. The name is made one segment first: nothing a file system reads as a path, a drive or a pattern, no control character, no bracket, and a second file of the same name numbered. The files are the agent's from then on, to open, to pass on, to attach elsewhere, and to remove; the desk ignores `work/`.
3. **The message says each file on a line of its own,** after the signal's words and under its header, with the session's mark as a header carries it: where it is in the desk and what it is, or that it could not be handed over, with whom to ask. Nothing is dropped unsaid.
4. **A picture is handed to the product as a picture too, where the product takes one:** as its bytes where the driver takes bytes, by its path in the desk where the product takes a file (`can.imageFiles`). Where the product takes none, the line says so and tells the agent to open the file. A session says whether its product takes pictures where that is known only once it started, as an agent over the protocol says when it starts.
5. **The record says what the product was not shown.** The event of what the agent was sent keeps the pictures, as before; it names the other files (`files`), and the pictures the product was not handed as pictures (`unseen`). The agent's page reads that and tells whoever sent them, beside the message.
6. **`codex` takes pictures:** each as `-i <path>`, its path from the desk, before an option that takes nothing, since the product's option takes several values. Only a path the runner wrote under the desk's inbox goes on the command line.

## Consequences

- `MAX_SIGNAL_ATTACHMENTS` is 8. The route that reads a signal's file answers a picture in place and any other file as bytes to save under its name, with the policy that runs nothing.
- The transcript still keeps pictures alone ([ADR-0086](0086-a-session-leaves-a-transcript-that-is-kept-for-good.md), point 3): another file of a signal is read at the signal's own address, by its supervisors and by the account.
- `Picture` gains `path`; a driver's `can` gains `imageFiles`; a session may say `images()`; the runner's `files.write` takes bytes. A driver written outside the package that says nothing new behaves as before.
- Files of signals stay in the desk until the agent removes them. They are outside the repository and never pushed.
- A file is data. The runner writes it and names it; it never opens, unpacks or runs one, and what an agent does with a file a supervisor sent is the agent's own work, under the permission mode it runs in.
- Rejected: handing a file to the product inline as text, which fits only some kinds and some sizes, where a path fits every product; keeping files of signals in the transcript's store, which is kept for good and holds pictures alone; refusing a picture for an agent whose product takes none, which makes whoever sends it learn each product's limits.
