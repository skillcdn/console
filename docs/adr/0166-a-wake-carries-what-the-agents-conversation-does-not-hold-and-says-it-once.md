# ADR-0166: A wake carries what the agent's conversation does not hold, and says it once

- Status: Accepted
- Date: 2026-11-27
- Amends [ADR-0163](0163-a-wake-from-the-messenger-is-carried-in-parts-with-what-was-said-before-it-and-an-agent-account-judges-whether-to-answer-where-several-were-woken.md), points 6 and 9, and takes up what it rejected last; [ADR-0164](0164-a-plugin-says-which-account-at-a-messenger-is-a-members-and-a-wake-says-by-it-whether-a-supervisor-wrote.md), point 7, in one case; and [ADR-0150](0150-a-runner-waits-out-its-products-usage-limit-and-tells-its-agent-before-it.md), point 3. Adds to [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md), point 10: a wake of the board's for a comment carries it. Rests on ADR-0163, points 1 to 3.

## Context

Agent accounts read the wakes of ADR-0163 and ADR-0164 at work: in direct and group conversations, in channels they listen to, beside other agent accounts, through restarts of their runners, resets and a usage limit. Their records were read for what a wake said twice, what it left out, and what cost a command to learn. What they showed:

- **What a source kept ended with the runner, and outlasted the conversation.** ADR-0163 kept in memory what a wake brought. After a restart of the runner, a conversation the agent never writes in was carried its last ten messages again. After a reset it was the other way round: the source took the agent to hold what it was brought, and counted from the agent's own last message, in a conversation that held neither. A supervisor who wrote "about what I said earlier" was carried without it.
- **A usage limit said everything twice.** What the product had taken as the limit was reached, and the agent had not answered, was handed over again whole, into the conversation that held it: twenty wakes, word for word, a second time.
- **A comment cost a command.** A wake of the board's said that a task had a comment, and the command that reads the task whole, with every comment on it, to learn what one said.
- **A line that misled, and lines that left out.** A message of a channel in no thread was named by "the thread" of its own moment, and read as a reply in one. A file was named without the id it is read by. An earlier message was cut at five hundred characters where it was the only one carried, and what mattered stood past the cut. What to judge by whether to answer was said whole in each of three wakes within a minute. A message with a file names no workspace for its writer, so the console was not asked, and the line did not say that a supervisor wrote. In a conversation of several, a message said to another by name read as any other.
- **An account's own wake read as a colleague's**, under the account's name.
- **A person's messages in a row came a quarter of a minute to a minute apart.** What arrived during a turn was handed over in it, after the tool call under way, and that worked. No wait short enough to leave an answer prompt joins messages that far apart.

## Decision

