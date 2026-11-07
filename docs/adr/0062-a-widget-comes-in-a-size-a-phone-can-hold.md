# ADR-0062: A widget comes in a size a phone can hold

- Status: Accepted
- Date: 2026-11-07
- Amends point 2 of [ADR-0061](0061-the-front-page-is-one-grid-of-tiles-a-person-arranges-by-hand.md), where a size was "never wider than the grid". The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

The grid of the front page is 12 columns on a desk and 4 on a phone, and `wide` and `full` are 8 across. A `wide` tile on a phone was drawn 4 across, and its frame was still told `wide`: a widget laid out for eight cells got four, and had no way to know. A person could also pick such a size where it could not be shown. A widget that came in `wide` alone had nothing right to show on a phone at all.

## Decision

1. **Every widget has a size at most four cells across.** A manifest whose `sizes` hold none of `small`, `medium` and `large` is refused, by `console-plugin check` and by the console that reads it. The one size of before, `full`, reads as `wide` with `medium` beside it, so that an older manifest still loads and has a size to show.
2. **A grid offers the sizes that fit it.** On a grid narrower than a size, a tile does not offer that size, and one kept or started at it takes the largest it comes in that fits. Each width is arranged for itself ([ADR-0061](0061-the-front-page-is-one-grid-of-tiles-a-person-arranges-by-hand.md), point 5), so that the desk's `wide` stands where it was.
3. **A frame is told the size it has.** `init.size`, and a `size` message when the page narrows past it, say the size the widget has on this grid, never one it is not shown at.

## Consequences

- A plugin lays out only sizes it declared, each at the cells that size has; it never meets a `wide` four cells across.
- A console older than this rule can answer a widget with no size that fits. The package keeps it, drawn as wide as the grid, rather than dropping it; that is the only case in which a size is wider than the tile it is told it has.
- Rejected: a widget that scrolls sideways on a phone (a frame in a page that scrolls the other way, and a page of things nobody can reach); hiding what does not fit (a widget that a person added would be gone from the phone with nothing to say why); only telling the frame the number of columns and leaving the sizes as they were (every plugin would write the same narrow layout under a name that says otherwise).
