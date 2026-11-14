# The styles

How the console's pages get their look, and the rules for whoever changes one, a person or an agent. `pnpm check:styles` holds every rule on this page and refuses a change that breaks one; [ADR-0106](../../../../docs/adr/0106-a-look-is-a-part-with-a-file-and-a-row-and-a-page-places-its-parts.md) says why.

The short of it: **a look is written once, as a part, and a page is built from the parts.** A page never draws something of its own. If you are about to write a colour, a border, a radius, a shadow or a font size in a page's file, the part you need is in the catalogue below, or it is a new part, which is a decision and not a line of CSS.

## The files

`console.css` is the order the files are read in and nothing else; the build joins them into the one stylesheet the package ships.

| File | Holds | May say |
|---|---|---|
| `tokens.css` | Every value: the colours, the type, the space, the shape, and the palettes a class carries (a category's hue, a badge's tone). | Custom properties only. This is the one file a colour is written in. |
| `base.css` | The reset the pages need. | Rules about elements, not classes. |
| `parts/<part>.css` | One part each: what a button, a badge, a pane, a row of facts looks like, in every size and state. | Anything, read from the tokens. Its classes are the ones its row of the catalogue lists. |
| `pages/<page>.css` | Where a page puts its parts. Its first line names the sources whose classes it holds. | Layout only (see below). |
| `drawn-by-pages.json` | The classes the pages still draw themselves, from before this rule. | It only gets shorter. Never add to it to pass the check. |

## How to change a page

1. **Find the part.** Read the catalogue below before writing a class. Most parts have a component in `components/ui.tsx`; use the component where there is one.
2. **Build the page from parts**, in the component: a pane is `sc-panel`, a label over a group `sc-eyebrow`, a quiet line `sc-muted`, a state a `Badge`, a row of things added to and taken from `sc-chips` of `Chip`s.
3. **Place them** with a class of the page's own, in the page's file under `pages/`: a grid, a gap, a margin, a width. That class lays its own element out and moves parts about. It gives nothing a look.
4. **If a part should look different, change the part**, in its file, for every page at once. If the thing is new, it is a new part: a file under `parts/` and a row in the catalogue. Whether the console needs another part is the designer's decision; ask before adding one, and say which existing part came closest and why it did not do.
5. **Look at it** before the commit: `pnpm dev`, at a phone's width and on a wide screen, in English and in Korean. `/parts` on that server shows every part by itself.

## What a page's rule may say

A rule in `pages/` is about one of two things, and the check reads which from its selector.

- **An element of the page's own** (the last class named is the page's): how it lays out what is in it. `display`, the grid and flex properties, `gap`, `padding`, sizes, `position`, `overflow`, text alignment and wrapping.
- **A part, where this page puts it** (the last class named is a part's, under a class of the page's): the same, but for `padding`. A page says where a part is, how much room it has and how what is in it is laid out. Its padding, its colours, its borders, its radius and its type are the part's own.

Everything else is a look: `color`, `background`, `border`, `border-radius`, `box-shadow`, `outline`, `font-*`, `line-height`, `letter-spacing`, `text-transform`, `text-decoration`, `opacity`, `filter`, `transition`, `animation`, a custom property. A look goes in a part.

Three more things the check holds:

- **Every rule in a page's file names a class of that page.** A rule about a part alone changes the part everywhere and belongs in the part's file.
- **A page's class is that page's alone.** What two pages share is a part.
- **A class a component names is in the stylesheet, and a class of the stylesheet is named by a component.** A name with no rule draws nothing; a rule nothing names is deleted in the same change.

A component sets a style on an element (`style={...}`) only for a measure it computed: a place, a share, a height. Never a colour, never a size of type. The check knows how many each source has.

## The catalogue

A part is a file under `parts/` and a row here, with the classes that are its own (`sc-button*` is `sc-button` and every `sc-button-...`).

