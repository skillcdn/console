---
"@skillcdn/console": patch
---

A plugin's frame opens its links itself (ADR-0078): `frame.open(url)` opens a web or a mail address in a new tab from inside the frame, whose sandbox now lets a window out of it, and the browser holds the frame to a press in it, as it holds any page that opens a window: no window on the frame's own time or for a press elsewhere on the page, and the call is refused with no recent press where the browser can say so. The console's page opened the link before, for any recent press on the page, which a frame that took the focus could have had for itself. `frame.open` needs a console from 0.4.6, which a plugin that calls it says in its manifest's `console`; for a bundle built before, the page still opens a link as far as it can tell of a press in the frame, until the next line of SkillCDN.
