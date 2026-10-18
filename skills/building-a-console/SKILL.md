---
name: building-a-console
description: "Builds a console from the @skillcdn/console package: a console of a person's own, served from their machine with their token by console serve; an organization's console, which takes the default UI's place in the image and, given the organization's website, takes its look, the marks, the colours and the type, by default; or a script against the console's REST API. Says where the package's layers are (the API client and schemas, the components, the composition), how the default console is put together, what to configure and what to replace (a component, the language packs, the brand, the styles' tokens), how a look is read from a website and mapped onto the pages, how a build is run against the board and checked, and the rules that keep untrusted content harmless. Use when an agent is asked to make, change, re-skin or extend a SkillCDN Console UI or a client of its API. To work tasks on the board, use working-the-board; to deploy a console for an organization, use deploying-a-console."
license: MIT
compatibility: A shell with Node.js 24 or newer and npm or pnpm, and an agent that reads and writes files. For looking at the pages against a board, the console command signed in by a person. A browser the agent can drive is optional. No key of the agent's own is needed, and it never sees a token.
metadata:
  author: skillcdn
  version: "1.5"
skillcdn:
  translations:
    ko:
      title: 패키지로 콘솔 만들기
      description: "@skillcdn/console 패키지로 콘솔을 만듭니다. console serve로 내 PC에서 내 토큰으로 돌리는 개인 콘솔, 이미지에서 기본 UI 자리를 대신하며 조직의 웹사이트가 있으면 그 디자인(마크, 색, 글꼴)을 기본으로 삼는 조직 콘솔, 또는 콘솔 REST API를 쓰는 스크립트. 패키지의 세 계층(API 클라이언트와 스키마, 컴포넌트, 구성)이 어디 있는지, 기본 콘솔이 어떻게 조립되는지, 무엇을 설정하고 무엇을 바꾸는지(컴포넌트, 언어 팩, 브랜드, 스타일 토큰), 웹사이트에서 디자인을 읽어 페이지에 입히는 법, 빌드를 보드에 붙여 돌리고 확인하는 법, 신뢰할 수 없는 내용을 안전하게 다루는 규칙을 말합니다. SkillCDN 콘솔 UI나 API 클라이언트를 만들거나 바꾸거나 디자인을 바꾸라고 할 때 쓰세요. 보드의 작업을 할 때는 working-the-board를, 조직의 콘솔을 배포할 때는 deploying-a-console을 쓰세요."
---
# Building a console from the package

What goes in: what the console is for, which is one person's own, the organization's, or a script against the API, and what it must show or do. What comes out: a small repository that depends on `@skillcdn/console` and builds to static files, served by `console serve` on one person's machine, or, for the organization, built into the image: as the source in `console-ui/` of its deployment repository, or as a build beside the Dockerfile that `deploy/README.md` shows; or a script that talks to the REST API with a token. Nothing of the server is built: a console shows an organization's board through its API and holds nothing of its own.

## How the person is involved

- **Questions:** one message at the start, the ones under "Inputs" that the request leaves open, each for the half it leaves open. Everything else is derived and shown with the plan.
- **Checkpoints:** the plan (the kind, where the build goes, what is configured and what is replaced, the colours and the marks as they will be used), before a file of the console is written; the look, with the pages in front of them, before more pages are built on it. One short message each, with the recommendation; "OK", in the person's language, continues.
- **Go-ahead:** when the person says to go ahead alone, the look is reported instead of approved; the plan holds in every mode. Nothing is pushed or published here.
- **Changes mid-run:** applied from that point; a change after the build rewrites the parts it touches, not the whole console. A phase with nothing to do for the request is skipped, and the line says so.

## Requirements

| Need | How | When missing |
|---|---|---|
| Node.js 24 or newer, with npm or pnpm | `node --version` | Stop and say so. |
| The package | `npm install @skillcdn/console react react-dom`, for pages `npm install --save-dev vite @vitejs/plugin-react typescript`, and for Korean `npm install pretendard`, the face the default console loads | The package is on npm; nothing else is needed. |
| For looking at the pages against a board, one's own or the organization's: the `console` command, signed in | `console whoami` says as whom and at which console. | `npm install -g @skillcdn/console`, then `console login --url <the console's address>`: a person approves the code it shows. Never look for a token. |
| Optional: a browser the agent can drive, or a screenshot tool | Looking at the pages and their console at the look checkpoint and for the verdicts. | The person opens the local address themselves, and the layout, console and policy verdicts are reported as not run. |

