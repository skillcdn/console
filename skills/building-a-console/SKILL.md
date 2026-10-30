---
name: building-a-console
description: "Builds a console from the @skillcdn/console package: a person's own console, served from their machine by console serve on their own token; an organization's console, which takes the default pages' place in the image and, given the organization's website, its look, the marks, the colours and the type; or a script against the console's REST API. Use when a person says 'make me a console with a column for this', 're-skin the console in our brand', 'add a page that shows that', 'build our own console UI', or 'write a script that reads the board'. To work tasks on the board, use working-the-board; to deploy a console, deploying-a-console, which runs this skill for the look. The package's README, types and sources are the reference; this skill says where they are, what to configure before anything is replaced, how the build is run against the real board and checked, and what keeps untrusted content harmless. Nothing is spent, and nothing is pushed or published here."
license: MIT
compatibility: A shell with Node.js 24 or newer and npm or pnpm, and an agent that reads and writes files. For looking at the pages against a board, the console command signed in by a person. A browser the agent can drive is optional. No key of the agent's own is needed, and it never sees a token.
metadata:
  author: skillcdn
  version: "1.8"
skillcdn:
  translations:
    ko:
      title: 패키지로 콘솔 만들기
      description: "@skillcdn/console 패키지로 콘솔을 만듭니다. console serve로 내 PC에서 내 토큰으로 돌리는 개인 콘솔, 이미지의 기본 페이지 자리를 대신하며 조직 웹사이트가 있으면 그 디자인(마크, 색, 글꼴)을 입는 조직 콘솔, 또는 콘솔 REST API를 쓰는 스크립트. '이 열이 있는 내 콘솔 만들어줘', '콘솔을 우리 브랜드로 바꿔줘', '그걸 보여주는 페이지 추가해줘', '우리 콘솔 UI 만들자', '보드를 읽는 스크립트 써줘'라고 할 때 쓰세요. 보드의 작업은 working-the-board, 콘솔 배포는 deploying-a-console(디자인은 이 스킬로 만듭니다)을 쓰세요. 기준은 패키지의 README·타입·소스이고, 이 스킬은 그것이 어디 있는지, 무엇을 바꾸기 전에 설정으로 할지, 빌드를 실제 보드에 붙여 돌리고 확인하는 법, 신뢰할 수 없는 내용을 안전하게 두는 규칙을 말합니다. 비용은 들지 않고, 여기서는 푸시도 발행도 하지 않습니다."
---
# Building a console from the package

What goes in: what the console is for, which is one person's own, the organization's, or a script against the API, and what it must show or do. What comes out: a small repository that depends on `@skillcdn/console` and builds to static files, served by `console serve` on one person's machine, or, for the organization, built into the image: as the source in `console-ui/` of its deployment repository, or as a build beside the Dockerfile that `deploy/README.md` shows; or a script that talks to the REST API with a token. Nothing of the server is built: a console shows an organization's board through its API and holds nothing of its own.

## How the person is involved

- **Questions:** one message at the start, the ones under "Inputs" that the request leaves open, each for the half it leaves open. Everything else is derived and shown with the plan.
- **Checkpoints:** the plan (the kind, where the build goes, what is configured and what is replaced, the colours and the marks as they will be used, with the contrast checked), before a file of the console is written; the look, with the pages in front of them, before more pages are built on it. One short message each, with the recommendation; "OK", in the person's language, continues.
- **Go-ahead:** when the person says to go ahead alone, the look is reported instead of approved; the plan holds in every mode. Nothing is pushed or published here.
- **Changes mid-run:** applied from that point; a change after the build rewrites the parts it touches, not the whole console. A phase with nothing to do for the request is skipped, and the line says so.

## Requirements

