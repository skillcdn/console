---
"@skillcdn/console": patch
---

A plugin says what it requires and what it can go without: `optionalCapabilities` beside `capabilities` in the manifest. The form that enables a plugin shows the two apart, those it requires on and locked, the optional ones off until turned on, then or later, on the plugin's page, with `PATCH /api/v1/plugins/<key>/consent` and `console plugin <key> capabilities`. `ctx.plugin.capabilities` says what the plugin holds, and `updateConsent` on the plugin's client changes it.
