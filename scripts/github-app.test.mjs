// The registrar of an installation's GitHub App (ADR-0171), held against a stand-in for GitHub on
// the loopback: nothing here leaves the machine. Run: node --test scripts/github-app.test.mjs
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
// biome-ignore lint/correctness/useImportExtensions: the script is .mjs, as every script here is
import * as registrar from "../skills/deploying-a-console/scripts/github-app.mjs";

const {
  DEFAULT_PORT,
  envKey,
  envLines,
  MAX_ANSWER_BYTES,
  main,
  manifestOf,
  parseArguments,
  parseConversion,
  RegistrarError,
  register,
  registrationUrl,
} = registrar;

// A key made here: one written into a fixture reads as a committed secret to the scan of CI.
const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const CLIENT_SECRET = "0123456789abcdef0123456789abcdef01234567";
const WEB = "https://github.test";

/** What GitHub answers an exchange with, as its documentation lists the fields. */
const conversion = (more = {}) => ({
  id: 4242,
  slug: "skillcdn-console-a1b2c3",
  name: "SkillCDN Console a1b2c3",
  owner: { login: "alice", id: 7, type: "User" },
  html_url: `${WEB}/apps/skillcdn-console-a1b2c3`,
  client_id: "Iv23liAbCdEfGhIjKlMn",
  client_secret: CLIENT_SECRET,
  webhook_secret: null,
  pem: PEM,
  ...more,
});

/** A stand-in for GitHub's API: answers the exchange as `answer` says, and counts the calls. */
async function standIn(answer) {
  const calls = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    const { status = 201, body = "", wait = 0 } = answer(request);
    setTimeout(() => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    }, wait);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    calls,
    apiUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

/** A registration begun on a port of its own, with where its page is and the state it made. */
async function begin(github, more = {}) {
  let ready;
  const started = new Promise((done) => {
    ready = done;
  });
  const done = register(
    {
      url: "http://127.0.0.1:11199",
      org: undefined,
      name: undefined,
      port: 0,
      host: "127.0.0.1",
      waitSeconds: 20,
      webUrl: WEB,
      apiUrl: github.apiUrl,
      ...more,
    },
    { started: ready },
  );
  // A rejection is the test's to read where it expects one.
  done.catch(() => {});
  const at = await started;
  return { ...at, done };
}

/** The press, as GitHub sends the browser back after it. */
const press = (at, { code = "a180b1a3d263c81bc6441d7b990bae27d4c10679", state = at.state } = {}) =>
  fetch(`${at.address}callback?code=${encodeURIComponent(code)}&state=${state}`);

test("reads its arguments, and refuses what is not one", () => {
  const options = parseArguments(["--url", "https://console.example.com/"]);
  assert.equal(options.url, "https://console.example.com");
  assert.equal(options.port, DEFAULT_PORT);
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.webUrl, "https://github.com");
  assert.equal(options.apiUrl, "https://api.github.com");
  assert.equal(options.waitSeconds, 600);
  // A GitHub Enterprise Server, whose API has a path.
  const own = parseArguments([
    "--url",
    "http://127.0.0.1:11199",
    "--org",
    "acme",
    "--web-url",
    "https://git.acme.test",
    "--api-url",
    "https://git.acme.test/api/v3/",
    "--port",
    "0",
    "--wait",
    "30",
  ]);
  assert.equal(own.apiUrl, "https://git.acme.test/api/v3");
  assert.equal(own.org, "acme");
  for (const wrong of [
    [],
    ["--url"],
    ["--url", "console.example.com"],
    ["--url", "https://console.example.com/path"],
    ["--url", "https://user:word@console.example.com"],
    ["--url", "ftp://console.example.com"],
    ["--url", "https://c.test", "--org", "not a login"],
    ["--url", "https://c.test", "--org", "-acme"],
    ["--url", "https://c.test", "--name", "x".repeat(35)],
    ["--url", "https://c.test", "--name", `two${String.fromCodePoint(10)}lines`],
    ["--url", "https://c.test", "--port", "70000"],
    ["--url", "https://c.test", "--port", "http"],
    ["--url", "https://c.test", "--wait", "0"],
    ["--url", "https://c.test", "--host", "example.com"],
    ["--url", "https://c.test", "--url", "https://d.test"],
    ["--url", "https://c.test", "--client-secret", "x"],
    ["--url", "https://c.test", "stray"],
  ]) {
    assert.throws(
      () => parseArguments(wrong),
      (error) => error instanceof RegistrarError && error.usage === true,
      wrong.join(" "),
    );
  }
});

