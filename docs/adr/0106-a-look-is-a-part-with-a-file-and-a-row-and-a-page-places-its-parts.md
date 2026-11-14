# ADR-0106: A look is a part with a file and a row, and a page places its parts

- Status: Accepted
- Date: 2026-11-14

## Context

The package's rule was a sentence: a page is built from the console's parts, a class of the page's own places a part and never repaints it, and a rule reads its colours from the tokens. Nothing held it. The stylesheet was one file of 8,800 lines and 700 classes, of which 550 were named by one component each and 280 of those set a colour, a border, a radius or a size of type: most pages had drawn most of what they show for themselves.

It was written that way by people and by agents alike, and for the same reason. To follow the rule one had to know what parts there are, and the answer was to read the whole file. Nobody does; an agent asked to make a page look better least of all. It writes a class for the page, gives it a look, and the look is one more that resembles five others. A design pass then repaints what the last one drew, the stylesheet grows with every page, and re-skinning through the tokens stops reaching whatever wrote its values out.

The plugins' repository met the same thing and answered it with a check that refuses a colour in a plugin's stylesheet. The console had no such check, and its parts were not listed anywhere a plugin's author could read them either.

## Decision

1. **The stylesheet is four kinds of file**, under `packages/console/src/styles/`, read in this order: `tokens.css`, the values; `base.css`, the reset; `parts/<part>.css`, one part each; `pages/<page>.css`, one page each. `console.css` there is the order and nothing else, and the build joins the files into the one stylesheet the package ships, `@skillcdn/console/console.css`, as before.

2. **A look is a part.** What something looks like, its colours, its borders, its radius, its shadow, its type, is written in a part's file and nowhere else. A part is a file and a row in the catalogue, `packages/console/src/styles/README.md`, which says what classes are its own, what renders it and what it is for. The catalogue is where one looks before writing a class, and it is short enough to be read whole.

3. **A page places.** A page's file holds the classes of its own sources, named on its first line. A rule there lays out an element of the page's own, or says where a part is and how much room it has; it gives nothing a look and does not pad a part. Every rule in it names a class of that page, so a part is never changed from a page's file, and a class two pages need is a part.

4. **A colour is written in `tokens.css` alone**, on `:root` or on a class that carries a palette, as a category's hue and a badge's tone are. Every other file reads it.

5. **What the pages drew before this is listed, and the list only gets shorter.** `drawn-by-pages.json` names, by page, each class that still carries a look of its own, and each part a page repaints where it holds it. A class that draws and is not listed is refused; an entry that draws nothing any more is refused too. The entries are what a design pass over a page folds into the parts.

6. **A class a component names is in the stylesheet, and a class of the stylesheet is named by a component.** The few names that have no rule, by which a script or a test finds an element, are listed in the check with the reason for each.

7. **A component sets a style on an element only for a measure it computed**, a place, a share, a height; the check knows how many each source has.

8. **`pnpm check:styles` holds all of it**, as part of `pnpm check`, and says with each refusal what to do instead: the reader of a refusal is about to write the next line. It has no way to write the list or the counts for itself.

## Consequences

- An agent changing a page meets the rule as a failing check with the way out, in place of a sentence in a document it did not read. Claude Code is also given the rule when it opens a file under the styles or the components (`.claude/rules/pages.md`), which points at the catalogue; the rule itself stays in the package's documents, for every agent.
- Adding a part is a visible act: a new file, a new import, a new row. Whether the console needs another part is a decision of design, made before the file is written, and the count of parts is read off a directory.
- The pages still draw 239 things themselves. The list is the measure of what is left, and it is not a debt to pay at once: a page's entries are folded when the page is next redesigned.
- The split moved every rule whole. The pages were compared before and after, element by element and property by property as the browser computed them, wide and at a phone's width; the colours that were written out in rules became tokens of the same value (`--sc-color-shade`, `--sc-shadow-sheet`, a badge's palette).
- A file later in the order wins over an earlier one where two rules of the same weight meet. A part's rule that leaned on coming after a page's must now carry its own weight.
- Some classes keep the name of the first page that had them, `sc-task-row` for any row. Renaming is a change of its own, made everywhere at once; a plugin names these classes too.
- What the catalogue lists is what a plugin may name. The check of a plugin does not yet hold a plugin to it.

## Alternatives considered

- **The sentence, said louder.** It had been said, in the package's README and in the working agreement, and the stylesheet is what came of it.
- **One file, with marked sections.** The check could read sections as well as files, but the reader could not: the point of a part's file is that it is small enough to open.
- **A class per declaration**, composed in the component. It would end the stylesheet's growth and move the looks into every component's `className`, where a part can no longer be changed in one place and a plugin has nothing to name.
- **Cascade layers**, the pages in a layer above the parts. A layer wins whatever the weight of the rule under it, so every page's rule would beat every part's state, a button's hover among them; the order of the files gives the same precedence only where the weights are equal, which is what was there before.
- **A count that may not rise**, in place of the list. It lets a new look in for every one taken out, and says nothing of which.
