# ADR-0082: The page of someone who has arranged nothing is composed edge to edge

- Status: Accepted
- Date: 2026-11-09
- Amends point 3 and the last sentence of point 5 of [ADR-0061](0061-the-front-page-is-one-grid-of-tiles-a-person-arranges-by-hand.md), where a page nobody arranged stood every tile at the first room "at the size it starts at" and a width nobody arranged read the same order "packed from the top". The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

Most people never arrange the front page, so the page the console packs for them is the page. Packed at the sizes the tiles start at, it rarely closed: three widgets and six projects left two cells empty at the end of the projects' row on 8 columns, and on 12 a strip of eight empty cells under two widgets, beside a widget twice their height. The page a person first meets looked unfinished, and nothing they did had made it so.

The grid's sizes are a phone's, whole cells, so that a person moves a tile anywhere (ADR-0061). They cannot also make every edge meet: half of 12 columns is no size, and six icons do not fill eight cells. A page nobody arranged is not being moved, and need not stand on whole cells.

## Decision

1. **Someone who has arranged nothing sees the page composed.** The first widget placed at the top leads, half the page wide. Beside it stand the next two widgets, one under the other, and the projects, the column as high as the lead; a column shorter than the lead's four rows gives its widgets the rows left over, alike. The projects are icons, in rows of as many as are alike, each row as wide as its column, so that no row ends short; where they would need more than two rows beside the lead, they stand below it, across the page. The other widgets stand below, two to a row, one alone as wide as the page. On a grid of 6 columns or fewer, or with no second widget, everything stands one under the other: the lead as wide as the page, the other widgets two to a row, the projects, then the widgets placed at the bottom.
2. **A composed tile need not stand on whole cells.** Its place and reach are in cells, as on the grid, and may be fractions of one, so that every edge meets another or the page's. Its frame is told the size of its own nearest the shape it has, one that fits within it on a tie, so that a frame is never told of more room than it has.
3. **Arranging starts from the composed page.** Each widget takes the cells nearest where it stood, at the size it was told, and the projects one to a cell from the corner of theirs, in their order. From there the person arranges as ADR-0061 says, and Done keeps it.
4. **A width nobody arranged, when another was, is closed up.** In the order kept at the other width, each tile takes one of the sizes it comes in on this grid, chosen so that the fewest cells stand empty within the rows the page takes, then so that the fewest tiles leave the size they would rather have (the one kept at the other width), then so that the page is the shortest. The projects take one size together, so that they line up; a page that cannot close leaves the fewest cells empty it can. At most 4096 combinations are tried; past that, the widgets furthest down keep their size.
5. **What a person arranged is theirs.** A width they arranged stands as they left it, gaps where they put them, and what is new there takes the first room at the size it starts at, as before.

## Consequences

- The page a person first meets meets the page's edges at every width, its lead beside what follows it.
- The page nobody arranged and the page being arranged differ by up to half a cell; the tiles keep their place in the document, so that a frame does not load again when arranging starts.
- A widget may first be shown at a size other than its `defaultSize`, always one it declared, in a box a little larger than that size's cells. `defaultSize` is the size a widget would rather have.
- Nothing stored changes shape: `home` on `me` is as it was, and `null` still means nothing kept. `HomeGrid` keeps its props; the classes and tokens are those of before.
- Rejected: closing the grid up alone, from the sizes (tried first: the lead shrank to a medium and the projects grew to cards, so that the page closed by changing what it was); tiles that stretch to the end of a row on the grid being arranged (a size would no longer be a phone's); a layout for the projects outside the grid (they would stop being tiles a person moves).