## Where to read, in this order

Nothing here restates them: they are the contract, current at the version installed.

1. **The package's README**: `node_modules/@skillcdn/console/README.md` once installed, [`packages/console/README.md`](/packages/console/README.md) in the console's repository. Every export by layer and what each takes, the styles, the languages, and "A console of your own" with two of the four files to write.
2. **The types**: `node_modules/@skillcdn/console/dist/index.d.ts`, `api.d.ts`, `cli/cli.d.ts` and `web.d.ts`: the exact props of every component and the shape of every answer, with the comment that says what each is for. `brand` takes a `symbol`, a `wordmark`, or both.
3. **The sources**, shipped with the package under `src/`: `console.tsx` (how the default console composes the pages from the components, routes, and loads its data), `components/*.tsx` (each component and what it renders), `data.ts` (how the workspace and a project are loaded and kept current by the stream), `styles/console.css` (the tokens, `--sc-*`, and every class, `sc-`-prefixed), `i18n/en.ts` (every word the pages show, keyed as a pack is). The repository's tests (`packages/console/src/components/components.test.tsx`, `src/console.test.tsx`), not shipped in the package, show what each piece renders, for tests of one's own.
4. **The REST API**: [docs/specs/rest.md](/docs/specs/rest.md), in the package at `docs/specs/rest.md`: every route, what it takes and answers, who may ask, and the codes of its refusals. **The command line**: [docs/specs/cli.md](/docs/specs/cli.md).
5. **The default console itself**, `apps/console/web/` in the console's repository: the page, the script, the build and the compiler's settings, with the brand, the fonts and the icons wired in. Its four files are quoted in [the-default-console.md](references/the-default-console.md), kept identical to them by the repository's check, for an agent that has the skill and not the repository; a console of one's own copies their shape.
6. **The architecture**: [docs/architecture.md](/docs/architecture.md) for how the parts fit, and the [decisions](/docs/adr/README.md), served through the repository's connection and not in the package; ADR-0014 says how a person's own console reaches the organization's.

## Inputs

| Input | Source |
|---|---|
| Which kind | Asked when the request does not say: "Is this console for you alone, served from your machine with your token; for the whole organization, in place of the default pages in the image; or a script against the API?" A member usually wants their own. |
| Where the organization's build goes | Asked for the organization's: "How is the console run: with the deployment repository that deploying-a-console made, with an image you build yourselves, or from a directory mounted into it?" The answer places the result: the source in `console-ui/` of that repository, which its workflow builds on every push; a repository of its own whose build goes beside the Dockerfile of [deploy/README.md](/deploy/README.md) "A custom console in the image"; or the build in the directory. |
| What it must show or do | From the request: a page, a component, a language, a brand, a column, a filter, a report. Asked for its missing half: "What should it show or do that the default console does not?" Everything else is the default console's and stays. |
| The marks | From the organization's website when the request, or deploying-a-console, names one: its symbol and wordmark read from the site as [the-look-from-a-website.md](references/the-look-from-a-website.md) says, the light version or, with the person's word, the one-colour mark recoloured, shown at the plan. Else asked for a console that shows marks of its own, for the half the request leaves open: "Which picture should the pages show beside the board's name: a small square mark, the name as lettering, or both? Where is the file? The pages are dark, so it should be a light one." `brand` takes either or both. The symbol's slot is a square of one line's height (`.sc-brand-symbol`, 1rem): a wide mark, a lettermark of three or four times its height, is a wordmark and goes in as one, alone or beside a square symbol. A mark drawn in a dark colour vanishes on the dark pages: ask for a light version, or, with the person's word, recolour it when it is one colour. Default without a site: the board's name alone and no marks, which is the honest console. |
| The colour | From the website's own colours when one is named, as the reference says, its primary colour read from the theme colour, the stylesheet's properties or the primary button. Else asked when the request names none and marks are wanted: "Which colour, or which mood?" A colour comes as words or a value; the value is the mark's own fill when it has one, else chosen and shown. A light colour becomes the accent (`--sc-color-accent` and its family); a dark one tints the field and its light (`--sc-color-field`, `--sc-color-light-*`), with a lighter shade of it as the accent, since an accent must read on the dark field. The mapping is shown at the plan, with the contrast checked. |
| The languages | Asked when the organization's language is not among the packs: "Which languages should the pages speak?" Default: the packs the package ships, chosen by the browser; a Korean organization gets Pretendard loaded, as the default console does. |
| The name | Not asked: the server names the board (`WORKSPACE_NAME`, conventionally the organization or the person it is for, then Console: `Acme Console`), and `title` is only what the page says until the server answers. `index.html` gets the organization's `<title>` and `lang`. |
| The console's address | For running one's own, what `console whoami` says. A script takes `CONSOLE_URL` and `CONSOLE_TOKEN` from the environment, never from a file in the repository. |

