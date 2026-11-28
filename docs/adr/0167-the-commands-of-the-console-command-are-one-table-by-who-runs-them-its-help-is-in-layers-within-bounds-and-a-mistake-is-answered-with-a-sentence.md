# ADR-0167: The commands of the console command are one table by who runs them, its help is in layers within bounds, and a mistake is answered with a sentence

- Status: Accepted
- Date: 2026-11-28
- Builds on [ADR-0021](0021-a-token-configures-as-its-person-does.md) (the command does what the pages do), [ADR-0124](0124-the-commands-reads-of-a-pack-are-the-skillcdn-commands-own.md) (one read within what a host shows whole, and what is printed to be run is a line) and [ADR-0157](0157-the-console-decides-who-is-told-of-what-and-keeps-the-record-and-a-plugin-carries-it-out.md) (`follow` and `mute`). It follows what the main repository decided for the `skillcdn` command, its ADR-0131, as far as it holds here, and moves six commands under the thing they act on.

## Context

The command grew one command at a time to fifty-eight words at the top, and nothing said where the next would go or what it may cost whoever reads the help. Its readers are mostly agents, for whom every byte printed is context spent. Measured on the released command (0.6.2), against a board in use:

- **The list was paid for whole.** `console help` printed 11,908 bytes: every command with every form and a sentence, then what holds everywhere. An agent that works one task uses a dozen of the commands.
- **A page was as long as its command had grown.** Of fifty-five pages, eleven were over 2,400 bytes, and each was one paragraph: `agent` 15,686 bytes for fifteen forms, `plugin` 6,628, `skills` 5,181, `task` 3,350, `login` 3,193. Whoever was about to run `console agent wake me` read the setup of a machine first. Much of a page said what the command would print, which the output says itself.
- **A mistake was answered with too little, or with the parser's words.** A word that is no command was sent to the list. An option that is none of the command's printed `Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--bogus"`, and neither the options the command takes nor where they are said. `console agent` alone named two of its fifteen forms.
- **Six commands stood at the top without their noun.** `write`, `attach`, `archive` and `restore` are of a page of the documents, beside `task archive` and `task restore` of a task; `follow` and `mute` are of a task. Every other command that changes a thing stands under it: `task new`, `goal edit`, `project icon`, `team add`, `member role`, `rules write`.
- **What a command says to do next was already a line**: the next part of a skill, the take that leaves the rules out, the command that turns a task's notifications the other way. That is kept, and said here as the rule it is.

## Decision

1. **The commands are one table, grouped by who runs them.** A row is the commands that go together and a few words on them; the groups are working a task, the board, the skills with the documents and the plugins, people and agent accounts, signing in and setting up, and what a machine runs for itself. The list `console help` prints is the table. A command is added as a row of it, a page, and a case of the dispatch, and a test holds the table to the pages: every command in one row, once.
2. **A word in the plural lists, the same word in the singular reads one, and a word after it is a form.** `tasks`, `task 7`, `task new`; `docs`, `doc guides/onboarding`, `doc write`; `agents`, `agent mira`, `agent tell`. What does something to a thing, or makes one, is a form of that thing, and is added there. The words at the top that name no thing are a closed list: those of a run, which act on the one open run (`take`, `report`, `hand-in`, `ask`, `answer`, `comment`, `file`, `finish`, `fail`, `abandon`); of signing in (`login`, `logins`, `logout`, `whoami`, `use`); of what one is told (`work`, `notify`, `manager`, `rules`); and of a machine (`serve`, `desk`, `runner`). A new one of those is a decision of its own.
3. **Six commands move under their thing, and their words of before still run.** `write`, `attach`, `archive` and `restore` are `doc write`, `doc attach`, `doc archive` and `doc restore`; `follow` and `mute` are `task follow` and `task mute`. The words of before run as they did, say nothing of themselves, stand in no list, and go with 0.7. Under `doc`, a form's word is the form where a path follows it and a page's path alone, since a page may be called `write`.
4. **The help is in three layers, each within a bound a test holds.** `console help`, the table, within 3,000 bytes. `console help <command>`, a command's page, within 2,600. Where a command has several forms, its page is of the first and names the others in a line each, and `console help <command> <form>` is the page of one, within the same bound; words that open one page stand together (`archive, restore`). `<command> <form> --help` opens the form's page. What is past a bound is cut, or given a page of its own: the bound is not raised to fit.
5. **A page says what is not seen by running the command.** Its forms a line each with every flag; what a flag means where its name does not say; what happens that the output does not show, a run taken over, an exit with `3`; its limits; its refusals, each with what to do. It does not describe what the command prints, nor how the work goes, which is the skill's, nor why, which is a decision named by its number.
6. **What holds for every command is said once**, in `console help everywhere`: the options every command takes, the exit codes, the refusals any command may meet, which console a command talks to.
7. **A mistake is answered with a sentence and where the rest is, never with a page.** A word that is no command: the nearest there are, three at the most. An option that is none of the command's: the options it takes, so that the next try needs no page. A form left out, a word too many, a value missing: what was wrong, with the form to type. Each is followed by one line that names the page, of the form that was tried where it has one. All end with `2` and ask the console nothing.
8. **What a command prints to be run is a whole line**, with the project, the console and the account as they were given: the next part or page of a read, the command that goes on from a refusal, the command that turns a setting the other way.

## Consequences

- **The list is 2,468 bytes where it was 11,908**, and the longest page 2,525 where it was 15,686: a hundred and one pages for fifty-two commands, half of them under 1,200 bytes. Whoever is about to wake itself reads 1,491 bytes.
- **`console help <command>` of a command with forms no longer says every flag of every form.** A reader, or a script, that looked for one there finds the form's name and reads its page.
- **A command line that named an option its command does not take failed before and fails now**, with other words; nothing that ran stops running. `console help write` prints the page of `doc write`.
- **The skills and the documents of this repository name the new forms**, and `pnpm check:skills` refuses a word of before in a skill, since no page of the help is of it. The skills and the agreements of other repositories, and what an agent wrote in its desk, name the words of before until they are changed, which is why those run on.
- **A page of help is written by its bound.** A form that needs more than its page holds is two forms, or says less of what its output shows.
- **Looked at, and left:**
  - The lines of a listing say a task's owner and its workers in full, and an id whole (`decisions`, `runs`, `goals`). A line is what the options take, and a shorter one would be read back to the console; the lists are a page at a time.
  - `notifications` lists and `notify` sets, two words for one thing. They are of a release ago, and nothing was gained by a third spelling.
  - A command takes some 0.6 seconds to start where a bare runtime takes 0.1: the modules the command is made of are loaded whole, the main repository's schemas the largest of them, for a page of help too. An entry that answers the help without them is not built here.
- **Rejected:**
  - a thing for the words of a run (`run report`, `run finish`): they are what an agent types most, every agreement and skill names them, and they are already one group of the table;
  - the words of before taken out at once: agents at work, their desks and the skills of other repositories name them;
  - a line on standard error each time a word of before is used: it would cost the context it is meant to save, at every use, for a spelling the documents already teach;
  - the whole page after a mistake: its reader asked for something else, and the page is one command away;
  - one bound per command, or a larger one for `agent`: a page that may be as long as its command is where the 15,686 bytes came from;
  - options read from one table for the parser: each command parses with its own, which is what refuses another command's option today.
