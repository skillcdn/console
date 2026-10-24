---
"@skillcdn/console": patch
---

Every badge is a pill, a tone says one thing, and a badge's kind shows in how it is filled.

- `Badge` takes `kind` (`state`, `priority`, `due` or `count`, which the state, priority, due and count badges set as `sc-badge-kind-*`) and a `className` of its own, for a step within a kind.
- A tone: neutral for what merely is, accent (blue) for what is at work, success (green) for what is done, warning (amber) for what wants attention within the week, point (orange) for what presses today or tomorrow, danger (red) for what is late or has failed. An administrator and an owner are marked in the accent, not the warm point.
- A kind: a plain badge (a role, a count, public or private) is a soft fill with a line of its hue; a category and a state a soft fill with no line; a priority a soft fill with dark words of its hue, low a grey, high an orange, urgent a red; a due day a tag with a line, a very light fill and bold figures lined up, all in the hue of how near the day is: grey for a day set or a task that is over, amber within the week, orange tomorrow, a deeper orange today (`sc-badge-due-today`), red once past.
- Words on a yellow fill are a warm charcoal, since a dark yellow reads as a muddy brown. Each fill is deep enough to stand off the sheet on its own, and every pair of words reads above 4.5:1 on its fill. A badge's words are centred on their cap height and baseline whatever script they are in, where the browser fits a line box to the glyphs (`text-box: trim-both cap alphabetic`); where it cannot, the lift by language stands.
- The eight category colours are spread around the wheel, each fill its own hue at a glance with its words dark in the same hue, and each has a mark colour, a clear mid-tone of its hue (`--sc-category-mark`, new), for the legend dots, the goal flags, the swatches and the edges and progress of bars on the month and the roadmap, where the dark line colour made for words went muddy and alike. A console that sets only the line and the fill gets its line where the mark would be.
