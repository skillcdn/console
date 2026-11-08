---
"@skillcdn/console": patch
---

A link a person presses in a plugin's frame opens in a new tab ([ADR-0067](https://github.com/skillcdn/console/blob/main/docs/adr/0067-a-link-a-person-presses-in-a-frame-opens-in-a-new-tab-through-the-bridge.md)). `frame.open(url)` in `@skillcdn/console/plugin/web` sends `open` on the bridge, and the console's page opens a web or a mail address (`https:`, `http:`, `mailto:`) with no opener and no referrer, only right after a person pressed; anything else is refused on both sides, and a path of the console's stays `navigate`'s. The frame's sandbox is unchanged, and no capability is asked. A frame could open nothing before, and copied the address for the person to paste.
