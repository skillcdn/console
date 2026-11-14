---
"@skillcdn/console": patch
---

The stylesheet's sources are kept as tokens, a reset, the parts and the pages (`src/styles/`: `tokens.css`, `base.css`, `parts/`, `pages/`), joined by the build into the one `console.css` as before, with the same rules. `src/styles/README.md` is the catalogue of the parts, each with its classes, the component that renders it and what it is for: what a page of a console of your own, or a plugin's page, is built from. Every colour is now written in the tokens: `--sc-color-shade`, black, is what a colour is mixed towards where it darkens under the pointer, and `--sc-shadow-sheet` what a sheet inside a pane casts, both among `CONSOLE_TOKENS`; a badge reads its fill, its words and its line from `--sc-badge-fill`, `--sc-badge-ink` and `--sc-badge-line`, which its classes set, as a category's hue sets `--sc-category-fill`.