| Need | How | When missing |
|---|---|---|
| Node.js 24 or newer, with npm or pnpm | `node --version` | Stop and say so. |
| The package | `npm install @skillcdn/console react react-dom`, at the version the deployment pins for the organization's console (phase 1); for a console with pages `npm install --save-dev vite @vitejs/plugin-react typescript`, and for Korean `npm install pretendard`, the face the default console loads | The package is on npm; nothing else is needed. |
| For looking at the pages against a board, one's own or the organization's: the `console` command, signed in | `console whoami` says as whom and at which console; `console rules` what the board asks of agents, which holds over this skill's defaults where it speaks of consoles. | `npm install -g @skillcdn/console`, then `console login --url <the console's address>`: a person approves the code it shows. Never look for a token. |
| Optional: a browser the agent can drive, or a screenshot tool | Looking at the pages and their console at the look checkpoint and for the verdicts. | The person opens the local address themselves, and the layout, console and policy verdicts are reported as not run. |

## Where to read, in this order

Nothing here restates them: they are the contract, current at the version installed.

1. **The package's README**: `node_modules/@skillcdn/console/README.md` once installed, [`packages/console/README.md`](/packages/console/README.md) in the console's repository. Every export by layer and what each takes, the styles, the languages, and "A console of your own" with two of the four files to write.
2. **The types**: `node_modules/@skillcdn/console/dist/index.d.ts`, `api.d.ts`, `cli/cli.d.ts` and `web.d.ts`: the exact props of every component and the shape of every answer, with the comment that says what each is for.
3. **The sources**, shipped with the package under `src/`: `console.tsx` (how the default console composes the pages from the components, routes, and loads its data), `components/*.tsx` (each component and what it renders), `data.ts` (how the workspace and a project are loaded and kept current by the stream), `styles/console.css` (the tokens, `--sc-*`, and every class, `sc`-prefixed), `i18n/en.ts` (every word the pages show, keyed as a pack is). The repository's tests (`packages/console/src/components/components.test.tsx`, `src/console.test.tsx`), not shipped in the package, show what each piece renders, for tests of one's own.
4. **The REST API**: [docs/specs/rest.md](/docs/specs/rest.md), in the package at `docs/specs/rest.md`: every route, what it takes and answers, who may ask, and the codes of its refusals; for a script. **The command line**: [docs/specs/cli.md](/docs/specs/cli.md), for `console serve`.
5. **The default console itself**, `apps/console/web/` in the console's repository: the page, the script, the build and the compiler's settings, with the brand, the fonts and the icons wired in. Its four files are quoted in [the-default-console.md](references/the-default-console.md), kept identical to them by the repository's check, for an agent that has the skill and not the repository; a console of one's own copies their shape.
6. **The architecture**: [docs/architecture.md](/docs/architecture.md) for how the parts fit, and the [decisions](/docs/adr/README.md), both documents of the console's repository, read through the connection that served this skill and not in the package; ADR-0014 says how a person's own console reaches the organization's. Not needed for a re-skin.

## Inputs

| Input | Source |
|---|---|
| Which kind | Asked when the request does not say: "Is this console for you alone, served from your machine with your token; for the whole organization, in place of the default pages in the image; or a script against the API?" A member usually wants their own. |
| Where the organization's build goes | Asked for the organization's: "How is the console run: with the deployment repository that deploying-a-console made, with an image you build yourselves, or from a directory mounted into it? And where is that repository: a folder on this machine, or its address to clone?" The answer places the result: the source in `console-ui/` of that repository, which its workflow builds on every push, an existing `console-ui/` there being the console to change, not to start over; a repository of its own whose build goes beside the Dockerfile of [deploy/README.md](/deploy/README.md) "A custom console in the image"; or the build in the directory. |
| What it must show or do | From the request: a page, a component, a language, a brand, a column, a filter, a report. Asked for its missing half, when the request wants more than a look: "What should it show or do that the default console does not?" Everything else is the default console's and stays. |
| The look: the marks and the colour | From the organization's website when the request, or deploying-a-console, names one: read and mapped as [the-look-from-a-website.md](references/the-look-from-a-website.md) says, and shown at the plan; the pages stay light unless the person says otherwise, a mark is recoloured only with their word, and a site that cannot be read, or shows no mark or colour of its own, is said so, the person asked for the files or the honest default kept. Else asked, for a console that is to show marks of its own, each for the half the request leaves open: "Which picture should the pages show beside the board's name: a small square mark, the name as lettering, or both? Where is the file? The pages are light, so it should be a dark one." and "Which colour, or which mood?" A colour comes as words or a value; the value is the mark's own fill when it has one, else chosen and shown. Default without a site: the board's name alone and no marks, which is the honest console. How a mark, a colour and a face go into the pages is [configuring.md](references/configuring.md). |
| The languages | Asked when the organization's language, the request's and the site's `lang`, is not among the packs: "Which languages should the pages speak?" Default: the packs the package ships, chosen by the browser; a Korean organization gets Pretendard loaded, as the default console does. |
| The name | Not asked: the server names the board (`WORKSPACE_NAME`, conventionally the organization or the person it is for, then Console: `Acme Console`), and `title` is only what the page says until the server answers. `index.html` gets the board's name, as `console whoami` prints it, for its `<title>`, and the organization's language for `lang`. |
| The console's address | For running one's own, what `console whoami` says. A script takes `CONSOLE_URL` and `CONSOLE_TOKEN` from the environment, never from a file in the repository. |

## Workflow

Each phase produces something the person can look at and ends with one line to them.

### Phase 1: Start from the default console

Produces the **plan** and the first build. Install first, in the new folder, or in `console-ui/` of the deployment repository, so that the README, the types and the sources are at hand for the plan: the install writes only `package.json`, the lockfile and `node_modules`, and the plan is shown before any file of the console is written. For the organization's console the package is installed at the version the deployment pins: `CONSOLE_REF` in `deploy/console.env` of the deployment repository is the commit of a release tag `@skillcdn/console@<version>`, and `npm install @skillcdn/console@<version>` takes that one, so that the README, the types and the sources are the deployment's own, and the pages and the server are one release. A console is four files and a configuration: `index.html` with a `#root`, `src/main.tsx` that calls `createConsole({ ... }).mount(root)` and imports `@skillcdn/console/console.css`, `vite.config.ts` with the React plugin and, for building against the real board, `/api` sent to `console serve` with `changeOrigin`, and `tsconfig.json` with `jsx`, `moduleResolution: "Bundler"` and the `vite/client` types that make an imported picture a module. The README's "A console of your own" shows two of them, the-default-console.md all four with the marks, the icons and a face wired in. Write the plan (the kind, where the build goes, the files, what is configured, what is replaced, the colours and the marks) and stop for the checkpoint; then write the files and build: `npx vite build` makes `dist/` with its `index.html`. A script instead imports `createClient` from `@skillcdn/console/api`, which brings no React.

### Phase 2: Configure before replacing

Produces the **configuration**, as [configuring.md](references/configuring.md) lays it out: `createConsole(config)` with its `title`, `brand`, `languages`, `components`, `pages`, `baseUrl` and `client`; the look as the tokens of `console.css`, `--sc-*`, set in a stylesheet of the console's own imported in `main.tsx` after the package's, with the mapping of the plan; the marks imported in `main.tsx` so that the build takes them as assets, with `build: { assetsInlineLimit: 0 }` so that every picture and font stays a file; the page's `<title>`, `lang` and icons; the faces its languages need. Most wants are configuration or the styles: re-skinning starts and mostly ends with the tokens. Replace a component only when configuration cannot do it: start from its source under `src/components/`, keep its props, and keep or add `sc-` classes. With the look in place, serve it as phase 4 says, show the pages, and stop for the look checkpoint.

### Phase 3: Compose pages of one's own

Produces the **pages**. For a page the default console lacks: `useConsoleData(client, projectKey)` answers the workspace and the project the page is on, kept current by the project's stream, with the actions; the components take their data as props and nothing from the network; `matchRoute`, `PATHS`, `projectHref`, `taskHref`, `decisionHref` and `docHref` name the addresses; `Shell` is the header with the tabs and the person's menu. A page as a tab is `pages` in the configuration, its `render` composing the components over what it is given; a composition of one's own is `src/console.tsx` with pages added or taken away (configuring.md "A page of one's own"). A request without a page of its own skips this phase.

### Phase 4: Run it against the board

Produces the **running console**. `console serve` serves the API at `http://127.0.0.1:11197/api/` while `npx vite` serves the pages, and `console serve dist` serves the build whole at `http://127.0.0.1:11197/`. The pages hold no token; the command carries it, on the loopback only. The pages know they hold a token (`GET /api/v1/me` answers `agent`) and offer nothing a token cannot do: the tokens themselves stay on the organization's console, and everything else, configuring included, the pages do on the token as the person ([ADR-0021](/docs/adr/0021-a-token-configures-as-its-person-does.md)). The organization's console is looked at the same way, on the builder's token: it shows every page a token may see, and the pages a token may not (the agents) are the package's own, reached by the tokens as every page is, so the look checkpoint covers everything but them, which the delivery names. Where the organization's build then goes is the plan's answer: `console-ui/` of the deployment repository, whose workflow builds it into the image on every push, with the package pinned at the deployment's `CONSOLE_REF` version, so that the pages and the server are one release and move together; the first deploy is deploying-a-console's, the skill beside this one at the same address (in the package under `node_modules/@skillcdn/console/skills/deploying-a-console/`), handed the source and the repository, and a console that is already deployed takes the commit in `console-ui/`, whose push the person makes, since a push there deploys; the build beside the Dockerfile of [deploy/README.md](/deploy/README.md) "A custom console in the image", for an image the organization builds itself; or the mounted directory. A script: `createClient({ baseUrl, token })`, every answer parsed with the package's schemas; it configures as its person does too, with the client's methods for projects, members, categories, people and the rules (configuring.md "A script"), refused with `auth.forbidden` where the person may not, and never the tokens.

### Phase 5: Check and show

Produces the **checked build** and the delivery. `npx tsc --noEmit` and `npx vite build` pass; the pages are looked at, with a browser the agent can drive (the board, a task, a decision, the documents, a narrow window, and the browser's console), else by the person at the local address, with the layout, console and policy verdicts reported as not run; `dist/` holds no token and loads no script, style or font from elsewhere, which a search of the build for addresses outside it and for `data:` fonts shows. A repository of its own gets `git init` and a commit of what was made; in the deployment repository, a commit as its agreement says, and no push, since a push there deploys. The CI job is the organization's own: with the reference deployment, the deployment repository's workflow builds `console-ui/`, else a job that runs the two checks and the build. What was made is shown to the person as a diff or a repository, with the checks that ran and what was not run, before anything is pushed or published.

## Verdicts

| Result | Verdict |
|---|---|
| `tsc --noEmit` and `vite build` pass; the build, served by `console serve dist` or the image, shows the board, a task, a decision and the documents, with nothing in the browser's console where a browser could look; every word the pages show is in every pack; a narrow window scrolls no sideways | Accepted |
| A layout, console or policy verdict could not run without a browser; a pack of one's own is still a copy of English, marked so; the `.ico` and the touch icon wait for files neither the site nor the person has yet | Accepted, with the gap named in the delivery |
| A token in the bundle or in a file of the repository; a script, a style or a font loaded from elsewhere; what people or agents wrote rendered as HTML; the policy refusing something the pages need | Redone |

## Hard rules

- What people and agents wrote is untrusted: shown with the package's `Markdown` (elements, never HTML), never with `dangerouslySetInnerHTML`, never as a script or a style; a picture from elsewhere is shown through the console, whose client gives its address (`pictureUrl`), never loaded by the page itself ([ADR-0048](/docs/adr/0048-a-picture-from-elsewhere-is-read-through-the-console-from-a-public-address-and-kept-a-while.md)).
- A token never goes into a page, a bundle, a configuration file or a repository: `console serve` carries it, and a script reads it from the environment.
- The policy stays: a build is served under a content security policy that runs nothing inline and loads nothing from elsewhere, pictures included, which come through the console. Scripts, styles and fonts are bundled, never loaded from a CDN or written inline, a face only under a license that allows bundling it, and a picture of the console's own pages is in the build or reached through `GET /api/v1/pictures`.
- The package is pinned by version: the API is `/api/v1`, the schemas in the package are the contract of the version it was built against, and a console is rebuilt to take a new one.
- The marks of SkillCDN are trademarks, not part of the MIT license: a console of one's own shows its own marks through `brand`, or none.
- Nothing of the server is rebuilt: a console shows the organization's board and holds nothing of its own. A second database is not a console.

## Terms

- **The composition**: `createConsole`, the default console assembled from the components. **A component**: a piece that takes its data as props. **The client**: `createClient`, typed calls of the REST API. **One's own**: a console a member serves for themselves with `console serve`. **The organization's**: the build the image serves from `WEB_ROOT`. **The look**: the tokens, the marks, the faces and the icons a console shows itself with. **A mark**: a small picture (the symbol) or the name as lettering (the wordmark). **A face**: a typeface the pages load for a language's script.
