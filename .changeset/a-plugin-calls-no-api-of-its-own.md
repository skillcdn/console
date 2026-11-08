---
"@skillcdn/console": patch
---

Breaking: a plugin calls no api of its own. A manifest that asks `plugins:<its own key>`, required or optional, is refused (`capabilities: plugins:<key> is the plugin itself`), and `ctx.plugins.get(<its own key>)` is `plugin.forbidden` whatever its install holds: through its api a plugin was called as another plugin, and with `people:act` it could make every call of its own for anyone (ADR-0072). Its code runs its own functions directly.
