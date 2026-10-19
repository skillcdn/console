# ADR-0040: The pages are light by default

- Status: Accepted
- Date: 2026-10-19

## Context

The visual language of milestone 6 made the pages dark only: the site's dark field with a light in it, panes of glass over it, one blue accent and one warm point colour. People who work the board for hours found the dark field too heavy for a working tool, and asked for a light ground that keeps SkillCDN's branding: the same blue, the same type, the same glass and the same light in the field. The look is the stylesheet's tokens, so the change is in their values; but a custom console that set only some of them, or passed a white wordmark, was tuned against the dark defaults.

## Decision

1. **The default look is light.** `console.css` sets `color-scheme: light` on `:root`, and every colour token takes a light value: a pale ground with white above it, the site's own ink for text, the accent and the point dark enough to read on white, the tones with pale fills, the field a pale sky with the brand's blue at the top, and the glass a frosted white with a soft shadow. The categories keep their names with a dark line on a pastel fill.
2. **Nothing else changes.** No token or class is renamed or removed, no markup changes, and the slots (`brand`, `components`, `pages`, `languages`) mean what they meant. The look is still re-skinned through the tokens.
3. **Contrast is held.** Text and its tones read at 4.5:1 on the surfaces they sit on, and the edge of a control at 3:1 against the page.
4. **The default console shows the black wordmark** of `@skillcdn/brand` and says `color-scheme: light` in its page.

## Consequences

- A custom console that relied on the dark defaults changes look with the package: it sets the colour tokens back to their dark values and `color-scheme: dark` in its own stylesheet, and passes a light wordmark. The changeset says so first, as `Breaking:`.
- The skill building-a-console maps a site onto light pages: a dark colour becomes the accent, a pale one tints the field, and a mark is taken in its dark version.
- Rejected: a theme switch with dark kept as the default, which leaves the default console as heavy as it was; and both themes in the package at once, which doubles every colour decision before anyone has asked for the dark one again.
