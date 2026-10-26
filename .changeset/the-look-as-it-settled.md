---
"@skillcdn/console": patch
---

The light look, as it settled: one field, panes of glass over it, white sheets inside them, and fewer visual elements.

- The field is one gradient from the top (`--sc-field-gradient`, new, a pale grey-blue falling to white), painted by the shell over `--sc-color-bg` and nothing else; the lights drawn over it before are gone (the tokens merged, below).
- A pane is translucent white (`--sc-color-glass` at 60%), blurred and saturated behind (`--sc-glass-backdrop`), with light falling down its face from the top edge (`--sc-glass-highlight`, new), a rim one pixel wide in a soft white (`--sc-color-glass-edge`, its border), a sheen along its top edge (`--sc-glass-sheen`) and a soft lift (`--sc-glass-lift`). The columns of the board are panes without the rim and the shadow, so that no line runs down their sides and the gaps between them stay as light as the field; the header lets the field through; the bar and the picture overlay blur as the panes do.
- A sheet, a card or a row inside a pane, is a lightly lifted white tile: 82% white (`--sc-color-sheet`), white under the pointer (`--sc-color-sheet-hover`), with a light edge (`--sc-border`) and a little lift. A pane and a sheet are the two surfaces.
- Four shadows: the stage, the pane, the glow and the focus ring; the rings and glows of the live dot, of a waiting decision and of the sign-in mark are gone, and the primary button's hover is the same glow. Two borders as tokens: `--sc-border` and `--sc-border-strong` (new, for what is typed into); the marking line of a quote, an answer and a report is two pixels of the accent; the callout, the sign-in mark and a chosen pick are on the plain one. A hairline (`--sc-hairline`, new) parts things inside a pane. Two opacities: hidden, and faded at 0.55 for everything that is over or put away. A scrollbar's thumb is a light grey (`--sc-scrollbar-thumb`, new, the control edge at a little under half) on a clear track, the page's, the board's and a column's.
- `--sc-color-success` is a shade darker, so that it reads at 4.5:1 where the field is deepest.
