---
"@skillcdn/console": patch
---

The command's help in two layers. `console help` is the map: every command in a line with what it does in a sentence, a many-formed command (`task`, `goal`, `project`) listing its forms without their flags, then what holds everywhere; it is about half as long as it was. `console help <command>` is the reference: the command in full, every form and flag, the limits and the refusals, as before. What the skill working-the-board and the rules of the board say of how the work goes is no longer repeated in the help. `CommandHelp` carries a `synopsis` for the overview and, for a many-formed command, an `overview` usage beside the full one.
