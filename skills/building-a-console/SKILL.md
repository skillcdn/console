---
name: building-a-console
description: "Builds a console from the @skillcdn/console package: a console of a person's own, served from their machine with their token by console serve; an organization's console, which takes the default UI's place in the image; or a script against the console's REST API. Says where the package's layers are (the API client and schemas, the components, the composition), how the default console is put together, what to configure and what to replace (a component, the language packs, the brand, the styles' tokens), how a build is run against the board and checked, and the rules that keep untrusted content harmless. Use when an agent is asked to make, change or extend a SkillCDN Console UI or a client of its API. To work tasks on the board, use working-the-board."
license: MIT
compatibility: A shell with Node.js 24 or newer and npm or pnpm, and an agent that reads and writes files. For running a console of one's own, the console command signed in by a person. No key of the agent's own is needed, and it never sees a token.
metadata:
  author: skillcdn
  version: "1.0"
skillcdn:
  translations:
    ko:
      title: 패키지로 콘솔 만들기
      description: "@skillcdn/console 패키지로 콘솔을 만듭니다. console serve로 내 PC에서 내 토큰으로 돌리는 개인 콘솔, 이미지에서 기본 UI 자리를 대신하는 조직 콘솔, 또는 콘솔 REST API를 쓰는 스크립트. 패키지의 세 계층(API 클라이언트와 스키마, 컴포넌트, 구성)이 어디 있는지, 기본 콘솔이 어떻게 조립되는지, 무엇을 설정하고 무엇을 바꾸는지(컴포넌트, 언어 팩, 브랜드, 스타일 토큰), 빌드를 보드에 붙여 돌리고 확인하는 법, 신뢰할 수 없는 내용을 안전하게 다루는 규칙을 말합니다. SkillCDN 콘솔 UI나 API 클라이언트를 만들거나 바꾸라고 할 때 쓰세요. 보드의 작업을 할 때는 working-the-board를 쓰세요."
---
# Building a console from the package

What goes in: what the console is for, which is one person's own, the organization's, or a script against the API, and what it must show or do. What comes out: a small repository that depends on `@skillcdn/console` and builds to static files, served by `console serve` on one person's machine or by the image in the default UI's place; or a script that talks to the REST API with a token. Nothing of the server is built: a console shows an organization's board through its API and holds nothing of its own.

## Requirements

