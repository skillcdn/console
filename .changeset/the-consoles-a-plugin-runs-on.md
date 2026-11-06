---
"@skillcdn/console": patch
---

A plugin declares the consoles it runs on: `console` in the manifest, a semver range of the console's version as `requires` spells one (`>=0.4.3 <0.6`). A console outside the range fails the plugin when it reads it, saying the range and its own version; the range is answered as `console` on `GET /api/v1/plugins` (read as optional, for an older console), shown on the plugins' settings pages and by `console plugins`. `console-plugin init` writes it as the line of the version the plugin depends on (`--console`, the command's own unless said; none for a dependency that names no version, such as `workspace:*`), and `console-plugin check` fails a `devDependency` on `@skillcdn/console` outside it and warns of a range that leaves the command's own console out. `satisfiesRange` and its kin are exported from `@skillcdn/console/plugin`.
