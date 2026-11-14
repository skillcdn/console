---
paths:
  - "packages/console/src/styles/**"
  - "packages/console/src/components/**"
  - "packages/console/src/*.tsx"
  - "apps/console/web/src/**"
---

# Changing how a page looks

You opened a file of the console's pages. The rules for them, and the catalogue of the parts they are built from, are in `packages/console/src/styles/README.md`. Read it before you write a class or a line of CSS. It is short. This file holds no rule of its own; it is here so that you read that one.

What it comes to:

- **Find the part first.** A look (a colour, a border, a radius, a shadow, a size of type) is written once, as a part under `styles/parts/`. The catalogue lists every part with the component that renders it. Build the page from those.
- **A page's class only places.** In the page's file under `styles/pages/` it lays its own element out and says where a part is. It gives nothing a look and pads no part.
- **A colour is written in `styles/tokens.css` alone.** No `style={...}` for a look, either: a style on an element is a measure the component computed.
- **The check runs after every file you write here** (`pnpm check:styles`) and says what to do when it refuses. Do that. Never add to `drawn-by-pages.json`, or to the lists in `scripts/check-styles.mjs`, to get a look past it.
- **A new part is not yours to add unasked.** If no part does what the page needs, say which part came closest and why it does not do, and ask; whether the console gets another part is a decision of design.
- **Look at what you changed**: `pnpm dev` (the preview starts it), `/parts` for a part by itself, at a phone's width and on a wide screen, in English and in Korean.