1. **What a wake source keeps outlasts the runner.** `WakeHost.kept` is read when the source starts and written when it changed, to a file of the source's own under the desk's ignored `work/` (`runner-kept-<source>.json`), beside the runner's state: the ids and the moments of what the source brought, never a word, the last two thousand names. A file that does not read is nothing kept. ADR-0163 rejected writing it in the runner's state file, which is written whole at each change of what is delivered; a file of its own is written when a wake changed it, a second after at the most, and when the runner ends.
2. **The runner says when the agent's conversation began, and a source counts nothing from before it as held.** `WakeHost.began()`, in milliseconds, kept in the runner's state (`began`). A conversation begins at a supervisor's reset and at the account's own, with a new day or week where `runner.json` says so, in a session that goes on with none (the first, a product that resumes none, another driver's), and when the product puts the conversation in fewer words, where its driver says so (`compacted`, which the `claude` driver says at the product's `compact_boundary`). A restart of the runner, or of the session with the conversation it had, begins none. Where nothing says when, a state written before or a host that says nothing, the moment is 0 and everything counts as held, as under ADR-0163.
3. **The first wake of a place in a conversation carries what leads up to the message.** The two points ADR-0163 counts from, the agent's own last message there and the last message a wake brought, count only where they are of the agent's present conversation. Where neither is, and something was said there before that conversation began, the wake carries the last five messages before the one that woke, whoever wrote them, the agent's own said as `from you`, behind a line that says why: `Your present conversation holds nothing from there yet: the last 5 messages there before it follow, the oldest first, your own among them, and what was said earlier with console agent messages slack:D0123ABCD`. The next wake there counts from this one. A message a wake carried before the conversation began is carried again where it is among the five; one that woke is never raised twice, whenever the conversation began.
4. **Earlier messages share what a wake holds of them.** Three thousand characters together, as before; of each, that room divided by how many are carried, less its line, and never less than five hundred nor more than two thousand. One message is carried up to two thousand characters, three up to eight hundred each, six and more at five hundred.
5. **What to judge by is said once for a place in a conversation.** The first wake of a conversation or a thread that names who else writes there through an app says the sentence of ADR-0163, point 8. Each wake there after it names them, the last to write first, and the command that reads what was said since, which are what changes: `Others here that write through an app, the last to write first: U0456WXYZ, you. Before you send, read what was said since: ...`. A conversation of the agent's that began since is said the sentence again.
6. **A wake's first line says where a message stands and whom it names; a file is named with its id.**
   - A message of a channel in no thread: `outside any thread: a reply begins the thread 1762800000.000100`. A reply in a thread: `in the thread 1762800000.000100`, as before.
   - A message in a group conversation or a channel that names other members and not the agent: `naming U0456WXYZ and not you`, after who wrote, five ids at the most. Not in a direct conversation, where whatever is said is said to the agent; not where the event does not say which member it was delivered for.
   - `[file export.csv (F0123ABCD), not carried in this wake]`: the id the messenger's own tool reads the file by, where it is spelled as one.
7. **A writer the event names no workspace for is of the agent's own, in a conversation the messenger says is shared with no other organization.** `is_ext_shared_channel` false, in so many words, and the workspace the event was delivered for: everyone who writes there is an account of the agent's own organization, where an id is one account. So the console is asked of the writer of a message with a file, and of an earlier message that names none. Anywhere else ADR-0164, point 7, stands: shared, or nothing said of it, the console is asked nothing.
8. **After a usage limit, what the conversation holds is named and not said again.** What the product took as the limit was reached and the agent never answered stands in the conversation the agent goes on in. Handed over again, it is one line ahead of the rest, `above in this conversation, handed to you before and not said again: #8812, #8813 (console agent signals me reads them)`, and the runner's words on the limit say so. What the product never took is said whole, as before. The runner knows it until a turn completes or the conversation is let go; a runner started meanwhile does not, and says such a signal whole.
9. **A wake for a comment carries the comment, in parts.** The console writes it as a wake source writes what someone said (ADR-0163, point 2): its own lines behind `#`, every line of the comment behind `>`.

   ```
   # A comment on #412 "Ship the release" in ops
   > The migration is checked. Go ahead.
   # The task, with the rest of what was said on it: console task 412 --project ops
   ```

   Two thousand characters of it; a longer one is cut, and the first line says so. The runner reads a wake of the board's in parts where it carries words: the console's lines under the session's mark, the comment in a block, as its writer's words and never the console's. A comment of files alone, and every other wake of the board's, is as it was. The writer of the text is the package's (`wakeTextOf`), for the runner and the console alike.
10. **What an account sent itself is said as its own.** `[console k3f9a2 #8815 · wake · yourself · 14:20]`, for a wake it kept and for its own reset, where the runner is told which account it is.
11. **Nothing waits at an idle session for a second message.** The window that groups what arrives together stays a second and a half. What arrives during a turn is handed over in it, an entry each.

### What a wake carries, case by case