test("writes a manifest with no webhook, no event and no permission but an organization's members", () => {
  const own = manifestOf({
    url: "http://127.0.0.1:11199",
    org: undefined,
    name: "SkillCDN Console a1b2c3",
    redirect: "http://localhost:11196/callback",
  });
  assert.deepEqual(own.callback_urls, ["http://127.0.0.1:11199/auth/gh/callback"]);
  assert.equal(own.redirect_url, "http://localhost:11196/callback");
  assert.equal(own.public, false);
  assert.deepEqual(own.default_permissions, {});
  assert.deepEqual(own.default_events, []);
  assert.equal(own.request_oauth_on_install, false);
  assert.equal("hook_attributes" in own, false);
  assert.equal(
    registrationUrl({ webUrl: WEB, org: undefined, state: "abc" }),
    `${WEB}/settings/apps/new?state=abc`,
  );
  const organization = manifestOf({
    url: "https://console.example.com",
    org: "acme",
    name: "Acme Console",
    redirect: "http://localhost:11196/callback",
  });
  assert.deepEqual(organization.default_permissions, { members: "read" });
  assert.equal(
    registrationUrl({ webUrl: WEB, org: "acme", state: "abc" }),
    `${WEB}/organizations/acme/settings/apps/new?state=abc`,
  );
});

test("serves one page that posts the manifest to GitHub, to this machine's own name alone", async () => {
  const github = await standIn(() => ({ body: conversion() }));
  // A name a person might give, with what a page would read as its own.
  const hostile = `A "Console" <b>&'`;
  const at = await begin(github, { name: hostile });
  try {
    const response = await fetch(at.address);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /form-action https:\/\/github\.test;/,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    const html = await response.text();
    assert.equal(html.includes(hostile), false);
    assert.ok(html.includes("A &quot;Console&quot; &lt;b&gt;&amp;&#39;"));
    const action = /<form method="post" action="([^"]+)">/.exec(html)?.[1];
    assert.equal(action, `${WEB}/settings/apps/new?state=${at.state}`);
    const field = /name="manifest" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const manifest = JSON.parse(
      field
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
    assert.equal(manifest.name, hostile);
    assert.equal(manifest.url, "http://127.0.0.1:11199");
    assert.equal(manifest.redirect_url, `http://localhost:${at.port}/callback`);
    // A page elsewhere that reaches this port under a name of its own is not answered.
    const renamed = await new Promise((done, failed) => {
      httpRequest(
        at.address,
        { setHost: false, headers: { host: `evil.test:${at.port}` } },
        (answer) => {
          const parts = [];
          answer.on("data", (part) => parts.push(part));
          answer.on("end", () =>
            done({ status: answer.statusCode, text: Buffer.concat(parts).toString("utf8") }),
          );
        },
      )
        .on("error", failed)
        .end();
    });
    assert.equal(renamed.status, 421);
    assert.equal(renamed.text.includes("manifest"), false);
    assert.equal((await fetch(`${at.address}elsewhere`)).status, 404);
    assert.equal((await fetch(at.address, { method: "POST" })).status, 405);
    assert.equal(github.calls.length, 0);
  } finally {
    await press(at);
    await at.done.catch(() => {});
    await github.close();
  }
});

test("exchanges the code once and answers with the app, after a press", async () => {
  const github = await standIn(() => ({ body: conversion() }));
  const at = await begin(github);
  try {
    const back = await press(at, { code: "c0de" });
    assert.equal(back.status, 200);
    assert.match(await back.text(), /Go back to the terminal/);
    const app = await at.done;
    assert.deepEqual(github.calls, ["POST /app-manifests/c0de/conversions"]);
    assert.equal(app.clientId, "Iv23liAbCdEfGhIjKlMn");
    assert.equal(app.clientSecret, CLIENT_SECRET);
    assert.equal(app.id, "4242");
    assert.equal(app.owner, "alice");
    assert.equal(app.ownerType, "User");
    assert.equal(app.url, `${WEB}/apps/skillcdn-console-a1b2c3`);
    // The listener is gone with the registration.
    await assert.rejects(fetch(at.address));
  } finally {
    await github.close();
  }
});

