# ADR-0061: The front page is one grid of tiles a person arranges by hand

- Status: Accepted
- Date: 2026-11-07
- Supersedes the cells of point 1 and all of point 3 of [ADR-0059](0059-a-person-arranges-the-front-pages-widgets-from-the-sizes-each-comes-in.md); the sizes keep their names, and the frame is told its size as before. The contract is in [specs/plugins.md](../specs/plugins.md) and [specs/rest.md](../specs/rest.md).

## Context

Arranged as ADR-0059 had it, the front page was a list of projects with widgets above and below it. Moving a widget took an arrow, a step at a time, or a drag that could only say "before that one", in one of two places; the projects did not move at all, and clicking one while arranging left the page. Beside it stood a Default layout, a second arrangement to keep in mind: the manifests', which came back with a press and left nothing of what the person had done.

A person already knows how to arrange a screen. On a phone everything is a tile on one grid, picked up and put down anywhere, those in the way moving aside, and what is not wanted is taken off. The board moves a card the same way.

## Decision

1. **One grid, and everything on it is a tile.** The front page is a grid of square cells, each as wide as the page gives it: 12 columns from a width of 1520 pixels, 8 from 900, 6 from 560, 4 below. The projects and the widgets stand on it alike, each at a place of its own, and cells may stay empty.
2. **The sizes are a phone's.** A project is an `icon` of 1×1, its mark, its name and what waits in it, or `small` of 2×2, with what it is. A widget keeps its family at new cells: `small` 2×2, `medium` 4×2, `large` 4×4, `wide` 8×2, `full` 8×4, never wider than the grid. Widgets do not come as an `icon`: a frame under its name has no room to say anything in one cell.
3. **There is no default layout.** What the person has not seen yet takes the first room reading from the top, at the size it starts at: a project made since, the widgets of a plugin as soon as it is enabled. What they take off stays off and is offered to add back. Nothing is kept for them until they arrange something, and nothing resets it; for someone who has arranged nothing, a manifest's `place` says only whether a widget comes before or after the projects.
4. **Arranging is done by hand, and nothing opens meanwhile.** A tile is taken in hand with the mouse, or with a finger that rests on it a moment first, as a card on the board is, and put down on any cell. Where the place is free it stands there. On a tile of its own shape, the tiles of that shape between the two places each move one place towards the one it left, so that a row of icons closes up. A smaller tile gives way to the nearest room; a larger one stays, and the tile lands beside it. Those in the way stand aside while the tile is held over them and go back when it moves on. The arrow keys move the tile with the focus a cell, and Delete takes it off. Each tile carries the way off the page and the sizes it comes in, as little pictures of their shapes. Done keeps what was done, Cancel lets it go.
5. **Each width is arranged for itself.** `home` on `me` holds `hidden`, the tiles taken off, and `layouts`, by the number of columns, each tile `{ tile, x, y, size }`, `tile` being `project:<id>` or `widget:<plugin>:<widget>`. A width nobody arranged reads the same order packed from the top, so that arranging on a phone leaves the desk as it was. What was taken off is off at every width.
6. **What a person may not see for now keeps its place.** A tile of a plugin turned off or a role gone is out of sight, and comes back where it stood; if something took its cells since, it takes the nearest room.

## Consequences

- `ProjectList` and `PluginWidgets` leave the package: `HomeGrid` is the page, `ProjectTile` a project on it, and the composition's slot is `HomeGrid`. A custom console that replaced the list replaces the page.
- `home` changes shape before it was ever released; migration `0038` lets go of what the first shape held.
- `widgets[].place` stays in the manifest, with less to say. Size names mean more room than they did: a `small` is square now, and a plugin that drew a low strip for it lays itself out again.
- The tiles in the document stay in the order they came in while the page is open, since moving a frame in the document reloads it; the keyboard's order is the page's own from the next load.
- Rejected: an order alone, packed by the browser, as a phone's icons used to be: simpler, but a widget could not stand at the right of an empty row, and two sizes side by side could not be lined up. One layout for every width: arranging on a phone would have undone the desk. A corner to drag for the size: a size is one of a few, so that a dragged corner would snap between them, and a little picture of each says at once what there is.