| Case | What the wake carries | Why |
|---|---|---|
| The runner is started again, the conversation gone on with | What was said since the last message a wake brought, and nothing before it | What was brought is kept in a file (1) |
| A reset, the account's own or a supervisor's; a new day's conversation; a product that resumes none | In the first wake of each place, the last five messages before it, the agent's own among them; after that as before | The conversation holds nothing from before (2, 3) |
| The product put the conversation in fewer words | As after a reset, where the driver says so; elsewhere as before | A summary is not what was said (2) |
| A conversation the agent is woken in and never answers | Each message once | ADR-0163, point 6 |
| A conversation the agent never writes in, an app's notices say | Nothing again after a restart; the last five once after a reset | 1, 3 |
| One person, several messages, the session idle | The first after a second and a half; the rest in the turn, an entry each | 11 |
| One person, several messages, the session at work | Each after the tool call under way, an entry each | ADR-0085, point 8 |
| Several people, or agents, in a short while | A wake for each person's message; what an agent wrote among what was said before the next; the sentence once | 5; ADR-0163, point 7 |
| A message edited or deleted | Nothing: neither wakes, and a wake's words are the message's as it was raised | Only someone's new words wake |
| A direct conversation | The message; no naming, nobody else | Whatever is said there is said to the agent |
| A group conversation | Every person's message; whom it names where not the agent; who else writes through an app | 5, 6 |
| A channel, by mention or a call of everyone | The message, in no thread or in which | 6 |
| A channel the agent listens to | Every person's message, with whom it names where not the agent | 6 |
| A conversation shared with another organization | Said as shared; the writer's workspace where another; the console asked only by what the message says | ADR-0160; ADR-0164, point 7 |
| A thread | What was said in it; of one longer than a wake reads, a line that says so and the command | ADR-0163, point 5 |
| The agent's own messages, through an app or in the messenger itself | Never a wake; what is carried counts from the last, in a conversation that holds it | 3 |
| What an app posted in nobody's name | Never a wake; among earlier messages, said as an app's | ADR-0163 |
| A message with a file | The file by name and id; who wrote, by the agent's own workspace where the conversation is not shared | 6, 7 |

## Consequences

- **A reset costs each place one wake of up to five earlier messages**, within the three thousand characters a wake holds of them. So does a compaction under the `claude` driver.
- **A wake of the board's is longer where a comment is, and a reading of the task is saved.** The console's record of it holds the comment's words, read by whoever reads the account's signals.
- **A runner of before prints such a wake as it is kept**: the console's lines behind `#`, the comment's behind `>`, under the wake's header. It reads, and nothing in it carries a session's mark.
- **Wakes of one task that arrive together are still one entry, the latest** (ADR-0085, point 9): where several comments were written, the entry carries the last, with how many wakes there were, and the command reads the others.
- **A supervisor's word the product took under a limit is not said again after a restart** that goes on with the conversation: it is named. The command in the line reads it where the product went on with less than the runner took it to.
- **The lines of point 6 are longer by what they say**: a message outside any thread by some thirty characters, one that names others by its ids.
- **For whoever builds on the package:** `WakeHost.began` and `RunnerOptions.wakes.kept` are left out by a host that has none; `DriverEvent` has `compacted`; `composeSignals` takes `own` and `above`; `wakeTextOf`, `wakePartsOf` and `WakePart` are exported from the API layer too.
- **Seen in part.** The cases are held by tests with invented events. None of it was read by an agent at a messenger yet, and the product's line for a compaction is read as the driver already read it for the record.
- **Counted, and left:** a session's first words are some nineteen hundred characters, said at every session (ADR-0158, ADR-0160, ADR-0164), a restart of the runner among them. They stand: a product may have put the earlier ones in fewer words, and they are what no edit of the desk takes away.
- **Rejected:**
  - a wait at an idle session for more of the same person's messages: a few seconds join none of what was seen, and longer delays every answer;
  - messages of a channel that name others held back to be handed over together: they came minutes apart;
  - letting go of everything a source keeps at a reset: what woke is what keeps an event that comes again from waking twice, and a moment compared says the same with nothing let go;
  - the comment in a field of the signal, or only for a runner new enough: a second contract, or a rule by version, for what the text of ADR-0163 already carries;
  - a comment carried whole whatever its length, which a signal's text does not hold;
  - the words of who an account is (ADR-0164, point 6) cut shorter: they are what says whose word instructs, and are said as they were.
- **Not decided here:** whether a wake for a comment says how its writer stands to the agent, as a wake from the messenger does; `console agent messages` asking the console of a writer whose message names no workspace; a day's briefing for a day with nothing planned.
