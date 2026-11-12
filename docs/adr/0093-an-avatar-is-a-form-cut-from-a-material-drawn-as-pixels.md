# ADR-0093: An avatar is a form cut from a material, drawn as pixels

- Status: Superseded by [ADR-0097](0097-an-avatar-is-a-planet-of-flat-shapes-in-two-tones-filled-as-pixels.md), which draws a planet of flat shapes in place of the still life and takes points 5 and 6 over as they are
- Date: 2026-11-12
- Amends point 8 of [ADR-0084](0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md), which made the avatar a face of flat parts (background, head, ears, eyes, mouth, marks, accessory, palette), each a list of simple shapes drawn as SVG and as PNG. Everything else of that point stands: a seed and its parts, drawn where shown, a picture file where one is needed, a released set that never changes, nothing uploaded and no SVG from outside.

## Context

The first set drew a face: a head with ears, eyes and a mouth, in flat colours. Looked at on the pages, the faces were not good to look at, and nothing short of other shapes would have mended them: a face of a dozen primitives is a cartoon, and a cartoon wants a hand the generator does not have. The request that followed was for something more abstract, of fewer elements, with a texture such as marble among them, in colours chosen with more care, and with leave to change what the parts are.

A texture cannot be written as a handful of ellipses and rectangles. It is a function of a point: what the stone looks like there. Once the picture is such a function, an SVG of shapes has nothing left to say, and the one renderer the package needs is the one that asks the function for each pixel.

The first set was never released: no version of the package carried it, and no deployment holds an avatar made with it. So it is replaced, and no second set is added beside one nobody has.

## Decision

1. **An avatar is a small still life.** One form, cut from a material, stands on a floor before a wall, with one small thing beside it or nothing. There is no face. The parts are `palette`, `ground`, `form`, `material`, `accent` and `vein`, each a whole number from 0 to 255, with `set`, the version of the set they are places in. `vein` is the seed of the stone's grain and is a place in nothing: two avatars alike in every other part still differ in their veins.
2. **The first set** has twelve forms a child could name (an orb, an arch, a dome, a block, a pill, a moon, a ring, a leaf, a gate, a quarter of a disc, a peak, a gem), six materials (marble, terrazzo, strata, speckle, glaze, onyx), twelve palettes named after stones, each a wall, a stone, what runs through the stone and an accent, four grounds (a wall and a floor, a wall alone, a pale disc on the wall, a niche in it) and four things to stand beside the form (a ball, a bar, a small disc up on the wall, a pebble) or none. Marble is the set's own material and is rolled about one time in three.
3. **The picture is a function of a point, and the package draws it as pixels.** A form is the distance from a point to its outline; a material is the colour of the stone at a point, from noise a seed gives; the light, the shadow under the form and a grain over the whole are computed the same way. `avatarPixels` asks the function for every pixel, four times each for a small picture so that it is not rough. There is no SVG of an avatar any more (`avatarSvg` and `avatarShapes` are gone), and still no renderer of anyone else's.
4. **The same parts give the same pixels on every machine.** The function uses sums, products and square roots, and no function a runtime may round its own way (no sine, no exponential, no power). A test holds the look of the set by a digest of what it draws, which is what "a released set never changes" means now that a set holds functions.
5. **A page shows the picture as an image it made itself.** `avatarDataUrl` draws the avatar and answers the address of a whole PNG (`data:image/png;base64,…`), written at once with a stream that packs nothing, and kept, so that a picture shown in many places is drawn once. The pages' policy already allows such an address for an image. A picture file for a profile elsewhere is written as before, packed by the runtime (`console agent <handle> --avatar <file>`, and the button on the agent's page), up to 1024 pixels a side.
6. **An agent account's picture is a soft square where a person's is round.** The stylesheet cuts it so wherever a member is shown, at the size of a chip as on a page of its own: an agent account is told from a person at a glance, in any language, before a badge is read.
7. **A set of a deployer's own is code, as it was data.** `AvatarSet` holds the palettes as colours, the grounds and the accents by name, and the forms and the materials as functions (`AvatarForm`, `AvatarMaterial`), under a version the package does not use. `createConsole`'s `persona.avatarSets` takes it as before.

## Consequences

- `restAvatarPartsSchema` has other fields, and the snapshot of the REST contract is taken again without the floors moving: the floor that carries agent accounts was never released, so no command reads the fields that went.
- `AvatarPicture` is an `img` and takes a `size`; `Avatar` gains the size `xl`. The package no longer exports `avatarSvg`, `avatarShapes`, `AVATAR_BOX`, `AVATAR_PARTS` or the shape types, and exports `avatarDataUrl`, `AVATAR_FLOOR`, `AVATAR_VEINS` and the types of a set's parts.
- A picture file of the largest size is near a megabyte where a flat face was some tens of kilobytes: a stone has a grain, and a grain does not pack. Every profile form the plan names takes such a file.
- Drawing costs time the SVG did not: about four milliseconds for a picture of 128 pixels and a third of a second for the largest, on a laptop. A page draws each picture once and keeps it.
- An avatar of a set a reader does not have, or with a place past the end of a list, still draws, as before: with the newest set, counted round the end.
- What an editor of an avatar's parts would offer changes with the parts; none is built ([roadmap](../roadmap.md)).
