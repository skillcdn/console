// Registers the GitHub App a console signs people in with, from a manifest (ADR-0171): a person
// presses "Create GitHub App" once, and what GitHub hands back, the client id, the client secret
// and, for an organization, the app's private key, goes where the installation keeps it without
// passing through a command line, a chat or a terminal.
//
//   node github-app.mjs --url <the console's origin> [--org <login>] [--name <name>]
//                       [--port <port>] [--host <address>] [--wait <seconds>]
//                       [--web-url <origin>] [--api-url <url>] [--secrets <file>]
//
// It listens on this machine, at http://127.0.0.1:11196/ unless --port says otherwise. That page
// sends the browser to GitHub with the app's settings; GitHub sends it back here with a code,
// which is exchanged once. Then:
//   - by default, lines of an env file on standard output, for a script to take: install.sh of
//     the smallest install does (deploy/README.md, "Installing with the script");
//   - with --secrets <file>, the secrets merged into that JSON file (the secrets file of the
//     skill deploying-a-console, readable by its owner alone) and only what is no secret printed.
// Everything said to a person is on standard error. --org registers the app under an
// organization, with the one permission that lets the console read who is a member. --web-url
// and --api-url name a GitHub Enterprise Server. Exit: 0 registered, 1 not, 2 not understood.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** The port the page is served at unless another is named: beside the console's own 11199. */
export const DEFAULT_PORT = 11196;
/** How long the press is waited for, in seconds, unless said. */
export const DEFAULT_WAIT_SECONDS = 600;
/** What GitHub may answer the exchange with: an app's settings and one key are a few kilobytes. */
export const MAX_ANSWER_BYTES = 64 * 1024;
/** The longest name GitHub takes for an app. */
export const MAX_NAME_LENGTH = 34;
const EXCHANGE_TIMEOUT_MS = 15_000;
const API_VERSION = "2022-11-28";

/** What went wrong, in a sentence for whoever ran the script; `usage` where the arguments were. */
export class RegistrarError extends Error {
  constructor(message, usage = false) {
    super(message);
    this.name = "RegistrarError";
    this.usage = usage;
  }
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** A character that does not show, or ends a line: none belongs in a name or a value. */
const hasControl = (value) =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  });

/** An origin as the console's own configuration reads one: a scheme and a host, nothing after. */
function originOf(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new RegistrarError(`${name} is an origin such as https://console.example.com`, true);
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new RegistrarError(
      `${name} is an origin such as https://console.example.com, without a path`,
      true,
    );
  }
  return url.origin;
}

