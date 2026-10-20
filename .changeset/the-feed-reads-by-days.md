---
"@skillcdn/console": patch
---

Breaking: the feed reads by days, each person named once for a run of their events.

- `EventFeed` heads the events by the day they fell on (`.sc-feed-day`, `.sc-feed-day-title`), and within a day groups a run of events by the same person as the same agent under one name (`.sc-feed-run`, `.sc-feed-actor`), each row (`.sc-feed-item`) the hour (`.sc-feed-clock`, 24-hour, the full instant in its title) and the sentence (`.sc-feed-words`). The rows are parted by hairlines rather than boxed, and the sentence reads as text, underlined under the pointer.
- The markup changes: the list is a `section.sc-feed` of day sections, each an `ol.sc-feed-day-list` of runs, each an `ol.sc-feed-run-list` of rows; a row no longer holds the person or a `Time`. A stylesheet that boxed `.sc-feed-item` or placed its three columns styles the run and the row instead; `.sc-feed-item` is no longer a sheet.
