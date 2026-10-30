# Configuring a console

What `createConsole` takes, how the look is set, how marks, icons and faces go in, how a language is added, when a component is replaced and how a page of one's own is composed, and what a script against the API uses. The package's README lists every export and every token, and the types under `dist/` are exact; this page says what goes where.

## The configuration

`createConsole(config)` returns `{ App, mount }`; `config` takes:

| Field | What it is |
|---|---|
| `title` | What the page says until the server answers with the board's name (`WORKSPACE_NAME`). |
| `brand` | The addresses of a `symbol`, a `wordmark`, or both, imported as files so that the build takes them as assets. |
| `languages` | The packs the pages speak; a language of one's own is `src/i18n/en.ts` copied whole and translated, every key kept. |
| `components` | The pieces to replace, with the props `ConsoleComponents` names. |
| `pages` | Tabs of the console's own: each a `CustomPage` with a key, a label by language, a level (the workspace's pages or every project's) and `render`, given the data, the client, the navigation and the words. |
| `baseUrl` | The API's origin; the page's own when left out. |
| `client` | A client of one's own, for tests. |

## The look

The tokens, `--sc-*` on `:root` in the package's `console.css`, grouped as the README lists them (the colours, the glass, the field, the radii, the type), are set in a stylesheet of the console's own loaded after the package's; the blocks are styled by their `sc-` classes. A dark or saturated colour becomes the accent, `--sc-color-accent` and its family (`-solid`, `-contrast`, `-subtle`); a pale one tints the field, `--sc-field-gradient`, with a darker shade of it as the accent, since an accent must read on the light field. The mapping is shown at the plan, value by value, with the contrast checked at 4.5:1 for text ([the-look-from-a-website.md](the-look-from-a-website.md)). The pages are light by default ([ADR-0040](/docs/adr/0040-the-pages-are-light-by-default.md)); darkening them is the person's word, not the default.

## Marks, icons and faces

- The marks go in through `brand`, imported in `main.tsx` as files, so that the build bundles them as assets and gives back their addresses. The symbol's slot is a square of one line's height (`.sc-brand-symbol`, 1rem); a wide mark, three or four times its height, is a wordmark and goes in as one, alone or beside a square symbol. A mark drawn in a light colour vanishes on the light pages: take a dark version, or, with the person's word, recolour a one-colour mark.
- `build: { assetsInlineLimit: 0 }` in `vite.config.ts` keeps every picture and font a file: Vite inlines an asset under 4 KB as a `data:` address, which the policy allows for a picture and refuses for a font (`font-src 'self'`); the default console gets by only because none of its assets is that small.
- The page's icons: the mark as `favicon.svg` linked directly in `index.html`, with an `.ico` and a touch icon from the site where it has them, else when the person has them; the default console links three from its brand package through a small build plugin ([the-default-console.md](the-default-console.md)).
- The faces: a face the organization owns, or one under a license that allows bundling, which the person is asked ("Does your organization own the site's typeface, or is it under a license that allows bundling it?"), in the repository and named in `--sc-font-sans`; otherwise the system faces stay. Pretendard for Korean, `npm install pretendard` and its stylesheet imported in `main.tsx`, as the default console does. No script, style or font from a CDN.

## A component replaced

Only when configuration cannot do it. Start from the component's source under `src/components/` of the package, keep its props (the types say them), keep or add `sc-` classes so that the tokens still reach it, and pass it in `components`. A component takes its data as props and nothing from the network; what people and agents wrote goes through the package's `Markdown`, elements and never HTML.

## A page of one's own

`useConsoleData(client, projectKey)` answers the workspace and the project the page is on, kept current by the project's stream, with the actions; `matchRoute`, `PATHS`, `projectHref`, `taskHref`, `decisionHref` and `docHref` name the addresses; `Shell` is the header with the tabs and the person's menu. A page as a tab is `pages` in the configuration, its `render` composing the components over what it is given; a composition of one's own is `src/console.tsx` of the package copied, with pages added or taken away. A picture from elsewhere in what people wrote is shown through the console: the composition asks the client for its address (`pictureUrl`), and the pages load nothing from elsewhere themselves ([ADR-0048](/docs/adr/0048-a-picture-from-elsewhere-is-read-through-the-console-from-a-public-address-and-kept-a-while.md)).

## A script

`createClient` from `@skillcdn/console/api` brings no React: `createClient({ baseUrl, token })`, the token from the environment (`CONSOLE_URL`, `CONSOLE_TOKEN`) and never from a file in the repository; every answer is parsed with the package's schemas, and a refusal is an `ApiError` with the server's stable code. The client configures as its person does too ([ADR-0021](/docs/adr/0021-a-token-configures-as-its-person-does.md)): `createProject`, `updatePerson`, `createListing` and `removeListing`, `updateWorkspace`, `createCategory`, `updateCategory` and `removeCategory`, the rules with `writeRules` and `archiveRules`, and on a project (`client.project(key)`) `update`, `setIcon`, `addMember`, `updateMember`, `removeMember`, the SkillCDN token a private pack is read with (`pack-token`) and the rules as the page `rules` ([ADR-0023](/docs/adr/0023-the-rules-of-a-board-are-pages-the-workspace-and-its-projects-keep-read-first-by-every-agent.md)); refused with `auth.forbidden` where the person may not, and never the tokens themselves, which stay on the console's own pages.
