import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

// What `pnpm dev:plugins` and `pnpm dev` are told on the command line: the port, the built
// plugins of other checkouts to install beside the fixtures, each a directory laid out as the
// image lays a plugin out (its package.json, its console-plugin.json, its dist/), so that a
// plugin's pages are looked at here without a provider; the address the console is reached at
// from outside, through a tunnel, for a plugin that receives requests; whether the database is
// kept; and whether the pages are served from their sources, changing as those do (`pnpm dev`).
// And the one name a console on this machine answers by. Not compiled.

export interface PreviewArguments {
  /** `--port <n>`; none for the default. */
  readonly port: number | undefined;
  /** `--plugin <dir>`, as often as given, in order. */
  readonly pluginDirs: readonly string[];
  /** `--public-url <origin>`: an http or https origin the console is reached at from outside; none for the loopback. */
  readonly publicUrl: string | undefined;
  /** `--keep`: the database is kept when the console ends, and started from when it is there. */
  readonly keep: boolean;
  /** `--live`: the pages are served from their sources and change as those do (`pnpm dev`). */
  readonly live: boolean;
}

/** An origin as `--public-url` takes it: http or https, a host, nothing after it. */
function originGiven(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error(
      `--public-url takes an address such as https://preview.example.com, not ${String(value)}`,
    );
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      `--public-url takes an http or https origin and nothing after it, not ${value}`,
    );
  }
  return url.origin;
}

/**
 * The arguments as given, or an error saying what was not understood. A bare `--` is passed over:
 * pnpm hands the `--` of `pnpm dev:plugins -- --plugin <dir>` on to the script, since pnpm 12, so
 * it reaches here with the flags that followed it.
 */
export function parsePreviewArguments(argv: readonly string[]): PreviewArguments {
  let port: number | undefined;
  let publicUrl: string | undefined;
  let keep = false;
  let live = false;
  const pluginDirs: string[] = [];
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    const value = argv[at + 1];
    if (flag === "--") {
      continue;
    }
    if (flag === "--port") {
      const parsed = value === undefined ? Number.NaN : Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
        throw new Error(`--port takes a port number, not ${String(value)}`);
      }
      port = parsed;
      at += 1;
    } else if (flag === "--plugin") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--plugin takes the directory of a built plugin");
      }
      pluginDirs.push(value);
      at += 1;
    } else if (flag === "--public-url") {
      publicUrl = originGiven(value);
      at += 1;
    } else if (flag === "--keep") {
      keep = true;
    } else if (flag === "--live") {
      live = true;
    } else {
      throw new Error(
        `${String(flag)} is not understood: --port <n>, --plugin <dir>, --public-url <origin>, --keep, --live`,
      );
    }
  }
  if (live && publicUrl !== undefined) {
    // The pages' sources are served by a development server, which is for this machine alone.
    throw new Error(
      "--live serves the pages from their sources on this machine alone: not with --public-url, which pnpm dev:plugins takes",
    );
  }
  if (live && port === 0) {
    throw new Error("--live takes the port the pages are opened at, not 0");
  }
  return { port, pluginDirs, publicUrl, keep, live };
}

/** The names a browser on this machine reaches it by. */
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Where a request that reached a console on this machine by another of the machine's names is
 * sent: the same path at the console's one origin, or nowhere when it came by that origin
 * already. A console is one origin (`PUBLIC_URL`): the provider sends a browser back there, a
 * session's cookie belongs to that host, a write is taken from that origin alone, and a
 * plugin's frame is served for that origin to show (`frame-ancestors`), so under `localhost`,
 * which a tool opens a local server by unless told otherwise, nobody signs in and every frame
 * stays empty. A console reached from outside, through a tunnel, is left as it is: whoever
 * comes there comes by its public address.
 */
export function oneOriginRedirect(
  host: string | undefined,
  origin: string,
  path: string,
): string | undefined {
  const own = new URL(origin);
  if (!LOOPBACK_NAMES.has(own.hostname) || host === undefined) {
    return undefined;
  }
  let named: URL;
  try {
    named = new URL(`http://${host}`);
  } catch {
    return undefined;
  }
  if (!LOOPBACK_NAMES.has(named.hostname) || named.host === own.host) {
    return undefined;
  }
  // The origin first, so that whatever the path says, the answer names this console.
  return `${own.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

const kindOf = async (path: string): Promise<"file" | "directory" | undefined> => {
  const found = await stat(path).catch(() => undefined);
  return found === undefined ? undefined : found.isDirectory() ? "directory" : "file";
};

/**
 * A built plugin at `dir`, resolved from `cwd`: the name its package.json gives it, by which
 * the plugins directory lists it; or an error saying why it cannot be installed, so that a
 * wrong path or an unbuilt checkout stops the console before it starts.
 */
export async function builtPluginAt(
  dir: string,
  cwd: string,
): Promise<{ readonly name: string; readonly dir: string }> {
  const root = resolve(cwd, dir);
  if ((await kindOf(root)) !== "directory") {
    throw new Error(`${root} is not a directory: --plugin names the directory of a built plugin`);
  }
  const packageText = await readFile(join(root, "package.json"), "utf8").catch(() => undefined);
  if (packageText === undefined) {
    throw new Error(`${root} has no package.json: --plugin names the directory of a built plugin`);
  }
  let name: unknown;
  try {
    name = (JSON.parse(packageText) as { readonly name?: unknown }).name;
  } catch {
    throw new Error(`${root}/package.json is not JSON`);
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${root}/package.json names no package`);
  }
  if ((await kindOf(join(root, "console-plugin.json"))) !== "file") {
    throw new Error(`${root} has no console-plugin.json: not a plugin`);
  }
  if ((await kindOf(join(root, "dist"))) !== "directory") {
    throw new Error(`${root} has no dist/: build the plugin first`);
  }
  return { name, dir: root };
}

/** The database a preview keeps between runs (`--keep`), one on the server. */
export const PREVIEW_DATABASE = "console_preview";

/**
 * What a preview says when one of the fixture's people cannot sign in on the database it kept,
 * with what the console answered: an earlier run took the person out, which the People page
 * undoes; or a database of that name made by something else holds other accounts under the
 * same logins, which the console refuses to take for the fixture's, and only dropping it starts
 * over. The console's answer does not say which, so the preview names both.
 */
export function keptSignInFailure(person: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `${person} could not sign in on the kept database ${PREVIEW_DATABASE} (${reason}). Either an earlier run took ${person} out, which the People page undoes for an administrator, or the database holds other accounts under the fixture's logins, as one made by something other than this preview does: then drop it (drop database ${PREVIEW_DATABASE} with (force)), or start without --keep.`,
    { cause },
  );
}
