# ADR-0059: A person arranges the front page's widgets, from the sizes each comes in

- Status: Accepted
- Date: 2026-11-06
- Amends point 4 of [ADR-0054](0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md), which placed the widgets as the manifest said. The contract is in [specs/plugins.md](../specs/plugins.md) and [specs/rest.md](../specs/rest.md).

## Context

A widget sat where its manifest put it, a third, a half or the width wide, as tall as it asked up to a bound, for everyone who held the role. The first plugin's two widgets showed what that misses: a member wants their own balance and nothing else, an approver wants who is out today and what waits, large, and the person in charge wants both. The person at the page knows what they want to see; the plugin knows what layouts it can draw.

## Decision

1. **A widget comes in sizes of a family, and in nothing else.** The sizes are cells of the front page's six-column grid, whose rows are of one height: `small` 2×1, `medium` 3×1, `large` 3×2, `wide` 6×1, `full` 6×2. A manifest declares the `sizes` a widget comes in and the `defaultSize` it starts at (the first of them when left out); the one `size` of before reads as one of the family, a third as small, a half as medium, the width as wide. A widget fills the cells its size gives it; the height it says is not read. There is no free resizing: a frame cannot lay itself out for every width, the grid would come apart, and a plugin that draws and tests two or three layouts is the realistic one.
2. **The frame knows its size.** `init` carries `size`, and a `size` message follows when the person changes it, so that the plugin lays itself out for the cells it has, as it does for the theme.
3. **The person arranges.** Their arrangement is their own, kept on them (`PATCH /api/v1/me` with `home`, answered on `GET /api/v1/me`): which widgets, each at which of its sizes, in what order, above or below the projects; nothing kept means the manifests' arrangement, as before. On the front page they add a widget their roles allow, take one out, move one before another, by dragging or by a step, and pick its size among those it comes in; a widget they may no longer see, for a role gone or a plugin disabled, drops out quietly. On a narrow screen the widgets stand in one column in the same order.

## Consequences

- The approver's page and the member's page differ, from the same two widgets; the plugin draws the layouts it declared and nothing in between.
- A manifest of before is as it was: its one size is one of the family, and the person may still add, take out and move.
- Rejected: free resizing (a frame cannot follow a continuous width, and the grid would not hold); an arrangement per role set by an administrator (the person at the page knows better, and the manifest's default is the administrator's word); widgets on a project's pages, which wait for the need.