| Part | Classes | Rendered by | Use it for |
|---|---|---|---|
| `button` | `sc-button*` | `Button`, `LinkButton`, `CopyButton` | Anything pressed. `-primary` is the one act of a form or a page, `-secondary` the act beside it, `-ghost` an act among content, `-danger` what takes something away; `-sm` in a row or a head. |
| `input` | `sc-input*`, `sc-textarea*` | | What is typed into or chosen from: a line, a select, a text area. `sc-input-quiet` is a fact changed in place, which reads as its value until the pointer or the focus is on it; `sc-input-group` puts a fixed word before a field. |
| `form` | `sc-form*`, `sc-field*`, `sc-check*`, `sc-member-form` | | A form: a field under its label with a hint (`sc-field`, `-label`, `-hint`), fields side by side (`sc-field-row`), parts under headings (`sc-form-part`), its buttons (`sc-form-actions`), what went wrong (`sc-form-error`), a tick with its words (`sc-check`), a small form on one line (`sc-member-form`). |
| `files` | `sc-file*`, `sc-chosen*` | | Files to choose, and the ones chosen with the way to take each out. |
| `toggle` | `sc-toggle*` | | One choice among a few, each a chip, the chosen one filled. |
| `picker` | `sc-picker*`, `sc-person-option*` | `Picker` | One thing chosen out of a listing that is searched: a person, a project, a goal, a task. `sc-picker-quiet` where it is a fact changed in place, `sc-picker-add` at the end of a row of chips. |
| `menu` | `sc-menu*` | | What opens from a button over the page: the person's menu, a card's. |
| `tabs` | `sc-tab*`, `sc-tabs*`, `sc-subtabs*` | | The pages of a project (`sc-tabs`), and the views of one page (`sc-subtabs` of `sc-tab`s), the current one marked. |
| `pager` | `sc-pager*`, `sc-show*` | `Pager`, `ShowMore` | A long list a page at a time: turned by pages, or grown by "show more". |
| `badge` | `sc-badge*`, `sc-kind*` | `Badge`, `DueBadge`, `GoalStateBadge`, `RoleBadge`, `RunStatusBadge` | A state or a kind in a word. The tone is the meaning: neutral, accent, success, warning, point, danger. Nothing stands before its words but the dot of one that is `live`. |
| `category` | `sc-category-swatch`, `sc-category-gray`, `sc-category-blue`, `sc-category-green`, `sc-category-orange`, `sc-category-pink`, `sc-category-purple`, `sc-category-teal`, `sc-category-yellow` | `CategoryBadge` | A colour that tells things apart: a category, a kind. The hue's class sets `--sc-category-fill`, `-line` and `-mark`, which a badge, a bar or a dot reads. The only colours that are not tones. |
| `chip` | `sc-chip*`, `sc-chips*` | `Chip` | A thing named among others in a row: a person, a team, an item, with the way to take it out. A row a person adds to and takes from is `sc-chips`. |
| `avatar` | `sc-avatar*` | `Avatar` | A person's or an agent's picture, `xs` to `xl`. |
| `person` | `sc-person*`, `sc-people*` | `PersonChip` | A person: by name in a line (`sc-person`), as a row of a list (`sc-person-row`), as a card with their facts (`sc-person-card`, `sc-person-facts`), cards in a grid (`sc-people`). |
| `workers` | `sc-workers*`, `sc-worker*` | `Workers` | The people at work on one thing, as pictures side by side with a count of the rest. |
| `mark` | `sc-mark*` | `ProjectMark` | A project's mark: its image, or its symbol on its colour; `sm`, `md`, `lg`. |
| `eyebrow` | `sc-eyebrow*` | | The small capitals over a group. The one label of that kind. |
| `progress` | `sc-progress*` | `ProgressBar` | How much of something is done and at work, as a bar with its count. |
| `count` | `sc-column-count`, `sc-nav-count` | | A number beside a title or a tab. |
| `text` | `sc-muted`, `sc-lead`, `sc-time`, `sc-loading`, `sc-project-key`, `sc-card-number`, `sc-feed-agent`, `sc-visually-hidden` | `Time`, `Day` | The tones of a line of text: quiet (`sc-muted`), the sentence under a title (`sc-lead`), a moment, a key or a number in the mono face, the agent a person acted through, and what only a screen reader is told. |
| `prose` | `sc-prose*` | `Markdown` | What people and agents wrote, rendered: headings, lists, tables, code, pictures. |
| `code` | `sc-code*`, `sc-copyable*` | `CopyButton` | A code or a command shown to be read or copied. |
| `panel` | `sc-panel*` | | A pane of the page: every section of a page is one. |
| `page` | `sc-page*`, `sc-section*` | | A page's head (`sc-page-head` with its title, its lead and its actions) and a section's (`sc-section-head`, `sc-section-title`). |
| `facts` | `sc-facts*` | | Facts as names and values: in a pane's column (`sc-facts`), bare (`sc-facts-plain`), on one line (`sc-facts-row`). |
| `callout` | `sc-callout*` | `Callout` | A note that must be read: plain, a warning, a danger. |
| `empty` | `sc-empty*` | `EmptyState` | Where there is nothing yet: what would be here and the way to make the first. |
| `spinner` | `sc-spinner*` | `Spinner` | Something is on its way. |
| `steps` | `sc-steps*`, `sc-step*` | | Steps done in order, each with its mark, the next one pointed out. |
| `settings` | `sc-settings*` | | Settings as rows: a label, its control, a hint. |
| `rows` | `sc-task-row*`, `sc-task-rows*` | `TaskList` | A list as rows, each a link with a title and what is said of it at the end. |
| `detail` | `sc-task-header`, `sc-task-title`, `sc-task-badges`, `sc-task-actions`, `sc-task-main`, `sc-task-body`, `sc-task-aside`, `sc-task-section` | | A page about one thing: its head with the title, the badges and the actions, a main column and an aside. A task, a goal and a document are laid out by it. |
| `calendar` | `sc-calendar*` | `Calendar` | A month as a grid of days, with bars across days, dots, a legend and a head. |
| `crumbs` | `sc-crumb*`, `sc-doc-crumbs*` | | The way down to where the page is, each step a link. |
| `links` | `sc-link*` | | Links as a list, or one with what it leads to. |
| `filters` | `sc-filters*` | `BoardFilters` | What narrows a page: a row of choices with the count of what is left. |
| `frame` | `sc-plugin-frame*` | `PluginFrame` | Where a plugin's page or widget is shown: the box, and the frame in it. |

