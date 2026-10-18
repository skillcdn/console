---
"@skillcdn/console": patch
---

Before 1.0 a command and a console of one SkillCDN line go together whatever the patch (ADR-0038): `commonRange` is the line, and each side names the oldest version of the other it works with, `CLIENT_POLICY.atLeast` for the console and the new `CONSOLE_AT_LEAST` for the command, raised only by a release that changes what passes between them, with a `Breaking:` changeset; both are 0.3.2, the release that brought the workers. `judgeConsole` and `consoleRange` stand beside `judgeClient` and `clientRange`. The command refuses a console older than it works with itself, as `console.outdated` in the console's form, with exit code `4` and the command that installs the console's version; `runCli` takes `consoleAtLeast` in its io for a console built on the package; `whoami` says the floor. `pnpm check:version` holds the floors to the line and to the version the pending changesets make.
