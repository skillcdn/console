# The look from a website

An organization with a website has a look already: its marks, its colours, its type. A console built for it takes that look by default, so that the board reads as the organization's and not as a second product; deploying-a-console asks for the website and hands it here, and a request for a console that names a site does the same. This page says how the look is read from the site, how it maps onto the pages, and what is left alone.

## Reading the site

Fetch the homepage as HTML, with the agent's own tools (a fetch tool, or `curl` from the shell), and its stylesheets where the head links them, and read, in this order:

| What | Where it is | What to take |
|---|---|---|
| The symbol | `<link rel="icon">` and `apple-touch-icon` in the head; an inline `<svg>` in the header; an `<img>` whose name or `alt` says logo, mark or brand | The square mark, as SVG where there is one, else the largest PNG. It goes in `brand.symbol`, in a slot one line high (`.sc-brand-symbol`). |
| The wordmark | The same header: the name as lettering, wide, often an SVG beside or instead of the symbol | `brand.wordmark`, alone or beside the symbol. A mark three or four times wider than high is a wordmark, not a symbol. |
| The colours | `<meta name="theme-color">`; custom properties on `:root` in the site's stylesheet (`--color-primary`, `--brand`, `--accent` and their kin); the rule that fills the primary button and the one that colours links, read from the stylesheet | One primary colour, as a value; a second where the site plainly has two. |
| The type | `font-family` of the body and of the headings, in the stylesheet | The names, to tell the person; a face is loaded only as the rules below allow. |
| The mood | The site itself: dark or light, flat or glassy, round or square corners | Whether the field stays light (the pages are light by default, ADR-0040; a dark site is said at the plan, and darkening the pages is the person's word, not the default), and whether the radii follow the site (`--sc-radius-*`). |

A site that cannot be fetched (a login wall, a block, no site after all), or one fetched that shows no mark or no colour of its own, ends the reading: say so in one line and ask the person for the files, or keep the honest default, the board's name alone.

## Mapping onto the pages

The pages are light: a pale field, and panes of frosted glass over it. The mapping is shown at the plan as a table, value by value, before a file is written.

- **A mark drawn in a light colour vanishes** on the light pages. Take the site's dark or black variant first (its header on a light page, a light-mode asset, a `prefers-color-scheme` rule). Found none, and the mark is one colour: recolour it to the pages' text colour, with the person's word, since the mark is theirs. A mark of several colours on a light fill: keep its fill as a rounded square behind it.
- **A dark or saturated primary colour** becomes the accent: `--sc-color-accent` and its family (`-solid`, `-contrast`, `-subtle`), as the package's README lists them.
- **A pale primary colour** tints the field: `--sc-field-gradient`, with a darker shade of it as the accent, since an accent must read on the light field.
- **Contrast is checked**, not assumed: the accent on the field, and text on the panes, at the 4.5:1 of WCAG AA for text; a shade is moved until it passes, and the plan says which.
- **The type follows the rules of the skill**: scripts, styles and fonts are bundled, never loaded from a CDN or written inline. A face the organization owns, or one under a license that allows bundling, is put in the repository and named in `--sc-font-sans`; otherwise the system faces stay, and the plan says that the site's face was not taken and why. Pretendard stays for Korean, as the default console has it.
- **The name** stays the server's (`WORKSPACE_NAME`): the look is the marks, the colours and the type, never the words.

## What is left alone

- Photographs, illustrations and copy from the site: the pages have their own content, the board.
- Marks of third parties shown on the site (partners, stores, badges).
- The structure of the site: the console's pages keep their layout; the look is skinned through the tokens of `console.css` and `brand`, and a component is replaced only when the tokens cannot do it.
- The marks of SkillCDN: a console with the organization's look shows none of them.

## Where it goes

For an organization's console deployed with deploying-a-console, the result is the source in `console-ui/` of the deployment repository, depending on `@skillcdn/console` at the console's pinned version, which the workflow builds into the image on every push; the first deploy already carries the look. For a console of one's own, the same configuration in its own repository. Either way the pages are shown before more is built on them, at the plan of deploying-a-console or at the look checkpoint of building-a-console, a screenshot where a browser can be driven.
