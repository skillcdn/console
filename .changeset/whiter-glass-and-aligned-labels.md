---
"@skillcdn/console": patch
---

The light look is whiter and its glass clearer, and its labels and boxes line up.

- The field is nearly white with a breath of the brand's blue at the top; a pane is translucent white with light falling down its face from the top edge (`--sc-glass-highlight`, new), light on its top and sides and a wide soft shadow; a sheet, a card inside a pane, has a light edge (`--sc-sheet-edge`, new, following `--sc-color-border`) and a little lift (`--sc-sheet-lift`, new).
- A badge's words sit in the middle of it on a page in Korean as in English: the pages lift a label by `--sc-label-lift-hangul` (new, from `--sc-label-lift`) when `<html lang>` is Korean, since Hangul sits higher in its box than Latin capitals; menu links read the same.
- A page that takes the whole window takes the header with it, so the lockup, the tabs and the page start on one line on every page, and the room for a scrollbar is kept (`scrollbar-gutter: stable`), so the header does not shift between a page that scrolls and one that does not.
- The people at work on a card stay at the end of its row when the badges push them onto a line of their own, and on a project's card what wraps starts under the name, the mark hanging in the margin.
