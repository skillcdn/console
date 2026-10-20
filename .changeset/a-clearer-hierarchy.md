---
"@skillcdn/console": patch
---

A clearer hierarchy, sizes and corners from the scale, and quieter controls.

- A card's title is set in `--sc-weight-semibold` (new, 600), so that it reads above its badges and its number; `--sc-color-text-muted` is a step darker (#4b5563), so that it and `--sc-color-text-faint` are two greys a reader tells apart.
- The text of a task and of a page of the documents is read at `--sc-text-md`.
- A card's number is `--sc-text-xs` and a task's beside its title `--sc-text-xl`, where they were 0.9em and 0.8em, off the scale.
- The answer a decision took reads in the text colour, marked by a green dot before it, where the whole of it was green.
- A person's picture is round, and every corner reads a radius token: the sign-in mark `--sc-radius-xl`, the dots `--sc-radius-full`, where they were 22%, 28% and 50%.
- A secondary button is raised white with a light edge (`--sc-color-border`, `--sc-sheet-lift`), the strong edge under the pointer, where it was outlined in the strong edge.
