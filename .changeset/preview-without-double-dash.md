---
"@skillcdn/console": patch
---

`skills/building-a-plugin` starts the console on this machine with `pnpm dev:plugins --plugin <path to the built plugin>`, without the double dash: pnpm 12 hands a `--` on to the script, where the preview refused it. The preview now passes a bare `--` over, so both spellings work.
