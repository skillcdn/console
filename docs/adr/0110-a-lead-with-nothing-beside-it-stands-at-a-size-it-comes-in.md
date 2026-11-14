# ADR-0110: A lead with nothing beside it stands at a size it comes in

- Status: Accepted
- Date: 2026-11-15
- Amends point 1 of [ADR-0082](0082-the-page-of-someone-who-has-arranged-nothing-is-composed-edge-to-edge.md) where nothing stands beside the lead, "on a grid of 6 columns or fewer, or with no second widget, everything stands one under the other: the lead as wide as the page", and its point 2 for that lead. The lead with widgets beside it, the widgets two to a row below and the rest of the composed page stand.

## Context

Where no widget stood beside it, the lead took the page's width and four rows, and its frame was told the size of its own nearest that shape. A widget that comes in `small` and `medium` alone on the page was told `medium`, four cells by two, and drawn in a box eight cells by four, three quarters of it empty; on a phone the same widget filled half of a box four cells by four. A person who started to arrange the page saw it drop to four cells by two, and the projects stood under the box's four rows, with the cells beside it empty.

## Decision

1. **The lead with nothing beside it is drawn at the size it is told,** on that size's cells: of the sizes it comes in on the grid, the one nearest the page's width and four rows, one that fits within that on a tie, then its own, then the smaller.
2. **Where it leaves columns, the projects follow it there:** one to a cell, in rows as long as the columns it leaves, no lower than it reaches, then across the page below it, before the other widgets; the last row may end short ([ADR-0108](0108-a-project-on-the-composed-page-stands-on-one-cell.md)). Where it is as wide as the grid, the projects stand where they stood.
3. **Arranging starts from the same cells.** Every tile of the composed page that stands on whole cells keeps them when the person starts to arrange it.

## Consequences

- A widget alone at the top of a page is drawn at a size it comes in, and its page and the arranging of it do not differ.
- On a grid of six columns or fewer, the lead with other widgets below it is as high as its size, two rows where that is `medium`, and the projects may stand before the other widgets where the lead leaves columns.
- The cells beside the lead that the projects do not reach stay empty.
- Nothing stored changes shape, and `HomeGrid` keeps its props.
- Rejected: the lead at the size it would rather have (a `small` lead on a page of twelve columns is no lead); the lead half the page wide with the projects beside it, as with widgets (a lead taller than its size again); stretching the lead's width alone (a size would still not be one it comes in).