/** The address of an API, which may carry a path (`https://<host>/api/v3`), without its last slash. */
function apiOf(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new RegistrarError("--api-url is an address such as https://api.github.com", true);
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new RegistrarError("--api-url is an address such as https://api.github.com", true);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function integerOf(value, name, min, max) {
  if (!/^\d{1,6}$/.test(value)) {
    throw new RegistrarError(`${name} takes a number between ${min} and ${max}`, true);
  }
  const number = Number(value);
  if (number < min || number > max) {
    throw new RegistrarError(`${name} takes a number between ${min} and ${max}`, true);
  }
  return number;
}

const USAGE =
  "usage: node github-app.mjs --url <the console's origin> [--org <login>] [--name <name>] [--port <port>] [--host <address>] [--wait <seconds>] [--web-url <origin>] [--api-url <url>] [--secrets <file>]";

/**
 * The arguments as options, each held to its form. No secret is among them, and none is ever
 * taken: what is secret is GitHub's to make and this script's to put away.
 */
export function parseArguments(argv) {
  const given = {};
  const names = new Set([
    "url",
    "org",
    "name",
    "port",
    "host",
    "wait",
    "web-url",
    "api-url",
    "secrets",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    const name = word.startsWith("--") ? word.slice(2) : undefined;
    if (name === undefined || !names.has(name)) {
      throw new RegistrarError(`not an option: ${word}\n${USAGE}`, true);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new RegistrarError(`--${name} takes a value\n${USAGE}`, true);
    }
    if (name in given) {
      throw new RegistrarError(`--${name} is said once`, true);
    }
    given[name] = value;
    index += 1;
  }
  if (given.url === undefined) {
    throw new RegistrarError(`--url names the console's origin\n${USAGE}`, true);
  }
  const org = given.org;
  if (org !== undefined && !LOGIN.test(org)) {
    throw new RegistrarError("--org is the organization's login at GitHub", true);
  }
  const name = given.name;
  if (name !== undefined) {
    if (name.trim().length === 0 || name.length > MAX_NAME_LENGTH || hasControl(name)) {
      throw new RegistrarError(
        `--name is the app's name, ${MAX_NAME_LENGTH} characters at the most`,
        true,
      );
    }
  }
  const host = given.host ?? "127.0.0.1";
  if (!/^[0-9a-fA-F.:]{2,45}$/.test(host)) {
    throw new RegistrarError("--host is an address of this machine, 127.0.0.1 unless said", true);
  }
  return {
    url: originOf(given.url, "--url"),
    org,
    name,
    port: given.port === undefined ? DEFAULT_PORT : integerOf(given.port, "--port", 0, 65_535),
    host,
    waitSeconds:
      given.wait === undefined ? DEFAULT_WAIT_SECONDS : integerOf(given.wait, "--wait", 1, 3600),
    webUrl: originOf(given["web-url"] ?? "https://github.com", "--web-url"),
    apiUrl: apiOf(given["api-url"] ?? "https://api.github.com"),
    secrets: given.secrets,
  };
}

/**
 * The app's settings as GitHub reads a manifest: a homepage, where GitHub sends the browser
 * back with the code, the console's callback for signing in, no webhook and no event, and no
 * permission but, for an organization, reading who is a member. `redirect` is this script's own
 * address for the code.
 */
export function manifestOf({ url, org, name, redirect }) {
  return {
    name,
    url,
    description: `Signs people in to the SkillCDN Console at ${url}.`,
    redirect_url: redirect,
    callback_urls: [`${url}/auth/gh/callback`],
    public: false,
    default_permissions: org === undefined ? {} : { members: "read" },
    default_events: [],
    request_oauth_on_install: false,
    setup_on_update: false,
  };
}

/** Where the browser posts the manifest: the account's own apps, or an organization's. */
export function registrationUrl({ webUrl, org, state }) {
  const path = org === undefined ? "/settings/apps/new" : `/organizations/${org}/settings/apps/new`;
  return `${webUrl}${path}?state=${encodeURIComponent(state)}`;
}

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

/**
 * What GitHub answered the exchange with, held to the fields that are read and to the form each
 * must have to be written into a settings file: anything else is refused as a whole. A value
 * that held a line break, a quote or a `$` would be read as something else there.
 */
export function parseConversion(body, { webUrl }) {
  const refuse = () =>
    new RegistrarError(
      "GitHub's answer was not an app's settings as this script reads them; nothing was written.",
    );
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw refuse();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw refuse();
  }
  const text = (field, pattern) =>
    typeof field === "string" && pattern.test(field) ? field : undefined;
  const id = Number.isSafeInteger(value.id) && value.id > 0 ? String(value.id) : undefined;
  const clientId = text(value.client_id, /^[A-Za-z0-9._-]{1,64}$/);
  const clientSecret = text(value.client_secret, /^[A-Za-z0-9_-]{16,200}$/);
  const pem =
    typeof value.pem === "string" && value.pem.length <= 16_384
      ? text(
          value.pem.replaceAll("\r\n", "\n"),
          /^-----BEGIN (?:RSA )?PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END (?:RSA )?PRIVATE KEY-----\n?$/,
        )
      : undefined;
  if (
    id === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    pem === undefined
  ) {
    throw refuse();
  }
  const owner = typeof value.owner === "object" && value.owner !== null ? value.owner : {};
  const name =
    typeof value.name === "string" && value.name.length <= 100 && !hasControl(value.name)
      ? value.name
      : undefined;
  // The app's page is linked and printed only where it is at the host that was asked.
  const appUrl =
    typeof value.html_url === "string" &&
    value.html_url.length <= 300 &&
    !hasControl(value.html_url) &&
    /^[\x21-\x7e]+$/.test(value.html_url) &&
    !/["'<>`$\\]/.test(value.html_url) &&
    value.html_url.startsWith(`${webUrl}/`)
      ? value.html_url
      : undefined;
  return {
    id,
    clientId,
    clientSecret,
    pem: pem.endsWith("\n") ? pem : `${pem}\n`,
    name,
    url: appUrl,
    owner: text(owner.login, LOGIN),
    ownerType:
      owner.type === "User" ? "User" : owner.type === "Organization" ? "Organization" : undefined,
  };
}

/** A key of several lines as one line of an env file: in double quotes, its breaks as `\n`. */
export const envKey = (pem) => `"${pem.replaceAll("\n", "\\n")}"`;

/**
 * The app as lines of an env file, in the names the console reads. The private key, which only
 * reading an organization needs, is among them only where the app was registered for one.
 */
export function envLines(app, { org, secrets = true }) {
  const lines = [`GITHUB_CLIENT_ID=${app.clientId}`];
  if (secrets) {
    lines.push(`GITHUB_CLIENT_SECRET=${app.clientSecret}`);
  }
  lines.push(`GITHUB_APP_ID=${app.id}`);
  if (org !== undefined) {
    if (secrets) {
      lines.push(`GITHUB_APP_PRIVATE_KEY=${envKey(app.pem)}`);
    }
    lines.push(`GITHUB_ORG=${org}`);
  }
  if (app.owner !== undefined) {
    lines.push(`GITHUB_APP_OWNER=${app.owner}`);
  }
  if (app.ownerType !== undefined) {
    lines.push(`GITHUB_APP_OWNER_TYPE=${app.ownerType}`);
  }
  if (app.url !== undefined) {
    lines.push(`GITHUB_APP_URL=${app.url}`);
  }
  return lines;
}

/** Reads a body up to a bound: a length a server names is a hint, not a promise. */
async function bounded(response, most) {
  if (response.body === null) {
    return "";
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > most) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The code exchanged for the app's settings, once. */
async function exchange(code, { apiUrl, webUrl, fetch: send }) {
  let response;
  try {
    response = await send(`${apiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": "skillcdn-console-github-app",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    throw new RegistrarError(
      "GitHub could not be reached to take the app's settings. The app may stand there with nothing taken from it: delete it on its page, and run this again.",
    );
  }
  if (response.status !== 201 && response.status !== 200) {
    await response.body?.cancel();
    throw new RegistrarError(
      `GitHub refused the exchange (${response.status}): the code was used already, or an hour has passed. An app that stands at GitHub with nothing taken from it is deleted on its page; run this again.`,
    );
  }
  const body = await bounded(response, MAX_ANSWER_BYTES);
  if (body === undefined) {
    throw new RegistrarError(
      "GitHub's answer was longer than an app's settings are; nothing was written.",
    );
  }
  return parseConversion(body, { webUrl });
}

const sameText = (one, other) => {
  const a = Buffer.from(one);
  const b = Buffer.from(other);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Serves the page, waits for GitHub to send the browser back, and answers with the app. `started`
 * is told where the page is once it listens. The listener is closed whichever way it ends.
 */
export function register(options, { fetch: send = fetch, started = () => {} } = {}) {
  const state = randomBytes(24).toString("hex");
  const name = options.name ?? `SkillCDN Console ${randomBytes(3).toString("hex")}`;
  const hostnames = ["127.0.0.1", "localhost", "[::1]"];
  let used = false;
  let settle;
  const done = new Promise((resolveDone, rejectDone) => {
    settle = { resolve: resolveDone, reject: rejectDone };
  });
  const server = createServer((request, response) => {
    const port = server.address()?.port;
    const send_ = (status, title, body) => {
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action ${options.webUrl}; base-uri 'none'; frame-ancestors 'none'`,
      });
      response.end(page(title, body));
    };
    // Only a browser that came by this machine's own name: a page elsewhere that names this
    // port under a name of its own is not answered.
    if (!hostnames.some((hostname) => request.headers.host === `${hostname}:${port}`)) {
      send_(421, "Not this address", "<p>Open the address the script printed.</p>");
      return;
    }
    const asked = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method !== "GET") {
      send_(405, "Not understood", "<p>Open the address the script printed.</p>");
      return;
    }
    if (asked.pathname === "/") {
      const manifest = manifestOf({
        url: options.url,
        org: options.org,
        name,
        redirect: `http://localhost:${port}/callback`,
      });
      const action = registrationUrl({ webUrl: options.webUrl, org: options.org, state });
      send_(
        200,
        "Register the console at GitHub",
        `<p>GitHub asks you to confirm an app named <strong>${escapeHtml(name)}</strong>, which signs people in to the console at ${escapeHtml(options.url)}. Press <strong>Create GitHub App</strong> there, once. It reads nothing of your repositories${options.org === undefined ? "" : `, and of ${escapeHtml(options.org)} only who is a member`}.</p><form method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"><button type="submit">Continue to GitHub</button></form><script>document.forms[0].submit()</script>`,
      );
      return;
    }
    if (asked.pathname !== "/callback") {
      send_(404, "Nothing here", "<p>Open the address the script printed.</p>");
      return;
    }
    const code = asked.searchParams.get("code") ?? "";
    // A callback that does not carry this run's state is somebody else's, and ends nothing.
    if (!sameText(asked.searchParams.get("state") ?? "", state)) {
      send_(
        400,
        "Not this registration",
        "<p>Open the address the script printed, and begin there.</p>",
      );
      return;
    }
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(code)) {
      send_(
        400,
        "Not understood",
        "<p>GitHub sent no code. Open the address the script printed, and begin again.</p>",
      );
      return;
    }
    if (used) {
      send_(
        409,
        "Done already",
        "<p>This registration was taken already. Go back to the terminal.</p>",
      );
      return;
    }
    used = true;
    exchange(code, { apiUrl: options.apiUrl, webUrl: options.webUrl, fetch: send }).then(
      (app) => {
        const install =
          options.org !== undefined && app.url !== undefined
            ? `<p>One step is left at GitHub: <a href="${escapeHtml(app.url)}/installations/new">install the app on ${escapeHtml(options.org)}</a>, so that the console reads who is a member.</p>`
            : "";
        send_(
          200,
          "The console is registered",
          `<p>${escapeHtml(app.name ?? name)} is registered. Go back to the terminal: the rest goes on there.</p>${install}`,
        );
        settle.resolve({ ...app, name: app.name ?? name });
      },
      (error) => {
        send_(
          502,
          "The registration was not taken",
          "<p>Go back to the terminal, which says what happened.</p>",
        );
        settle.reject(error);
      },
    );
  });
  const timer = setTimeout(() => {
    settle.reject(
      new RegistrarError(
        `Nobody pressed "Create GitHub App" within ${options.waitSeconds} seconds: nothing was registered. Run this again.`,
      ),
    );
  }, options.waitSeconds * 1000);
  server.on("error", (error) => {
    settle.reject(
      new RegistrarError(
        error?.code === "EADDRINUSE"
          ? `Port ${options.port} of this machine is taken: free it, or name another with --port.`
          : "The page could not be served on this machine.",
      ),
    );
  });
  server.listen(options.port, options.host, () => {
    const port = server.address()?.port;
    started({ address: `http://127.0.0.1:${port}/`, port, name, state });
  });
  const closed = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
  };
  return done.then(
    (app) => {
      closed();
      return app;
    },
    (error) => {
      closed();
      throw error;
    },
  );
}