## Workflow

Each phase produces something the person can look at and ends with one line to them.

### Phase 1: Start from the default console

Produces the **plan** and the first build. Install first, in the new folder, so that the README, the types and the sources are at hand for the plan: the install writes only `package.json`, the lockfile and `node_modules`, and the plan is shown before any file of the console is written. A console is four files and a configuration: `index.html` with a `#root`, `src/main.tsx` that calls `createConsole({ ... }).mount(root)` and imports `@skillcdn/console/console.css`, `vite.config.ts` with the React plugin and, for building against the real board, `/api` sent to `console serve` with `changeOrigin`, and `tsconfig.json` with `jsx`, `moduleResolution: "Bundler"` and the `vite/client` types that make an imported picture a module. The README's "A console of your own" shows two of them, the-default-console.md all four with the marks, the icons and a face wired in. Write the plan (the kind, where the build goes, the files, what is configured, what is replaced, the colours and the marks) and stop for the checkpoint; then write the files and build: `npx vite build` makes `dist/` with its `index.html`. A script instead imports `createClient` from `@skillcdn/console/api`, which brings no React.

### Phase 2: Configure before replacing

Produces the **configuration**. `createConsole(config)` takes `title`; `brand`, the addresses of a symbol and a wordmark; `languages`, the packs the pages speak, where a language of one's own is `src/i18n/en.ts` copied whole and translated; `components`, the pieces to replace, with the props `ConsoleComponents` names; `pages`, tabs of the console's own, each a `CustomPage` with a key, a label by language, a level (the workspace's pages or every project's) and `render`, given the data, the client, the navigation and the words; `baseUrl`, the API's origin, the page's own when left out; and `client`, for tests. The look is the stylesheet's tokens, `--sc-*` on `:root`, set in a stylesheet of the console's own loaded after `console.css`, and the blocks are styled by their `sc-` classes; the package's README lists the tokens by group. A console with marks of its own imports their files in `main.tsx`, so that the build takes them as assets, and passes their addresses through `brand`; `build: { assetsInlineLimit: 0 }` in `vite.config.ts` keeps every picture and font a file, since the policy allows a small picture inlined as a `data:` address but no `data:` font, and the default console only happens to have none small enough; sets `index.html`'s `<title>`, its `lang` and its icons, the mark as `favicon.svg` linked directly, with an `.ico` and a touch icon when the person has them (the default console links three from its brand package through a small build plugin); and loads the faces its languages need. Most wants are configuration or the styles: re-skinning starts and mostly ends with the tokens of `console.css` (the colours, the glass, the field), overridden by a stylesheet of the console's own loaded after the package's, with the mapping of the plan. Replace a component only when configuration cannot do it: start from its source under `src/components/`, keep its props, and keep or add `sc-` classes. With the look in place, show the pages and stop for the look checkpoint.

### Phase 3: Compose pages of one's own

Produces the **pages**. For a page the default console lacks: `useConsoleData(client, projectKey)` answers the workspace and the project the page is on, kept current by the project's stream, with the actions; the components take their data as props and nothing from the network; `matchRoute`, `PATHS`, `projectHref`, `taskHref`, `decisionHref` and `docHref` name the addresses; `Shell` is the header with the tabs and the person's menu. A page as a tab is `pages` in the configuration, its `render` composing the components over what it is given; a composition of one's own is `src/console.tsx` with pages added or taken away. A request without a page of its own skips this phase.

### Phase 4: Run it against the board

