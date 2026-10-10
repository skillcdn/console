---
"@skillcdn/console": patch
---

The board uses the height and the width it has: the page below the header is a column of blocks that fills the window (`sc-main`), the board takes what is left of it, each column scrolls within itself, and on the board the page is as wide as the window (`Shell` takes `wide`, which sets `sc-main-wide`). The columns share the width while it is enough for them, from `--sc-column-width` up, and scroll sideways when it is not; the cards are denser.
