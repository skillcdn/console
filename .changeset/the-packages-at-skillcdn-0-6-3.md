---
"@skillcdn/console": patch
---

The packages are taken at SkillCDN 0.6.3, and what the command prints of a pack to be run is a whole line.

- **`console skills` lists the skills.** The documents outside them are counted, with the commands that read them (`console skills <folder>`, `console skills --search <words>`), where every one was listed: a pack of documents printed pages of paths before its first skill was found. `--json` is the whole listing, as before.
- **A page of a folder, of a file's outline and of a search ends with the command that reads the next**, `Next page: console skills <folder> --cursor <cursor>`, with `--limit`, `--project`, `--url` and `--account` as they were given, where it named a `nextCursor` and left the command to its reader. After a search that goes on, the line on how a skill is loaded stands above the results, so that the command is the last line.
- **A skill names its own folder by a command.** Where a skill does not list every file of its folder, or resolve every file it links to, the line reads `console skills <folder>` (`console skills .` for the root's, `console plugin <key> skills <folder>` for a plugin's), where it would have printed `console skills <folder> <path>`, which nothing runs.
- What a client is told on connect says, in the command's output, that a long skill comes in parts, each ending with the command that prints the next, where it said to follow `nextCursor`.
