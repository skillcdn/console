# ADR-0108: A project on the composed page stands on one cell

- Status: Accepted
- Date: 2026-11-15
- Amends point 1 of [ADR-0082](0082-the-page-of-someone-who-has-arranged-nothing-is-composed-edge-to-edge.md), where the projects stood "in rows of as many as are alike, each row as wide as its column, so that no row ends short", and its point 2 for a project. The rest of that decision stands: the lead and the widgets beside it, the widgets two to a row below, a widget's box reaching fractions of a cell, arranging from the composed page, a width closed up from the sizes the tiles come in.

## Context

On the page of someone who has arranged nothing, a project's icon was stretched to the end of its row. Three projects beside a lead on eight columns took a cell and a third each. With no widget on the page, seven projects across twelve columns took a cell and five sevenths each, and a project alone was a bar across the page. A project comes as an icon of one cell or at the sizes of the family ([ADR-0105](0105-a-project-at-a-larger-size-is-a-glance-at-its-board.md)); none of these shapes is one of them, and whoever starts to arrange the page sees every icon drop back to its cell.

It shows most where the widgets leave the page: a plugin turned off, or one that fails because it was built for another console, takes its widgets with it, and the projects of everyone who arranged nothing stand across the whole page.

## Decision

1. **A project on the composed page is an icon on one whole cell.** The projects stand in rows from the corner of their column, in their order, as many to a row as the column has cells; the last row may end short.
2. **Arranging starts from the same cells.** A project stays where it stood when the person starts to arrange the page.

## Consequences

- A project is drawn only in a shape it comes in, on every page.
- The composed page meets the page's edges everywhere but at the end of the projects' last row.
- The column beside the lead is as high as before: the projects take as many rows there as they did.
- Nothing stored changes shape, and `HomeGrid` keeps its props.
- Rejected: stretching the projects beside the lead alone (a cell and a third is no size either); growing them together to cards to fill the row (ADR-0082 rejected a page that closes by changing what it is).
