# ADR-0038: The command and the console go together within a line, and a release that changes what passes between them raises the floors

- Status: Accepted
- Date: 2026-10-18
- Amends point 3 of [ADR-0025](0025-the-command-names-its-version-on-every-request-and-the-console-holds-it-to-the-range-it-takes.md), the common rule before 1.0, which stands otherwise; reads the version as [ADR-0034](0034-the-package-is-versioned-on-skillcdns-line-one-line-at-a-time-with-a-patch-of-its-own.md) has it. The contract is in [specs/rest.md](../specs/rest.md) and [specs/cli.md](../specs/cli.md).

## Context

Before 1.0 the console took a command from its own version on, within its minor, since any release might change the contract between them (ADR-0025). Since then the version became SkillCDN's line with a patch of the console's own (ADR-0034): every release of the console is a patch, and the first weeks on the published console showed what the rule costs. Every deployment of a patch made every agent's command update, where most patches change the pages, the server or the skills and nothing the command reads or sends. The strictness protected against a real break, such as the workers in place of the assignee, which an older command cannot parse; it protected against it on every release instead of the one that broke.

## Decision

1. **Within a line, the two go together.** Before 1.0 the common rule is the line: a command and a console of one major.minor, whatever the patch. From 1.0 the rule stays as ADR-0025 has it, the major and a minor within one, either way.
2. **Each side names the oldest version of the other it works with, and nothing else narrows the rule.** The console's floor is `CLIENT_POLICY.atLeast`, the oldest command whose requests and answers still fit it; the command's floor is `CONSOLE_AT_LEAST`, the oldest console it works with. Both are in the package's `compat` module, which both sides read. A release that changes what passes between them, a field the command reads or sends, a route it calls, the meaning of a flag the console reads, raises the floor of the side it breaks for, to the version it releases as, in the same change, and its changeset begins with `Breaking:`, as ADR-0034 asks of a release that changes what exists. A release that changes nothing of the kind leaves both floors alone, and the agents' machines have nothing to do.
3. **Each side judges the other on every request, in the same form.** The console refuses a command below its floor, or of another line, with `426` and `client.outdated` or `client.too_new`, as before. The command compares the version every answer names with its own floor and refuses a console below it itself, before acting on anything the console answered, as `console.outdated` in the console's own form, with exit code `4` and the command that installs the console's version; `whoami` says the floor beside the versions. A newer console within the line is answered, and a newer command within the line is answered too, the notice of a newer command staying what it was.
4. **`pnpm check` holds the floors.** Each floor is a version of the package's line, no later than the version the pending changesets make; one raised to that version comes with a changeset that says `Breaking:` first. A floor forgotten is not caught: an older command then fails on an answer it cannot read, which is a failure it reports, not a silent one; a snapshot of the API's schemas compared between releases would catch it, and waits for the need.

## Consequences

- A patch of the pages, the server or the skills costs the agents' machines nothing; a release that moves the contract costs them the update it always did, and the message names the version to install.
- Two numbers say the rule, read beside the changelog's `Breaking:` entries; the floors are 0.3.2 for both sides at this decision, the release that brought the workers.
- A command newer than the console within a line works, with what the console has not got refused as not found, as before; a command that needs a newer console says so itself instead of failing on the answer.
- Rejected: a number of patches of grace (arbitrary, and wrong on exactly the release that breaks); features negotiated per request (too much for a 0.x contract read by one command); a command that reads a missing field as nothing (it hides the break); a breaking change as a minor (the minor is SkillCDN's line, ADR-0034).
