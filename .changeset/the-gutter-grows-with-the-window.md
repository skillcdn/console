---
"@skillcdn/console": patch
---

The margin at the sides of the header, the tabs and every page grows with the window: `--sc-gutter` is `clamp(3rem, 5vw, 10rem)` instead of 3rem, so that a page on a wide screen no longer runs to its very edges (about 4.5rem at 1440 pixels across, 6rem at 1920, 8rem at 2560), while a laptop keeps the margin it had and a phone the narrower one it had. Everything that lines up on the gutter, the lockup, the tabs, a page's head and a plugin's frame, moves together. A custom console that sets `--sc-gutter` itself is not affected.
