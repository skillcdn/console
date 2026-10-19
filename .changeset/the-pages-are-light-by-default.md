---
"@skillcdn/console": patch
---

Breaking: the pages are light by default (ADR-0040). `console.css` sets `color-scheme: light`, and every colour token takes a light value that keeps SkillCDN's branding: the ground `--sc-color-bg` #f5f7fb with white above it, the text #14141a, the accent #2c5bc4 on a solid #3b6fd4, the point, the tones and the categories' lines dark enough to read on their pale fills, the field a pale sky with the brand's blue at the top, and the glass a frosted white. No token or class is renamed or removed and no markup changes. A console that wants the dark look of 0.3.2 sets the colour tokens back to their values there and `color-scheme: dark` on `:root` in its own stylesheet, and passes a light wordmark to `brand`. The default console shows the black wordmark of `@skillcdn/brand`, and the skill building-a-console (1.6) maps a website onto light pages.
