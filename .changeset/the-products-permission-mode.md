---
"@skillcdn/console": patch
---

`console runner` starts the agent's product in a permission mode (ADR-0085): for `claude`, `--permission-mode auto` beside `--permission-prompts none`, the pairing the product's documentation has for a run nobody attends, so that an agent account works without a person at its terminal and its product's own classifier reviews what it does. `runner.json` names another with `permissions`, in the product's own word, `dontAsk` or `bypassPermissions` say, which is for whoever prepares the machine to choose; a word that is none of the product's starts it in the mode that allows the least. For whoever writes a driver: `Driver.permissions` says the product's modes, the one for a run nobody attends and the one that allows the least, and `StartOptions.permissions` carries what the desk names.
