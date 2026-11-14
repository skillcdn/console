import { createServer as createListener } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer, normalizePath, type Plugin } from "vite";
import { FIXTURE_PATH } from "./browser-console.js";
import { oneOriginRedirect } from "./preview-plugins.js";

// Test support: the pages served from their sources in front of a console on this machine
// (`pnpm dev`). Vite's development server answers at the one address a browser opens, with the
// package read from its sources and the pages changing as those do, and sends what the console
// answers itself, the API with the event stream and the plugins' frames, signing in, the probes
// and the fixture's sign-in, on to the console listening behind it, which knows that address as
// its own (`pagesAt`). The web app's own configuration stays what a custom console copies: what
// is of this repository alone, the package's sources beside the app, is said here. Not compiled.

/** The web app's configuration: the page and its plugins. */
const WEB_CONFIG = fileURLToPath(new URL("../../web/vite.config.ts", import.meta.url));

/** The package's sources, which the pages are read from in place of what the package built. */
const PACKAGE_SOURCE = normalizePath(
  fileURLToPath(new URL("../../../../packages/console/src", import.meta.url)),
);

/**
 * What the console answers itself, by how the path begins: the API with the plugins' frames and
 * the event stream, signing in, the probes, and the fixture's sign-in. Every other path is a
 * page, which routes in the browser. The first four are the ones the web app's configuration
 * sends to an `api` role, named as it names them so that these take their place.
 */
export const CONSOLE_PATHS: readonly string[] = [
  "/api",
  "/auth",
  "/healthz",
  "/readyz",
  FIXTURE_PATH,
];

export interface LivePagesOptions {
  /** The port a browser opens, on the loopback. */
  readonly port: number;
  /** Where the console behind it listens: `http://127.0.0.1:<port>`. */
  readonly console: string;
}

export interface LivePages {
  /** The one address of the pages and of the console behind them. */
  readonly origin: string;
  /** Stops serving the pages; the console behind them is ended by whoever started it. */
  close(): Promise<void>;
}

/** A browser that came by another of the machine's names goes on at the one origin. */
const oneOrigin = (origin: string): Plugin => ({
  name: "console:one-origin",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const there = oneOriginRedirect(request.headers.host, origin, request.url ?? "/");
      if (there === undefined) {
        next();
        return;
      }
      response.writeHead(307, { location: there, "cache-control": "no-store" });
      response.end();
    });
  },
});

/**
 * Starts the pages at `http://127.0.0.1:<port>`. Vite runs as the middleware of a listener made
 * here, not as a server of its own: one of its own ends the whole process when its input ends,
 * as the input of a process started in the background does at once, and the console's database
 * would then be left behind.
 */
export async function startLivePages(options: LivePagesOptions): Promise<LivePages> {
  const origin = `http://127.0.0.1:${options.port}`;
  const listener = createListener();
  const vite = await createServer({
    configFile: WEB_CONFIG,
    clearScreen: false,
    logLevel: "warn",
    plugins: [oneOrigin(origin)],
    // The package from its sources, so that a component or a rule of the stylesheet changed
    // there shows in the page at once; a build reads what the package built, as whoever
    // installs it does.
    resolve: {
      alias: [
        { find: /^@skillcdn\/console$/, replacement: `${PACKAGE_SOURCE}/index.ts` },
        {
          find: /^@skillcdn\/console\/console\.css$/,
          replacement: `${PACKAGE_SOURCE}/styles/console.css`,
        },
      ],
      // The package's sources name React from the package's own folder: one copy still.
      dedupe: ["react", "react-dom"],
    },
    server: {
      middlewareMode: { server: listener },
      // The reloading speaks over the same listener: one port, one origin.
      ws: { server: listener },
      // The host the browser named stays on the request: the console answers as that origin.
      proxy: Object.fromEntries(
        CONSOLE_PATHS.map((prefix) => [prefix, { target: options.console, changeOrigin: false }]),
      ),
    },
  });
  listener.on("request", vite.middlewares);
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(options.port, "127.0.0.1", () => {
        listener.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await vite.close().catch(() => undefined);
    throw new Error(`the pages could not be served at ${origin}`, { cause: error });
  }
  return {
    origin,
    async close() {
      await vite.close();
      // The event stream and the reloading keep their connections open: ended here.
      listener.closeAllConnections();
      await new Promise<void>((resolve) => {
        listener.close(() => resolve());
      });
    },
  };
}
