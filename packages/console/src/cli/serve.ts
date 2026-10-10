import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FetchLike } from "../client.js";
import type { WebRoot } from "../web.js";

// A console of a person's own, served from their machine (ADR-0014): the files of a build, and
// everything under /api/ carried to the organization's console with the token the command
// keeps. The page and the API share one origin on the loopback, so the page needs no token and
// the organization's console no allowance: it sees a token's requests, as it sees the command's.

/** Where the command listens when nothing is said: next to the api role's 11199 and the dev UI's 11198. */
export const DEFAULT_SERVE_PORT = 11197;

/** The one address the command listens on. */
export const LOOPBACK = "127.0.0.1";

export interface ServeOptions {
  /** The origin of the organization's console, where the API is. */
  readonly upstream: string;
  /** The token the requests are carried with: the person's standing, never given to the page. */
  readonly token: string;
  readonly fetch: FetchLike;
  /** The port the command listens on: what a request's host must name. */
  readonly port: number;
  /** The build to serve, or none: then only the API is here, for a development server to send it to. */
  readonly web?: WebRoot | undefined;
}

export type ServeHandler = (request: Request) => Promise<Response>;

/** Headers that belong to one connection and never travel over the next. */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * What of the browser's request does not go to the console: the loopback's host, anything of a
 * session (the token is the credential), what names the page's origin (a token's request needs
 * none), and the encodings the browser takes, since what comes back is passed on decoded.
 */
const NOT_FORWARDED: ReadonlySet<string> = new Set([
  "host",
  "cookie",
  "authorization",
  "origin",
  "referer",
  "accept-encoding",
]);

/** What of the console's answer does not go to the browser: a cookie would be the loopback's, and the body arrives decoded. */
const NOT_ANSWERED: ReadonlySet<string> = new Set([
  "set-cookie",
  "content-encoding",
  "content-length",
]);

const json = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const plain = (status: number, message: string): Response =>
  new Response(`${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * Whether a request to the API comes from the console's own page, or from no page at all.
 * Browsers say which site a request comes from, and one from another site is that site's
 * request made with the person's standing: refused. A browser too old to say names the page's
 * origin on a request that changes something, which is compared instead. A request that says
 * nothing of either is not a browser's.
 */
function fromOwnPage(request: Request, origin: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) {
    return site === "same-origin" || site === "none";
  }
  const from = request.headers.get("origin");
  return from === null || from === origin;
}

async function forward(
  request: Request,
  url: URL,
  upstream: string,
  options: ServeOptions,
): Promise<Response> {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name) && !NOT_FORWARDED.has(name) && !name.startsWith("sec-")) {
      headers.set(name, value);
    }
  });
  headers.set("authorization", `Bearer ${options.token}`);
  headers.set("accept-encoding", "identity");
  const withBody = request.method !== "GET" && request.method !== "HEAD";
  let answer: Response;
  try {
    answer = await options.fetch(`${upstream}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: withBody ? request.body : undefined,
      redirect: "manual",
      signal: request.signal,
      // A streamed body has to be declared as such.
      ...(withBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return json(502, "network", "The console could not be reached.");
  }
  const out = new Headers();
  answer.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name) && !NOT_ANSWERED.has(name)) {
      out.set(name, value);
    }
  });
  return new Response(answer.body, { status: answer.status, headers: out });
}

/**
 * What the command answers: the API carried to the console with the token, for the page's own
 * requests; the build's files and its page for everything else, when there is a build; and
 * nothing to a request whose host is not this loopback, which is a page elsewhere whose name
 * was made to resolve here.
 */
export function createServeHandler(options: ServeOptions): ServeHandler {
  const hosts = new Set([
    `${LOOPBACK}:${options.port}`,
    `localhost:${options.port}`,
    `[::1]:${options.port}`,
  ]);
  const upstream = new URL(options.upstream).origin;
  return async (request) => {
    const url = new URL(request.url);
    if (!hosts.has(url.host)) {
      return plain(421, "This address is not the console's.");
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (!fromOwnPage(request, `http://${url.host}`)) {
        return json(
          403,
          "auth.forbidden_origin",
          "This request must come from the console's own pages.",
        );
      }
      return forward(request, url, upstream, options);
    }
    if (options.web !== undefined) {
      const answer = await options.web.respond(request);
      if (answer !== undefined) {
        return answer;
      }
    }
    return plain(
      404,
      options.web === undefined
        ? "Nothing is served here but the API, under /api/."
        : "Nothing here.",
    );
  };
}

export interface Listening {
  /** Where the command listens, for a person to open. */
  readonly url: string;
  /** Settled once the listener has closed. */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

/** How the command listens: given the port it was bound, the handler to answer with. */
export type Listen = (
  handlerFor: (port: number) => ServeHandler,
  port: number,
) => Promise<Listening>;

async function answer(
  handler: ServeHandler,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // A browser that goes away takes its request with it, a stream of events included.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });
  const method = req.method ?? "GET";
  const withBody = method !== "GET" && method !== "HEAD";
  let request: Request;
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const each of value) {
          headers.append(name, each);
        }
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }
    request = new Request(`http://${req.headers.host ?? LOOPBACK}${req.url ?? "/"}`, {
      method,
      headers,
      body: withBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
      signal: controller.signal,
      ...(withBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("The request was not understood.\n");
    return;
  }
  let response: Response;
  try {
    response = await handler(request);
  } catch {
    response = plain(500, "Something went wrong.");
  }
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  if (response.body === null || method === "HEAD") {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), res);
  } catch {
    // The browser went away before the answer ended: nothing is owed to it.
    res.destroy();
  }
}

/** Listens on the loopback, and only there, and answers every request through the handler. */
export const listenOn: Listen = (handlerFor, port) =>
  new Promise((resolve, reject) => {
    let handler: ServeHandler | undefined;
    const server = createServer((req, res) => {
      void answer(handler ?? (() => Promise.resolve(plain(503, "Not ready."))), req, res);
    });
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => {
      server.off("error", reject);
      const address = server.address();
      const bound = typeof address === "object" && address !== null ? address.port : port;
      handler = handlerFor(bound);
      const closed = new Promise<void>((done) => {
        server.once("close", () => done());
      });
      resolve({
        url: `http://${LOOPBACK}:${bound}/`,
        closed,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections();
            server.close((error) => (error === undefined ? done() : fail(error)));
          }),
      });
    });
  });
