# ADR-0109: Arranging can put the page back as composed

- Status: Accepted
- Date: 2026-11-15
- Adds to [ADR-0061](0061-the-front-page-is-one-grid-of-tiles-a-person-arranges-by-hand.md), where Done keeps what a person arranged and Cancel lets it go, and to [ADR-0082](0082-the-page-of-someone-who-has-arranged-nothing-is-composed-edge-to-edge.md), the page of someone who has arranged nothing.

## Context

Once a person has kept an arrangement, the composed page is gone for them: a width they arranged stands as they left it, and what is new takes the first room. The composed page follows what there is, a plugin's widgets leading when it is on and the projects closing up when it is off, and an arrangement does not. A person who kept one, maybe only to set a tile right, had no way back to it but to arrange the page into something like it by hand.

## Decision

1. **While the page is arranged, a button puts it back as composed.** Every width as nobody arranged it, every tile taken off back on the page: the tiles stand where arranging starts from on the composed page.
2. **It is a change like any other.** Done keeps it, as `home` of `{ hidden: [], layouts: {} }`, which reads as nothing arranged; Cancel lets it go. The person can arrange from there before Done.
3. **There is nothing to put back where the page already stands so.** The button cannot be pressed while no width is arranged and nothing is taken off.

## Consequences

- A person who kept an arrangement can go back to the page that follows what there is, in one press and Done.
- Nothing stored changes shape: a `home` with no layout and nothing hidden was already read as nothing arranged. `HomeGrid` keeps its props.
- Rejected: putting back only the width in front of the person (the other widths would stay arranged, and this one would be closed up from them rather than composed); keeping what was taken off (the composed page has every tile, and one press would bring back less than the page it names); sending `home: null` (the component's `onSave` takes a page, and the two read the same).
