---
"@skillcdn/console": patch
---

The desk an agent account is set up with no longer says that the console's secret store is the only place a secret is kept. A secret the account cannot afford to lose, a password above all, is kept in the store and nowhere else; any other may be kept another safe way, as a command-line tool keeps its own sign-in in the system's keychain, so an agent uses such a tool as it is instead of moving its sign-in into the store by hand. No secret is kept in a file, a message, a task or the desk, as before. The skill `running-an-agent` says the same, and that an organization that wants every secret in the store says so in what it adds to the rules. A desk written before keeps its `AGENTS.md`: its account rewrites the first sentence under "Secrets" itself.
