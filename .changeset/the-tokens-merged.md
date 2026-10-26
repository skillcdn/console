---
"@skillcdn/console": patch
---

Breaking: the tokens merged, 115 to 86, every one of them read by a rule, so that re-skinning has fewer knobs and none that does nothing. A stylesheet of your own that set one of the tokens gone sets what took its place:

- The field has no lights: `--sc-color-sky`, `--sc-color-far`, `--sc-color-far-turn`, `--sc-color-vignette`, `--sc-color-light-core`, `-body`, `-mid` and `-halo`, `--sc-light-strength`, `-top`, `-height`, `-inset` and `-blur` are gone with the rules that drew them; the shell paints `--sc-field-gradient` over `--sc-color-bg`, and nothing else.
- A pane's rim is its border, `1px solid var(--sc-color-glass-edge)`: `--sc-glass-lens`, `--sc-glass-lens-width` and `--sc-glass-lens-mask` are gone with the pseudo-element that drew the rim. A sheet reads `--sc-border` and a fixed lift, and has no blur of its own: `--sc-sheet-edge`, `--sc-sheet-lift` and `--sc-sheet-backdrop` are gone.
- What is under the pointer is mixed from the accent where it is drawn: `--sc-color-accent-hover` and `--sc-color-accent-solid-hover` are gone, and so is `--sc-color-selection`, mixed from `--sc-color-accent-solid` at `::selection`.
- `--sc-color-bg-subtle` is gone (`--sc-color-bg-inset` where it was read), and `--sc-color-field` too (`--sc-color-bg-raised`, which it was).
- The marking line of a quote, an answer and a report is `2px solid var(--sc-color-accent)` where it is drawn: `--sc-border-accent` is gone, `--sc-focus-ring` staying for the focus.
- One lift for a label, `--sc-label-lift`, set again under `:root:lang(ko)`: `--sc-label-lift-hangul` and `--sc-label-lift-text` are gone.
- `--sc-glow-bright` and `--sc-width-page`, which no rule read, are gone.
- `--sc-color-text-faint` is #666c7c, a step lighter than `--sc-color-text-muted` (1.44:1 between them, where they were 1.10:1 apart) and 4.6:1 on the deepest ground.
- The small capitals over a group are one rule, `.sc-eyebrow`, which the menu headings, the field labels, the facts' names, the feed's days, the decision labels and the tables' heads share; the class is for a label of your own. `LinkButton`, a link that reads as a button, is exported.
- Not tokens, by decision: the control sizes, the blur, the opacities, the z-indexes and the breakpoints stay in the stylesheet. The dark look of 0.3.2 is not kept as a stylesheet; a theme is a setting to come.

The package's README lists the 86 by family.
