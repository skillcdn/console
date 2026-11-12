# ADR-0099: A set says how full its planet is drawn, and a small one is a tenth closer

- Status: Accepted
- Date: 2026-11-12
- Amends points 3 and 6 of [ADR-0097](0097-an-avatar-is-a-planet-of-flat-shapes-in-two-tones-filled-as-pixels.md), which drew a planet as its set wrote it at every size but the smallest, and up to 1.4 times there. The rest of that decision stands.

## Context

The planets of ADR-0097 were looked at on the pages, in the review that decision left the set to before its first release. Two things were asked of the drawing, and nothing of the set's outlines or colours.

A picture as small as a chip beside a name, or one among a task's workers, had its planet drawn up to 1.4 times: as large as what stands beside it left room for. At that size a body with nothing beside it filled its tile to the edge, and no longer read as one of the family whose larger pictures stand in air. A tenth closer keeps the family and still helps the smallest tile.

At every other size the planet stood a little small in its tile. The set is drawn as a sheet of pictures seen side by side, where air round each sets it off its neighbours; on a page a tile stands alone on a panel, and the same air reads as a planet too small for it.

How full a planet stands in its tile belongs to the set, as its outlines do: another set, a deployer's own, is drawn for its own air, and the package has no reason to enlarge it. How much closer a small picture is drawn stays the package's, for the sizes a set says nothing of.

## Decision

1. **A set says how much larger than written its planet is drawn.** `AvatarSet` takes `fill`, a number from 1 to `AVATAR_FILL_MOST` (1.5): the body, its surface and what stands beside it are drawn that many times as large about the middle of the picture, at every size. A set that says nothing is drawn as written. The squares on the ground are not moved.
2. **The first set asks for 1.05.** It is part of the set's data and under its digest, so it never changes once the set is released.
3. **A small picture is drawn a tenth closer.** Under `AVATAR_CLOSE_UNDER` pixels a side the planet is drawn up to `AVATAR_CLOSE_MOST` times what its set writes, now 1.1, or what the set's `fill` says where that is more.
4. **Neither goes past the room the picture has.** As before, what reaches farthest from the middle, the body or what stands beside it, is kept within 0.94 of the picture's half; a planet that has no room is drawn as written.
5. **What a set asks that is no number a drawing can use is left out**, and a number outside the bounds is brought back to them, as with everything else a set of a deployer's holds.

## Consequences

- The digests a test holds the first set and its drawing by are taken again. No set was released, so no picture anyone holds changes.
- `restAvatarPartsSchema` and the REST contract do not move: the parts are places in a set, and how full the set is drawn is no part.
- The package exports `AVATAR_FILL_MOST`; `AVATAR_CLOSE_MOST` is 1.1.
- A picture file is drawn as full as a picture on a page: one rule at every size above the small ones.
