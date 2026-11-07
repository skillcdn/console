---
"@skillcdn/console": patch
---

A plugin says what it requires and what it can go without: `optionalCapabilities` beside `capabilities` in the manifest. The form that enables a plugin shows the two apart, those it requires on and locked, the optional ones off until turned on, then or later, on the plugin's page, with `PATCH /api/v1/plugins/<key>/consent` and `console plugin <key> capabilities`. `ctx.plugin.capabilities` says what the plugin holds, and `updateConsent` on the plugin's client changes it. What it no longer holds is refused from its next call on, a frame's read of a file too, and a stream of events it comes to hold, or has no hook on until an upgrade, begins from then on, not with what it missed.
