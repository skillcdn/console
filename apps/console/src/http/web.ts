import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

// Serves a build of the default UI: static files, and the one page for every path that is
// not a file, since the pages route in the browser. The server knows nothing of the UI but
// the directory. A deployment without one is API only.

const MAX_FILES = 5000;
const HTML = "text/html; charset=utf-8";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/**
 * Pages show what people and agents wrote, which is untrusted. Nothing inline runs, nothing
 * loads from elsewhere but pictures over https, and nobody frames the page.
 */
const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
};

/** Paths that belong to the API and never to the pages: they answer their own not-found. */
const NOT_PAGES = ["/api/", "/auth/", "/healthz", "/readyz"];

export class WebRootError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "WebRootError";
  }
}

interface StaticFile {
  readonly file: string;
  readonly contentType: string;
  readonly etag: string;
  readonly size: number;
  readonly cacheControl: string;
}

export interface WebRoot {
  /** The file at the path, the page for a path of the app, or nothing for the API's paths. */
  respond(request: Request): Promise<Response | undefined>;
  readonly files: number;
}

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (found.length >= MAX_FILES) {
        throw new WebRootError(`more than ${MAX_FILES} files`);
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        found.push(path);
      }
    }
  };
  await walk(directory);
  return found;
}

/**
 * Reads the build once: the files it has, and the page. Only what was listed is ever served,
 * so a path can name nothing outside the directory, whatever it spells.
 */
export async function loadWebRoot(directory: string): Promise<WebRoot> {
  let page: Buffer;
  try {
    page = await readFile(join(directory, "index.html"));
  } catch (error) {
    throw new WebRootError(`${directory} holds no index.html`, { cause: error });
  }
  const pageEtag = `"${createHash("sha256").update(page).digest("base64url").slice(0, 27)}"`;
  const files = new Map<string, StaticFile>();
  for (const file of await listFiles(directory)) {
    const path = `/${relative(directory, file).split(sep).join("/")}`;
    if (path === "/index.html") {
      continue;
    }
    const info = await stat(file);
    // A build names its bundles by their content: those never change, and may be kept forever.
    const immutable = path.startsWith("/assets/");
    files.set(path, {
      file,
      contentType: CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      etag: `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
      size: info.size,
      cacheControl: immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
  }

  const respond = async (request: Request): Promise<Response | undefined> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return undefined;
    }
    const { pathname } = new URL(request.url);
    if (NOT_PAGES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
      return undefined;
    }
    const found = files.get(pathname);
    const head = request.method === "HEAD";
    if (found !== undefined) {
      const headers = {
        "content-type": found.contentType,
        "cache-control": found.cacheControl,
        etag: found.etag,
        "x-content-type-options": "nosniff",
      };
      if (request.headers.get("if-none-match") === found.etag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(head ? null : new Uint8Array(await readFile(found.file)), {
        status: 200,
        headers: { ...headers, "content-length": String(found.size) },
      });
    }
    // Every other path is a page of the app, which routes in the browser; what is not one is
    // the app's own not-found page, and a crawler reads the shell either way.
    const headers = {
      ...PAGE_HEADERS,
      "content-type": HTML,
      "cache-control": "no-cache",
      etag: pageEtag,
      "content-length": String(page.byteLength),
    };
    if (request.headers.get("if-none-match") === pageEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(head ? null : new Uint8Array(page), { status: 200, headers });
  };

  return { respond, files: files.size };
}
