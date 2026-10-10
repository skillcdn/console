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
