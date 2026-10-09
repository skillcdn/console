import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Where the `api` role listens by default; what the development server sends the API to. */
const API_URL = "http://127.0.0.1:11199";

// `vite build` writes the default UI into web/dist, which the `api` role serves from WEB_ROOT.
// `vite` serves the UI with its own reloading and sends everything else to a running `api`.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
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
