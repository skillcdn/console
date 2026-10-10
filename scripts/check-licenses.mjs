// Every production dependency ships in the image or the web build, so its license must allow
// that: permissive only, no copyleft and nothing source-available (AGENTS.md, Dependencies). The
// exceptions are the main repository's own packages: @skillcdn/*, which come under its license,
// FSL-1.1-ALv2, and are what the console is built on (ADR-0003), and @skillcdn/brand, the marks
// of SkillCDN as files, which are trademarks under its trademark policy and not open source at
// all; the default console shows them from that package and never from a copy (ADR-0013).
// Part of `pnpm check`. Reads what pnpm knows about the installed packages; no network.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** SPDX identifiers that permit bundling and redistribution without conditions we cannot meet. */
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "CC-BY-4.0",
  "Zlib",
]);

/** The packages allowed under the main repository's license, by the prefix of their name. */
const SKILLCDN_PACKAGES = "@skillcdn/";
const SKILLCDN_LICENSE = "FSL-1.1-ALv2";

/**
 * The one package allowed by name: the brand's files, whose manifest points at the trademark
 * terms instead of naming a license, which pnpm reports as unknown. The manifest is read to make
 * sure it is still that package under those terms, and nothing else that happens to be unknown.
 */
const BRAND_PACKAGE = "@skillcdn/brand";
const BRAND_LICENSE = "SEE LICENSE IN LICENSE.md";

function manifestLicense(found) {
  const dir = found.paths?.[0];
  if (dir === undefined) return undefined;
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  return typeof manifest.license === "string" ? manifest.license : undefined;
}

/** `(MIT OR Apache-2.0)` is fine when one side is; `MIT AND X` only when both are. */
function allowed(expression) {
  const trimmed = expression.trim().replace(/^\(|\)$/g, "");
  if (/\bOR\b/i.test(trimmed)) return trimmed.split(/\s+OR\s+/i).some(allowed);
  if (/\bAND\b/i.test(trimmed)) return trimmed.split(/\s+AND\s+/i).every(allowed);
  return ALLOWED.has(trimmed);
}

function pnpm(args) {
  const execpath = process.env.npm_execpath;
  const options = {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  };
  if (execpath !== undefined && /\.(?:c|m)?js$/.test(execpath)) {
    return execFileSync(process.execPath, [execpath, ...args], options);
  }
  const windows = process.platform === "win32";
  return execFileSync(windows ? "pnpm.cmd" : "pnpm", args, { ...options, shell: windows });
}

const output = pnpm(["licenses", "list", "--json", "--prod"]);
const start = output.indexOf("{");
if (start < 0) {
  process.stderr.write("pnpm licenses list printed no JSON\n");
  process.exit(1);
}
const byLicense = JSON.parse(output.slice(start));
const offenders = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const found of packages) {
    count += 1;
    const own = found.name.startsWith(SKILLCDN_PACKAGES) && license.trim() === SKILLCDN_LICENSE;
    const brand = found.name === BRAND_PACKAGE && manifestLicense(found) === BRAND_LICENSE;
    if (!own && !brand && !allowed(license)) {
      offenders.push(`${found.name}@${found.versions.join(", ")}: ${license}`);
    }
  }
}
if (offenders.length > 0) {
  process.stderr.write("production dependencies under a license that is not allowed to ship:\n");
  for (const line of offenders) process.stderr.write(`- ${line}\n`);
  process.exit(1);
}
process.stdout.write(`licenses: ${count} production packages, all under allowed licenses\n`);
