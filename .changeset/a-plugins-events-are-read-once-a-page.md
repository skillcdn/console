---
"@skillcdn/console": patch
---

A plugin's own events are read once a page, not once a frame: the frames of a plugin on the page, four widgets of it on the front page as much as one, share one reader, which asks `GET .../plugin-events` every few seconds while a frame listens and the page is in view, one ask at a time, and asks nothing while the tab is in the background, asking at once when it comes back; the stream is read from where it stands when the first frame listens, which the answer now says as `newest`, the number of the plugin's newest event, so that finding it is one request and never replays what came before.