/** The two secrets merged into the JSON secrets file, which its owner alone may read. */
export function writeSecrets(file, app, { org }) {
  let kept = {};
  if (existsSync(file)) {
    try {
      kept = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new RegistrarError(`${file} is there and does not read as JSON; nothing was written.`);
    }
    if (typeof kept !== "object" || kept === null || Array.isArray(kept)) {
      throw new RegistrarError(`${file} is there and is no secrets file; nothing was written.`);
    }
  }
  const next = {
    ...kept,
    GITHUB_CLIENT_SECRET: app.clientSecret,
    ...(org === undefined ? {} : { GITHUB_APP_PRIVATE_KEY: app.pem }),
  };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Runs the script: the arguments, the page, the press, and what is taken put where it was asked. */
export async function main(argv, io) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    io.stderr(`${error instanceof RegistrarError ? error.message : USAGE}\n`);
    return 2;
  }
  try {
    const app = await register(options, {
      fetch: io.fetch,
      started: ({ address, name }) => {
        io.stderr(
          `Registering a GitHub App named "${name}" for the console at ${options.url}.\nOpen ${address} in a browser signed in to GitHub${options.org === undefined ? "" : ` as an owner of ${options.org}`}, and press "Create GitHub App" there, once. Where GitHub asks you to sign in on the way, sign in and open the address again.\nWaiting for that, up to ${options.waitSeconds} seconds.\n`,
        );
        io.started?.({ address });
      },
    });
    if (options.secrets === undefined) {
      io.stdout(`${envLines(app, { org: options.org }).join("\n")}\n`);
    } else {
      writeSecrets(options.secrets, app, { org: options.org });
      io.stdout(`${envLines(app, { org: options.org, secrets: false }).join("\n")}\n`);
      io.stderr(
        `GITHUB_CLIENT_SECRET${options.org === undefined ? " was" : " and GITHUB_APP_PRIVATE_KEY were"} written to ${options.secrets}.\n`,
      );
    }
    io.stderr(
      `Registered "${app.name}"${app.url === undefined ? "" : ` (${app.url})`}${app.owner === undefined ? "" : `, owned by ${app.owner}`}.\n${
        options.org === undefined
          ? ""
          : `One step is left at GitHub: install it on ${options.org}${app.url === undefined ? ", from the app's page" : `, at ${app.url}/installations/new`}, so that the console reads who is a member.\n`
      }`,
    );
    return 0;
  } catch (error) {
    io.stderr(
      `${error instanceof RegistrarError ? error.message : "The registration failed; nothing was written."}\n`,
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    fetch,
  });
}