test("does not end for a callback that carries another state, nor exchange its code", async () => {
  const github = await standIn(() => ({ body: conversion() }));
  const at = await begin(github);
  try {
    assert.equal((await press(at, { state: "f".repeat(48) })).status, 400);
    assert.equal((await press(at, { state: "" })).status, 400);
    assert.equal((await fetch(`${at.address}callback?state=${at.state}`)).status, 400);
    assert.equal((await press(at, { code: "not a code" })).status, 400);
    assert.equal(github.calls.length, 0);
    // The registration still waits, and the right callback ends it.
    assert.equal((await press(at)).status, 200);
    assert.equal((await at.done).id, "4242");
  } finally {
    await github.close();
  }
});

test("takes the first callback alone", async () => {
  const github = await standIn(() => ({ body: conversion(), wait: 150 }));
  const at = await begin(github);
  try {
    const first = press(at, { code: "one" });
    // While the first is being exchanged, a second is told that it is done already.
    await new Promise((done) => setTimeout(done, 30));
    assert.equal((await press(at, { code: "two" })).status, 409);
    assert.equal((await first).status, 200);
    await at.done;
    assert.deepEqual(github.calls, ["POST /app-manifests/one/conversions"]);
  } finally {
    await github.close();
  }
});

test("says so where GitHub refuses the code, and writes nothing", async () => {
  const github = await standIn(() => ({ status: 404, body: { message: "Not Found" } }));
  const at = await begin(github);
  try {
    assert.equal((await press(at)).status, 502);
    await assert.rejects(at.done, (error) => {
      assert.ok(error instanceof RegistrarError);
      assert.match(error.message, /GitHub refused the exchange \(404\)/);
      return true;
    });
  } finally {
    await github.close();
  }
});

