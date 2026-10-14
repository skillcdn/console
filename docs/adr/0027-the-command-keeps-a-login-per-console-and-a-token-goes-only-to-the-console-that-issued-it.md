# ADR-0027: The command keeps a login per console and account, and a token goes only to the console that issued it

- Status: Accepted
- Date: 2026-10-14
- Builds on [ADR-0004](0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md) and [ADR-0011](0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md). The contract is in [specs/cli.md](../specs/cli.md#signing-in).

## Context

The command kept one credential per machine: the address of one console and one token, in the person's configuration directory. A checkout said which project it worked in (`.skillcdn-console.json`) and nothing of which console. A person whose checkouts belong to different consoles, their organization's and a customer's, could work only one of them from a machine, and had to sign out and in to move.

Worse, the address and the token were read apart: `--url` or `CONSOLE_URL` named the console, the token came from wherever it was, and the two were sent together. `console whoami --url <another console>` sent the kept token to that other console as a bearer, and the command's help suggested that very use. A token is a credential of one console; it must never be presented to another, whatever a flag says.

## Decision

1. **The credentials file holds logins, one per console and account.** Each is the console's origin, the person's login there (what the console answered to `me`), the token, what the token is called at the console and when the login was made. The first login is the default console; `login --default` marks another; `login` repeated for the same console and account replaces the token, and gives the old one up at the console. The file of before, one address and one token, is read as one login that is the default, and written in the new shape when next written.
2. **The console is resolved first, and the token is the one for that console alone.** The address is `--url`, else `CONSOLE_URL`, else the console the directory's file names, else the default login. The token is then `CONSOLE_TOKEN` where `CONSOLE_URL` names that very address, else the login kept for the address, for the account named (`--account`, or the directory's file) or the one account there. A console nobody is signed in to here gets no request, whatever is kept for another; several accounts at one console with nothing to say which stop the command. `whoami` and every refusal name the console and the account.
3. **The environment's pair is taken together or not at all.** `CONSOLE_URL` without `CONSOLE_TOKEN`, or the other way round, is refused rather than completed from the file.
4. **The directory's file names the console and the account, never a secret.** `console use` writes the project; the console where that is not the default login here, or when asked; the account where the console has several logins, or when asked. Its schema drops what it does not know, so that nothing else can be read from it, and the command writes the three settings by name, so that nothing else can be written to it. It is committed in a private repository and left out of a public one, since it may name the organization's console.
5. **A token travels over https, or to this machine in the clear**, for a console run locally; and a redirect is never followed, so that a token goes to the address the command resolved and nowhere it is sent on to.
6. **A credentials file the command cannot read as its own is never written over.** The command says so and stops; the person moves the file away and signs in again.
7. **The file stays a file.** It is written whole, beside itself and moved into place in one step, readable by the person alone where the system can say so. The operating system's keychain was looked at and left for later: the command runs on three systems and in containers and jobs where no keychain is, and a file the person's account alone can read is what every other command-line tool of this kind keeps; a keychain would be an adapter of the same store, should one be wanted.
8. **The server does not change.** A token is a console's own, the account is what `me` answers, and nothing of the console needs to know how many consoles a machine talks to.

## Consequences

- A person works checkouts bound to different consoles from one machine, and each command goes to the console its directory is bound to; `console logins` says which consoles the machine is signed in to.
- A token can no longer be sent to a console it was not made at, by flag, by environment or by a redirect: the failure is a refusal that names the console and says how to sign in there.
- `--url` no longer names any console for one command: it names one the machine is signed in to. A hook or a job that worked with the environment's pair keeps working; one that set only `CONSOLE_TOKEN` and relied on the file for the address stops, and is told to set both.
- The credentials file changes shape; the command reads the old shape and writes the new, so that nothing is asked of whoever updates.
- Rejected: a token in the directory's file (the checkout is committed, shared and backed up); the directory's file as the only place the console is named (a directory that names no console works at the default login, which is what one console on one machine always was); keying the logins by address alone (two accounts at one console are two people's standing, and the person says which); a keychain now (above); a change of the server (above).
