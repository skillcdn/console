---
"@skillcdn/console": patch
---

`console runner` starts the agent's product in a permission mode (ADR-0085): for `claude`, `--permission-mode auto` beside `--permission-prompts none`, since the product otherwise starts a run nobody attends in its manual mode, in which a file written is denied: an agent account works without a person at its terminal, and its product's own classifier reviews what it does. A product that starts such a run in a mode for it by itself is named none. `runner.json` names another with `permissions`, in the product's own word, `dontAsk` or `bypassPermissions` say, which is for whoever prepares the machine to choose; a word that is none of the product's starts it in the mode that allows the least. For whoever writes a driver: `Driver.permissions` says the product's modes, the one for a run nobody attends and the one that allows the least, and `StartOptions.permissions` carries what the desk names.