test("refuses an answer that is too long, or is not an app's settings", async () => {
  const long = await standIn(() => ({
    body: JSON.stringify(conversion({ name: "x".repeat(MAX_ANSWER_BYTES) })),
  }));
  const at = await begin(long);
  try {
    assert.equal((await press(at)).status, 502);
    await assert.rejects(at.done, /longer than an app's settings/);
  } finally {
    await long.close();
  }
  const NEWLINE = String.fromCodePoint(10);
  const BEGIN = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");
  for (const [what, body] of [
    ["not JSON", "<html>"],
    ["an array", "[]"],
    ["nothing", "null"],
    ["no id", JSON.stringify(conversion({ id: undefined }))],
    ["an id that is no number", JSON.stringify(conversion({ id: "4242; rm -rf" }))],
    ["no client id", JSON.stringify(conversion({ client_id: 7 }))],
    [
      "a client id of two lines",
      JSON.stringify(conversion({ client_id: `Iv1${NEWLINE}ADMINS=eve` })),
    ],
    [
      "a secret of two lines",
      JSON.stringify(conversion({ client_secret: `${CLIENT_SECRET}${NEWLINE}ADMINS=eve` })),
    ],
    [
      "a secret a settings file would expand",
      JSON.stringify(conversion({ client_secret: "0123456789abcdef$HOME" })),
    ],
    ["a secret with a quote", JSON.stringify(conversion({ client_secret: '0123456789abcdef"x' }))],
    ["a key that is none", JSON.stringify(conversion({ pem: "a key" }))],
    [
      "a key with a line of its own after it",
      JSON.stringify(conversion({ pem: `${PEM}ADMINS=eve${NEWLINE}` })),
    ],
    [
      "a key with a quote in it",
      JSON.stringify(
        conversion({
          pem: `${BEGIN}${NEWLINE}AB"CD${NEWLINE}${BEGIN.replace("BEGIN", "END")}${NEWLINE}`,
        }),
      ),
    ],
  ]) {
    assert.throws(
      () => parseConversion(body, { webUrl: WEB }),
      (error) => error instanceof RegistrarError && /nothing was written/.test(error.message),
      what,
    );
  }
});

test("leaves out what GitHub says of the app where it is not in the form expected", () => {
  const app = parseConversion(
    JSON.stringify(
      conversion({
        name: `Two${String.fromCodePoint(10)}lines`,
        owner: { login: 'eve"; echo', type: "Admin" },
        html_url: "https://elsewhere.test/apps/x",
      }),
    ),
    { webUrl: WEB },
  );
  assert.equal(app.name, undefined);
  assert.equal(app.owner, undefined);
  assert.equal(app.ownerType, undefined);
  assert.equal(app.url, undefined);
  const lines = envLines(app, { org: undefined });
  assert.deepEqual(lines, [
    "GITHUB_CLIENT_ID=Iv23liAbCdEfGhIjKlMn",
    `GITHUB_CLIENT_SECRET=${CLIENT_SECRET}`,
    "GITHUB_APP_ID=4242",
  ]);
  // A page that would break out of an attribute or a shell word is not kept either.
  for (const url of [`${WEB}/apps/x"onmouseover="y`, `${WEB}/apps/$(id)`, `${WEB}/apps/x y`]) {
    assert.equal(
      parseConversion(JSON.stringify(conversion({ html_url: url })), { webUrl: WEB }).url,
      undefined,
      url,
    );
  }
});

test("prints the app as lines of an env file, the key on one line and only for an organization", () => {
  const app = parseConversion(JSON.stringify(conversion()), { webUrl: WEB });
  const own = envLines(app, { org: undefined });
  assert.deepEqual(own, [
    "GITHUB_CLIENT_ID=Iv23liAbCdEfGhIjKlMn",
    `GITHUB_CLIENT_SECRET=${CLIENT_SECRET}`,
    "GITHUB_APP_ID=4242",
    "GITHUB_APP_OWNER=alice",
    "GITHUB_APP_OWNER_TYPE=User",
    `GITHUB_APP_URL=${WEB}/apps/skillcdn-console-a1b2c3`,
  ]);
  const organization = envLines(app, { org: "acme" });
  const key = organization.find((line) => line.startsWith("GITHUB_APP_PRIVATE_KEY="));
  assert.ok(key !== undefined);
  // One line, in double quotes, each break of the key written as a backslash and an n.
  assert.equal(key.includes(String.fromCodePoint(10)), false);
  const written = key.slice("GITHUB_APP_PRIVATE_KEY=".length);
  assert.equal(written, envKey(PEM));
  assert.equal(written.startsWith('"-----BEGIN RSA '), true);
  assert.equal(written.endsWith('-----\\n"'), true);
  assert.equal(JSON.parse(written), PEM);
  assert.ok(organization.includes("GITHUB_ORG=acme"));
  // Every line is one a settings file takes as it is: a name, and a value with nothing to expand.
  for (const line of [...own, ...organization]) {
    assert.match(line, /^[A-Z_]+=(?:"[-A-Za-z0-9+/= \\]+"|[A-Za-z0-9._:/-]+)$/, line.slice(0, 24));
  }
  // What is no secret, alone.
  assert.equal(
    envLines(app, { org: "acme", secrets: false }).some((line) =>
      /^GITHUB_(CLIENT_SECRET|APP_PRIVATE_KEY)=/.test(line),
    ),
    false,
  );
});

test("gives up when nobody presses in time, and says that nothing was registered", async () => {
  const github = await standIn(() => ({ body: conversion() }));
  const at = await begin(github, { waitSeconds: 0.1 });
  try {
    await assert.rejects(at.done, /nothing was registered/);
    assert.equal(github.calls.length, 0);
    await assert.rejects(fetch(at.address));
  } finally {
    await github.close();
  }
});

test("says which port is taken", async () => {
  const github = await standIn(() => ({ body: conversion() }));
  const first = await begin(github);
  try {
    const second = register(
      {
        url: "http://127.0.0.1:11199",
        port: first.port,
        host: "127.0.0.1",
        waitSeconds: 5,
        webUrl: WEB,
        apiUrl: github.apiUrl,
      },
      {},
    );
    await assert.rejects(second, new RegExp(`Port ${first.port} of this machine is taken`));
  } finally {
    await press(first);
    await first.done;
    await github.close();
  }
});

/** The script run whole, its page pressed as soon as it listens. */
async function run(argv, github) {
  const out = [];
  const err = [];
  const code = await main(["--port", "0", "--api-url", github.apiUrl, "--web-url", WEB, ...argv], {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    fetch,
    started: ({ address }) => {
      fetch(address)
        .then((response) => response.text())
        .then((html) => {
          const state = /\?state=([0-9a-f]+)"/.exec(html)?.[1];
          return fetch(`${address}callback?code=c0de&state=${state}`);
        })
        .catch(() => {});
    },
  });
  return { code, out: out.join(""), err: err.join("") };
}

test("prints the lines on standard output and every word for a person on standard error", async () => {
  const github = await standIn(() => ({ body: conversion() }));
  try {
    const ran = await run(["--url", "http://127.0.0.1:11199", "--org", "acme"], github);
    assert.equal(ran.code, 0);
    assert.match(ran.out, /^GITHUB_CLIENT_ID=Iv23liAbCdEfGhIjKlMn\nGITHUB_CLIENT_SECRET=/);
    assert.match(ran.out, /\nGITHUB_APP_PRIVATE_KEY="-----BEGIN RSA /);
    assert.match(ran.out, /\nGITHUB_ORG=acme\n/);
    // No secret is ever among what a person reads.
    assert.equal(ran.err.includes(CLIENT_SECRET), false);
    assert.equal(ran.err.includes("PRIVATE KEY"), false);
    assert.match(ran.err, /press "Create GitHub App" there, once/);
    assert.match(ran.err, /as an owner of acme/);
    assert.match(
      ran.err,
      /install it on acme, at https:\/\/github\.test\/apps\/skillcdn-console-a1b2c3\/installations\/new/,
    );
    assert.deepEqual(github.calls, ["POST /app-manifests/c0de/conversions"]);
  } finally {
    await github.close();
  }
});

test("merges the secrets into a secrets file with --secrets, and prints none", async () => {
  const github = await standIn(() => ({ body: conversion() }));
  const directory = mkdtempSync(join(tmpdir(), "github-app-"));
  const file = join(directory, "console-secrets.json");
  try {
    writeFileSync(file, `${JSON.stringify({ AUTH_SECRET: "kept" })}\n`);
    const ran = await run(
      ["--url", "https://console.example.com", "--org", "acme", "--secrets", file],
      github,
    );
    assert.equal(ran.code, 0);
    const kept = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(kept).sort(), [
      "AUTH_SECRET",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_CLIENT_SECRET",
    ]);
    assert.equal(kept.AUTH_SECRET, "kept");
    assert.equal(kept.GITHUB_CLIENT_SECRET, CLIENT_SECRET);
    assert.equal(kept.GITHUB_APP_PRIVATE_KEY, PEM);
    if (process.platform !== "win32") {
      assert.equal(statSync(file).mode & 0o777, 0o600);
    }
    for (const printed of [ran.out, ran.err]) {
      assert.equal(printed.includes(CLIENT_SECRET), false);
      assert.equal(printed.includes("PRIVATE KEY-----"), false);
    }
    assert.match(
      ran.out,
      /^GITHUB_CLIENT_ID=Iv23liAbCdEfGhIjKlMn\nGITHUB_APP_ID=4242\nGITHUB_ORG=acme\n/,
    );
    // Without an organization the key is not kept: nothing reads it.
    const own = join(directory, "own.json");
    assert.equal(
      (await run(["--url", "https://console.example.com", "--secrets", own], github)).code,
      0,
    );
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(own, "utf8"))), ["GITHUB_CLIENT_SECRET"]);
    // A file that is there and is no secrets file is left as it is.
    const broken = join(directory, "broken.json");
    writeFileSync(broken, "not json");
    const refused = await run(
      ["--url", "https://console.example.com", "--secrets", broken],
      github,
    );
    assert.equal(refused.code, 1);
    assert.equal(readFileSync(broken, "utf8"), "not json");
    assert.equal(refused.out, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
    await github.close();
  }
});

test("ends with 2 where its arguments are not understood, and 1 where GitHub refused", async () => {
  const refusing = await standIn(() => ({ status: 422, body: {} }));
  try {
    const usage = await run(["--org", "acme"], refusing);
    assert.equal(usage.code, 2);
    assert.match(usage.err, /--url names the console's origin/);
    assert.equal(usage.out, "");
    const refused = await run(["--url", "https://console.example.com"], refusing);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /GitHub refused the exchange \(422\)/);
    assert.equal(refused.out, "");
  } finally {
    await refusing.close();
  }
});
