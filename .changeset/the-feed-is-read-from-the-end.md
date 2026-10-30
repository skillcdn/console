---
"@skillcdn/console": patch
---

A board with a long history opens without reading its whole feed first. The pages read the newest page of a project's feed in one request (`GET .../events?latest=true`, which a console from 0.4.1 answers with the newest `limit` events, oldest first, and whether there are earlier ones; `EventFilter.latest` on the client), where before they read the feed from the beginning a hundred events at a time, one round trip after another, and showed the board only then: on a project with thousands of events, seconds over a slow path. The stream goes on from the newest event as before.
