---
"@skillcdn/console": patch
---

The stylesheet reads only the tokens it defines, so that a stylesheet of your own reaches every place they are used: the roadmap's title is `--sc-text-md`, where it named `--sc-text-base`, which no rule defines, and the focus of a picture, of a card's menu button and the column a card is dragged over are drawn with `--sc-focus-ring`, where they spelled the ring out. Nothing changes in the default look. A test of the package holds both.