Some classes are named after the first page that had them (`sc-task-row` is any row, `sc-column-count` any count). Their names stay until a change renames them everywhere at once.

A plugin's pages are built from these same parts: what this table lists is what a plugin may name, and a page's class under `pages/` is not.

## Adding to a part, adding a part

- **A variant** (another size, another tone) is a class of the part, in its file, named `sc-<part>-<variant>`. Say what it is for in the row.
- **A new part** is a file `parts/<name>.css`, its import in `console.css` among the parts, and a row here. It reads every value from the tokens, takes its name from what it is and not from the page it was first needed on, and has a place on `/parts` of the development server (`apps/console/web/src/parts.tsx`), where it is looked at by itself.
- **A new value** (a colour, a size) is a token in `tokens.css`, listed in the package's `README.md` and in `src/tokens.ts`, which sends the tokens to a plugin's pages.
- **Taking a part out** takes its file, its import and its row, in the change that takes its last use.

## What the pages still draw

`drawn-by-pages.json` lists, by page, the classes that still carry a look of their own: the calendar's bars before they were a part, a conversation's bubbles, a tile. They are what was there when the rule was made. A design pass over a page is the time to fold its entries into the parts: use the part that is there, or make the look a part, and take the entry off. The check refuses an entry that draws nothing any more, and refuses a class that draws and is not listed.
