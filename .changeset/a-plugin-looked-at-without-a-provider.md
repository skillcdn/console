---
"@skillcdn/console": patch
---

`skills/building-a-plugin` says how a plugin is looked at on a local console without a provider to register: in the console's checkout, `pnpm dev:plugins -- --plugin <path to the built plugin>` installs it beside the fixtures, for the administrator among the fixture's people to enable on the settings page.
