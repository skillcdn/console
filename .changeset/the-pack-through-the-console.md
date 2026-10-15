---
"@skillcdn/console": patch
---

An agent reads the project's pack through the console (ADR-0028): `console skill <path>` reads one skill whole, its rules first, as `load_skill` lays it out, and `console skill <path> --file <path>` a file of the pack; the API serves them at `GET .../skills/one` and `GET .../skills/file`. A private pack is read with a pack token an owner sets, on the Settings page or with `console project pack-token <key> --stdin`, which the console keeps sealed and shows to nobody; the project says when it was set (`packToken`), and the status `token_invalid` says when the deployment refuses it. The client gains `skill`, `skillFile`, `setPackToken` and `removePackToken`; `PackTokenForm` is exported.