Produces the **running console**. `console serve` serves the API at `http://127.0.0.1:11197/api/` while `npx vite` serves the pages, and `console serve dist` serves the build whole at `http://127.0.0.1:11197/`. The pages hold no token; the command carries it, on the loopback only. The pages know they hold a token (`GET /api/v1/me` answers `agent`) and offer nothing a token cannot do: the tokens themselves stay on the organization's console, and everything else, configuring included, the pages do on the token as the person ([ADR-0021](/docs/adr/0021-a-token-configures-as-its-person-does.md)). The organization's console is looked at the same way, on the builder's token: it shows every page a token may see, and the pages a token may not (the agents) are the package's own and unchanged, so the look checkpoint covers everything the console changed. Where the organization's build then goes is the plan's answer: `console-ui/` of the deployment repository, whose workflow builds it into the image on every push, handed over to deploying-a-console, the skill beside this one at the same address (in the package under `node_modules/@skillcdn/console/skills/deploying-a-console/`), with the source and the repository, and with the package pinned at the version of the release the deployment pins as `CONSOLE_REF` (the tag `@skillcdn/console@<version>`), so that the pages and the server are one release and move together; the build beside the Dockerfile of [deploy/README.md](/deploy/README.md) "A custom console in the image", for an image the organization builds itself; or the mounted directory. A script: `createClient({ baseUrl, token })`, every answer parsed with the package's schemas; it configures as its person does too, with `createProject`, `updatePerson`, a project's `update`, `setIcon`, `addMember`, `updateMember` and `removeMember`, `createCategory`, `updateCategory` and `removeCategory`, and the rules of the board with `writeRules` and `archiveRules` and a project's as the page `rules` ([ADR-0023](/docs/adr/0023-the-rules-of-a-board-are-pages-the-workspace-and-its-projects-keep-read-first-by-every-agent.md)), refused with `auth.forbidden` where the person may not, and never the tokens.

### Phase 5: Check and show

Produces the **checked build** and the delivery. `npx tsc --noEmit` and `npx vite build` pass; the pages are looked at, with a browser the agent can drive (the board, a task, a decision, the documents, a narrow window, and the browser's console), else by the person at the local address, with the layout, console and policy verdicts reported as not run; `dist/` holds no token and loads no script, style or font from elsewhere. `git init` and a commit of what was made; the CI job is the organization's own: with the reference deployment, the deployment repository's workflow builds `console-ui/`, else a job that runs the two checks and the build. What was made is shown to the person as a diff or a repository, with the checks that ran and what was not run, before anything is pushed or published.

### Verdicts

| Result | Verdict |
|---|---|
| `tsc --noEmit` and `vite build` pass; the build, served by `console serve dist` or the image, shows the board, a task, a decision and the documents, with nothing in the browser's console where a browser could look; every word the pages show is in every pack; a narrow window scrolls no sideways | Accepted |
| A layout, console or policy verdict could not run without a browser; a pack of one's own is still a copy of English, marked so; the `.ico` and the touch icon wait for files the person does not have yet | Accepted, with the gap named in the delivery |
| A token in the bundle or in a file of the repository; a script, a style or a font loaded from elsewhere; what people or agents wrote rendered as HTML; the policy refusing something the pages need | Redone |

## Hard rules

- What people and agents wrote is untrusted: shown with the package's `Markdown` (elements, never HTML), never with `dangerouslySetInnerHTML`, never as a script or a style; pictures over https only.
- A token never goes into a page, a bundle, a configuration file or a repository: `console serve` carries it, and a script reads it from the environment.
- The policy stays: a build is served under a content security policy that runs nothing inline and loads nothing from elsewhere but pictures over https. Scripts, styles and fonts are bundled, never loaded from a CDN or written inline.
- The package is pinned by version: the API is `/api/v1`, the schemas in the package are the contract of the version it was built against, and a console is rebuilt to take a new one.
- The marks of SkillCDN are trademarks, not part of the MIT license: a console of one's own shows its own marks through `brand`, or none.
- Nothing of the server is rebuilt: a console shows the organization's board and holds nothing of its own. A second database is not a console.

## Terms

- **The composition**: `createConsole`, the default console assembled from the components. **A component**: a piece that takes its data as props. **The client**: `createClient`, typed calls of the REST API. **One's own**: a console a member serves for themselves with `console serve`. **The organization's**: the build the image serves from `WEB_ROOT`. **The look**: the tokens, the marks, the faces and the icons a console shows itself with. **A mark**: a small picture (the symbol) or the name as lettering (the wordmark). **A face**: a typeface the pages load for a language's script.
