---
"@skillcdn/console": patch
---

The pages read a step larger, with a clearer hierarchy, every size and corner from the scale.

- `--sc-text-xs` is 13px and `--sc-text-sm` 15px; the snug leading is a token (`--sc-leading-snug`, new, 1.45), and so is the tracking (`--sc-tracking-tight` for titles, `--sc-tracking-wide` for the small labels over a group, `--sc-tracking-code` for a code shown in groups, all new), every rule reading them. On a page in Korean the tight and the wide tracking are off, and a label is lifted less in its box (`--sc-label-lift` set again under `:root:lang(ko)`; the pages read `<html lang>`), since Hangul sits higher in its box than Latin capitals; menu links read the same.
- `--sc-color-text-muted` is #4b5563 and `--sc-color-text-faint` #666c7c, a step apart and both above 4.5:1 on the deepest ground.
- The text of a task and of a page of the documents is read at `--sc-text-md`; a card's number is `--sc-text-xs` and a task's beside its title `--sc-text-xl`, where they were off the scale; the answer a decision took reads in the text colour, marked by a green dot before it, where the whole of it was green; a person's picture is round, and every corner reads a radius token (the sign-in mark `--sc-radius-xl`, the dots `--sc-radius-full`); a secondary button is raised white with a light edge (`--sc-color-border`, a little lift), the strong edge under the pointer, where it was outlined in the strong edge.
