---
"@skillcdn/console": patch
---

`console agent invite <handle> --out <path>` writes the invitation's line to a file and prints no code. What a command prints under an agent stays in that agent's record, so an agent that supervises an agent account can now make its invitation and hand the line to whoever prepares the machine without reading it: the file is the body of a decision (`console ask --file --to`), of a comment (`console comment --file`), or a file at the messenger. Without `--out` the command prints what it printed before.
