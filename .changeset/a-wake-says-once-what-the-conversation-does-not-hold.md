---
"@skillcdn/console": patch
---

A wake carries what the agent's conversation does not hold, and says it once (ADR-0166).

- **After a restart of the runner nothing is said again.** What the `slack` wake source brought the agent is kept in a file of its own under the desk's `work/` (`runner-kept-slack.json`: ids and moments, never a word), read when the runner starts.
- **After a reset the first wake of a conversation carries what led up to the message.** The runner says when the agent's conversation began (`WakeHost.began`, kept in its state as `began`): at a reset, with a new day's conversation, and where the product put the conversation in fewer words (`DriverEvent` has `compacted`, which the `claude` driver says). The first wake of a place in a conversation begun since carries the last five messages before it, the agent's own as `from you`.
- **Earlier messages share what a wake holds of them**: one alone up to 2,000 characters, each of many 500, where every one was cut at 500.
- **A wake's first line says more.** A message of a channel in no thread reads `outside any thread: a reply begins the thread ...`, where it read `in the thread ...` as a reply does. A message among several that names others and not the agent says `naming U0456WXYZ and not you`. A file is named with its id, `[file notes.pdf (F0123ABCD), not carried in this wake]`. What to judge by whether to answer is said once for a conversation or a thread, and the line names the others and the command after that.
- **A supervisor's message with a file says that a supervisor wrote.** Such a message names no workspace for its writer; in a conversation the messenger says is shared with no other organization, the agent's own is taken for it.
- **After a usage limit, what the conversation holds is named and not said again**: one line with the numbers of the signals the product had taken, ahead of what reached the agent since.
- **A wake for a comment carries the comment**, in a block, as its writer's words; a long one is cut, and the line says so. A console of this version sends it, and a runner of this version reads it in parts; an older runner prints the text as it is kept, the comment's lines behind `>`.
- **A wake an account kept for itself, and its own reset, read `yourself`** in the header.

For whoever builds on the package: `RunnerOptions.wakes.kept` reads and writes what a source keeps; `composeSignals` takes `own` and `above`; `wakeTextOf`, `wakePartsOf` and `WakePart` are exported from `@skillcdn/console/api` too.