| Need | How | When missing |
|---|---|---|
| Node.js 24 or newer, with npm or pnpm | `node --version` | Stop and say so. |
| The package | `npm install @skillcdn/console react react-dom`, and for pages `npm install --save-dev vite @vitejs/plugin-react typescript` | The package is on npm; nothing else is needed. |
| For running one's own: the `console` command, signed in | `console whoami` says as whom and at which console. | `npm install -g @skillcdn/console`, then `console login --url <the console's address>`: a person approves the code it shows. Never look for a token. |

## Where to read, in this order

Nothing here restates them: they are the contract, current at the version installed.

1. **The package's README**: `node_modules/@skillcdn/console/README.md` once installed, [`packages/console/README.md`](/packages/console/README.md) in the console's repository. Every export by layer and what each takes, the styles, the languages, and "A console of your own" with the three files to write.
2. **The types**: `node_modules/@skillcdn/console/dist/index.d.ts`, `api.d.ts`, `cli/cli.d.ts` and `web.d.ts`: the exact props of every component and the shape of every answer, with the comment that says what each is for.
3. **The sources**, shipped with the package under `src/`: `console.tsx` (how the default console composes the pages from the components, routes, and loads its data), `components/*.tsx` (each component and what it renders), `data.ts` (how the workspace and a project are loaded and kept current by the stream), `styles/console.css` (the tokens, `--sc-*`, and every class, `sc-`-prefixed), `i18n/en.ts` (every word the pages show, keyed as a pack is).
4. **The REST API**: [docs/specs/rest.md](/docs/specs/rest.md), in the package at `docs/specs/rest.md`: every route, what it takes and answers, who may ask, and the codes of its refusals. **The command line**: [docs/specs/cli.md](/docs/specs/cli.md).
5. **The default console itself**, in the console's repository under `apps/console/web/`: `index.html`, `src/main.tsx` and `vite.config.ts`, with the brand, the fonts and the icons wired in; a console of one's own copies their shape.
6. **The architecture**: [docs/architecture.md](/docs/architecture.md) for how the parts fit, and the [decisions](/docs/adr/README.md); ADR-0014 says how a person's own console reaches the organization's.

## Inputs

| Input | Source |
|---|---|
| Which kind | One person's own, served by `console serve` with their token; the organization's, built into the image at `WEB_ROOT`; or a script, from the API client alone. Asked once when the request does not say; a member usually wants their own. |
| What it must show or do | From the request: a page, a component, a language, a brand, a column, a filter, a report. Everything else is the default console's and stays. |
| The console's address | For running one's own, what `console whoami` says. A script takes `CONSOLE_URL` and `CONSOLE_TOKEN` from the environment, never from a file in the repository. |

## Workflow

### Phase 1: Start from the default console

A console is three files and a configuration: `index.html` with a `#root`, `src/main.tsx` that calls `createConsole({ ... }).mount(root)` and imports `@skillcdn/console/console.css`, and `vite.config.ts` with the React plugin and, for building against the real board, `/api` sent to `console serve` with `changeOrigin`. The README's "A console of your own" has all three. Install, write them, and build: `npx vite build` makes `dist/` with its `index.html`. A script instead imports `createClient` from `@skillcdn/console/api`, which brings no React.

### Phase 2: Configure before replacing

`createConsole(config)` takes `title`; `brand`, the addresses of a symbol and a wordmark; `languages`, the packs the pages speak, where a language of one's own is `src/i18n/en.ts` copied whole and translated; `components`, the pieces to replace, with the props `ConsoleComponents` names; `baseUrl`, the API's origin, the page's own when left out; and `client`, for tests. Most wants are configuration or the styles: re-skinning starts and mostly ends with the tokens of `console.css` (the colours, the glass, the field), overridden by a stylesheet of the console's own loaded after the package's. Replace a component only when configuration cannot do it: start from its source under `src/components/`, keep its props, and keep or add `sc-` classes.

### Phase 3: Compose pages of one's own

For a page the default console lacks: `useConsoleData(client, projectKey)` answers the workspace and the project the page is on, kept current by the project's stream, with the actions; the components take their data as props and nothing from the network; `matchRoute`, `PATHS`, `projectHref`, `taskHref`, `decisionHref` and `docHref` name the addresses; `Shell` is the header with the tabs and the person's menu. A composition of one's own is `src/console.tsx` with pages added or taken away.

### Phase 4: Run it against the board

One's own: `console serve` serves the API at `http://127.0.0.1:11197/api/` while `npx vite` serves the pages, and `console serve dist` serves the build whole at `http://127.0.0.1:11197/`. The pages hold no token; the command carries it, on the loopback only. The pages know they hold a token (`GET /api/v1/me` answers `agent`) and offer nothing a token cannot do: the tokens themselves and configuring stay on the organization's console. The organization's: the build takes the default UI's place at `WEB_ROOT` in the image, as [deploy/README.md](/deploy/README.md) says under "A custom console in the image". A script: `createClient({ baseUrl, token })`, every answer parsed with the package's schemas.

### Phase 5: Check and show

`npx tsc --noEmit` and `npx vite build` pass, and the pages are read by eye: the board, a task, a decision, the documents, and a narrow window. The package's own tests, `src/components/components.test.tsx` and `src/console.test.tsx`, show what each piece renders, for tests of one's own. What was made is shown to the person as a diff or a repository, with the checks that ran, before anything is pushed or published.

## Hard rules

- What people and agents wrote is untrusted: shown with the package's `Markdown` (elements, never HTML), never with `dangerouslySetInnerHTML`, never as a script or a style; pictures over https only.
- A token never goes into a page, a bundle, a configuration file or a repository: `console serve` carries it, and a script reads it from the environment.
- The policy stays: a build is served under a content security policy that runs nothing inline and loads nothing from elsewhere but pictures over https. Scripts, styles and fonts are bundled, never loaded from a CDN or written inline.
- The package is pinned by version: the API is `/api/v1`, the schemas in the package are the contract of the version it was built against, and a console is rebuilt to take a new one.
- The marks of SkillCDN are trademarks, not part of the MIT license: a console of one's own shows its own marks through `brand`, or none.
- Nothing of the server is rebuilt: a console shows the organization's board and holds nothing of its own. A second database is not a console.

## Terms

- **The composition**: `createConsole`, the default console assembled from the components. **A component**: a piece that takes its data as props. **The client**: `createClient`, typed calls of the REST API. **One's own**: a console a member serves for themselves with `console serve`. **The organization's**: the build the image serves from `WEB_ROOT`.
