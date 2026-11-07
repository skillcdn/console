---
"@skillcdn/console": patch
---

A plugin's pages may use WebRTC where an administrator says so ([ADR-0066](https://github.com/skillcdn/console/blob/main/docs/adr/0066-webrtc-is-a-way-out-a-plugin-asks-for-and-how-a-frame-is-held-stays-in-one-place.md)). The capability `outbound:webrtc`, required or optional like any other, leaves out of the plugin's scripts the line that takes WebRTC away; no `outbound:<host>` opens it, and it opens no host for `ctx.fetch`. A plugin that lists it as optional is served its scripts uncached, so that it is gone from the next time a frame loads once it is withdrawn. A frame's `script-src` now names the plugin's version, so that a frame runs that version's scripts alone. `OUTBOUND_WEBRTC` is exported from `@skillcdn/console/plugin`.
