---
"@skillcdn/console": patch
---

The `console` command costs an agent less to read, and says what to type after a mistake (ADR-0167).

- **`console help` is a table of the commands**, grouped by who runs them, in 2,468 bytes where it was 11,908: a row for the commands that go together and a few words on them. What holds for every command, the options, the exit codes, the refusals any command may meet and which console a command talks to, is `console help everywhere`.
- **A command of several forms has a page for each.** `console help agent` is the account's own page with a line for each other form, and `console help agent wake` is 1,491 bytes where the one page of `agent` was 15,686. So for `task`, `doc`, `project`, `workspace`, `person`, `plugin`, `skills` and `desk`. `console task new --help` opens the form's page. A page prints its forms a line each, and no page is over 2,600 bytes.
- **Breaking: `console help <command>` of such a command no longer prints every flag of every form.** Whatever read a form's flags there reads `console help <command> <form>`.
- **The documents' commands and a task's notifications stand under their thing**: `console doc write`, `doc attach`, `doc archive`, `doc restore`, and `console task follow`, `task mute`. The words of before, `write`, `attach`, `archive`, `restore`, `follow` and `mute`, run as they did, are in no list, and go with 0.7. The lines the command prints name the new forms (`Turn them off: console task mute 7`).
- **A mistake is answered with a sentence and the page to read.** An option that is none of the command's is answered with those it takes, where the parser's own sentence was printed; a word that is no command with the nearest there are (`Not a command: taks. Nearest: take, tasks, task.`); and every command that was not understood ends with `Its forms and flags: console help <command> [<form>]`.

Nothing of the REST API or of `runCli` changes; a console built from the package is not affected.
