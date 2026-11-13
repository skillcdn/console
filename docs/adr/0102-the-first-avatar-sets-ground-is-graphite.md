# ADR-0102: The first avatar set's ground is graphite

- Status: Accepted
- Date: 2026-11-13
- Amends points 2 and 3 of [ADR-0097](0097-an-avatar-is-a-planet-of-flat-shapes-in-two-tones-filled-as-pixels.md). That decision drew a planet on a ground that is nearly white, with faint squares in the bright colours of the ramps. The rest of that decision stands, and so does [ADR-0099](0099-a-set-says-how-full-its-planet-is-drawn-and-a-small-one-is-a-tenth-closer.md).

## Context

ADR-0097 left the set to a review before its first release. Its consequences noted that the palest ramps stand little off a near-white ground once a picture is as small as a chip.

The planets were then looked at on the Agents page and on an account's page, among people's photographs. A near-white tile reads as a hole in the glass, and the light ramps fade into it. The design asked for a calm, dark ground instead.

Two dark grounds were tried on every ramp, body, surface and accent of the set, at every size the pages use:

- **A deep ink** made every tile a black square.
- **A dusky slate blue** read well under the warm and green ramps. It swallowed the blue ones: ramp 11, a greyed blue, sank into it, and ramps 10 and 12 lost their edge. The problem was hue, not light, since every ramp still clears the ground in luminance.

A graphite of no hue leaves no ramp of the set in the ground's own colour.

## Decision

1. **The first set's one ground is graphite, `#51525c`**: of no hue, a step lighter than a dark one, so that the tile reads as a calm ground and not a black square.
2. **Its squares are the colours they were, three fifths of the way from the ground:** `#b9a14d`, `#b98a56`, `#6d86be`, `#6366b0`, `#9d9cae`, `#adaab5`. They are laid at half strength as before, so they read as faint stars round the planet on the larger pictures, and never louder than it. At a fifth of the way they were too faint to read as anything.
3. **The package's own ground, for a set that names none, is the same graphite**, so that a set of a deployer's that says nothing is drawn as the first set is.
4. **Ramp 11, the navy, is a denim**: `#d3dcf5 #a9b8e6 #8296d2 #6479bd #4c60a3`, where it was `#a9b6d9 #7286bd #4d5f9c #36457a #25315c`. Dark and grey itself, it stood least off any dark ground. Its middle tones, which a body is drawn in, stood about 1.2 to 1 off the graphite; they now stand about 1.9 to 2.7 to 1, clear of the royal blue beside it. It keeps the ramp that goes with it.

## Consequences

- The digests a test holds the first set and its drawing by are taken again. No set was released, so no picture anyone holds changes.
- The parts, `restAvatarPartsSchema` and the REST contract do not move: a ground is a place in the set, and the place is the same.
- The gap round a shape is drawn in the ground's colour, so a shape now stands off what it lies over by a line of graphite.
- Changing a ramp is the set's to do only before it is released; after a release it would be a second set.
