---
"@skillcdn/console": patch
---

`console plugin <key>` lists each command and query in brief: the positionals and the required flags, the rest as `[options]`, which `console plugin <key> help <command>` prints whole; `help` without a command lists them the same way. An agent reads the listing whole at every first use, and a plugin with many flags filled half of it with usage. A `file` argument prints as `--file <path>`, the flag the command takes, where it printed a flag of the argument's name that the command then refused. `formatOperationUsage(key, operation, { brief })` takes the option.
