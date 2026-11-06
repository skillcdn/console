---
"@skillcdn/console": patch
---

An option of a decision may carry a `key`, a lowercase word spelled as a plugin's key is and given once, which `POST .../decisions` and a plugin's `ctx.console.decisions.ask` take beside the label; the decision answers it on the option, and the `decision.answered` event names the chosen option by its label (`option`) and its key (`optionKey`), so that a program reads the answer without comparing labels. A plugin's hook receives the answer to the plugin's own decision with `board:decisions` alone. `OPTION_KEY_PATTERN` is the rule; the person's own answer carries no key; `console decision` prints a key beside its option.
