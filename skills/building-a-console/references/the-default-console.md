# The default console, as it is wired

The four files of the default UI, `apps/console/web/` in the console's repository, quoted here so that an agent that has the skill and not the repository starts from the same shape: the page with its root, the script that composes the console with the brand's marks and the Korean face, the build that links the icons from the brand's package and sends the API to a running server, and the compiler's settings. The repository's check keeps them identical to the files; the package's sources under `src/` say what each import is.

### `apps/console/web/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Console</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `apps/console/web/src/main.tsx`

```tsx
// The marks of the brand come from the main repository's package, never from a copy here
// (ADR-0013); the build gives back their addresses. The pages are dark, so the wordmark is white.
import symbol from "@skillcdn/brand/symbol.svg";
import wordmark from "@skillcdn/brand/wordmark-white.svg";
import { createConsole } from "@skillcdn/console";
// The styles ship with the package; the build bundles them next to the script.
import "@skillcdn/console/console.css";
// The Korean face of SkillCDN's own pages, Pretendard, in the subsets a browser fetches as it
// needs them; the package's stylesheet names it first and falls through to the system's faces.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

// The default UI the image serves: the package's composition, with the default configuration
// (docs/architecture.md, "The package and custom consoles"). A custom console is this file,
// with a configuration of its own, in a repository of its own.

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the page has no #root element");
}
createConsole({ brand: { symbol, wordmark } }).mount(container);
```

### `apps/console/web/vite.config.ts`

```ts
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Where the `api` role listens by default; what the development server sends the API to. */
const API_URL = "http://127.0.0.1:11199";

const here = fileURLToPath(new URL(".", import.meta.url));
const resolve = createRequire(import.meta.url).resolve;

/** A file of the brand package as an address relative to the page, which the build takes as an asset. */
function brandFile(name: string): string {
  return path
    .relative(here, resolve(`@skillcdn/brand/${name}`))
    .split(path.sep)
    .join("/");
}

// The page's icons come from `@skillcdn/brand`, as the symbol and the wordmark do in main.tsx
// (ADR-0013): linked here, before the build reads the page, so that it bundles them next to the
// script like any other asset and never copies them into this repository.
const icons: Plugin = {
  name: "console:icons",
  transformIndexHtml: {
    order: "pre",
    handler: () => [
      {
        tag: "link",
        attrs: { rel: "icon", href: brandFile("favicon.ico"), sizes: "32x32" },
        injectTo: "head",
      },
      {
        tag: "link",
        attrs: { rel: "icon", href: brandFile("favicon.svg"), type: "image/svg+xml" },
        injectTo: "head",
      },
      {
        tag: "link",
        attrs: { rel: "apple-touch-icon", href: brandFile("apple-touch-icon.png") },
        injectTo: "head",
      },
    ],
  },
};

// `vite build` writes the default UI into web/dist, which the `api` role serves from WEB_ROOT.
// `vite` serves the UI with its own reloading and sends everything else to a running `api`.
export default defineConfig({
  root: here,
  plugins: [react(), icons],
  publicDir: false,
  server: {
    // Next to the api role's 11199, so that every local port of the project is one block.
    port: 11198,
    proxy: {
      "/api": { target: API_URL, changeOrigin: false },
      "/auth": { target: API_URL, changeOrigin: false },
      "/healthz": { target: API_URL, changeOrigin: false },
      "/readyz": { target: API_URL, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
```

### `apps/console/web/tsconfig.json`

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "vite.config.ts"],
  "references": [{ "path": "../../../packages/console/tsconfig.build.json" }]
}
```

What a console of one's own changes. In the page: its `<title>` and `lang`, and its icons, linked directly in the page or through the plugin, for its own. In the script: the `title` it passes; the two `@skillcdn/brand` imports, for its own symbol and wordmark (a light one, since the pages are dark), or none; the face it loads, for its languages (`npm install pretendard` for Korean). In the build: the proxy's target, `http://127.0.0.1:11197` with `changeOrigin: true` for `console serve`; the default console's own proxy points at the `api` role's development port, which a console of one's own does not have, and its plugin reads the icons from the brand package, which a console of one's own replaces with files of its own. In the compiler's settings: `jsx`, `moduleResolution` and the `vite/client` types stay, which make an imported picture a module; `extends` and `references` are the repository's and go, with `"strict": true` of the console's own in their place.
