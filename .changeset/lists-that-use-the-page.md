---
"@skillcdn/console": patch
---

Lists use the page, and a narrow screen shows the board and a task's text sooner.

- The feed (`.sc-feed`) takes the page's width, so that a sentence reads on one or two lines where it wrapped to six in the reading column.
- The decisions (`.sc-decisions`) put those waiting and the record side by side where the window is 64rem or wider, and the roadmap's goals (`.sc-goals`) are cards two or more to a row, where both kept to the left half of the page.
- On a screen 40rem or narrower the board's filters stay on one line and scroll sideways.
- Under the wide layout a task reads its text first, then its facts and the ways to its forms, then the discussion and what happened, where its facts came first.
