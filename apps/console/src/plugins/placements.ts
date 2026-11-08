import type { SecretPlacement, SecretSeal } from "@skillcdn/console/plugin";
import { PluginRefusal } from "@skillcdn/console/plugin";

// Where a secret goes into an outbound request, and what of an answer is sealed as one
// (docs/specs/plugins.md, "The context", `ctx.fetch`; ADR-0070): pure, so that the tests need no
// network. The console puts a secret in and takes a secret out; the plugin names the places.

/** Headers a plugin does not set: the connection's own, and what the console puts in itself. */
export const FIXED_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "expect",
]);

/** A request as the placements change it: the URL, the headers and the body, each its own copy. */
export interface Placed {
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array | undefined;
}

const FORM = "application/x-www-form-urlencoded";
const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The media type of the request, from its `content-type` header, lowercase and without parameters. */
function mediaTypeOf(headers: Readonly<Record<string, string>>): string {
  return (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Puts one secret where `as` says: a header, `Authorization: Bearer`, a query parameter, basic
 * authentication, or a field of a JSON or a form body, which the console reads and writes again
 * so that the plugin never holds the value beside the rest.
 */
export function placeSecret(placed: Placed, as: SecretPlacement, value: string): Placed {
  if (as === "basic") {
    return {
      ...placed,
      headers: {
        ...placed.headers,
        authorization: `Basic ${Buffer.from(value, "utf8").toString("base64")}`,
      },
    };
  }
  if (as === "bearer") {
    return { ...placed, headers: { ...placed.headers, authorization: `Bearer ${value}` } };
  }
  if (as.startsWith("header:")) {
    const name = as.slice("header:".length).toLowerCase();
    if (name.length === 0 || FIXED_HEADERS.has(name)) {
      throw new PluginRefusal("plugin.invalid_args", "the secret's header is not one to set");
    }
    return { ...placed, headers: { ...placed.headers, [name]: value } };
  }
  if (as.startsWith("query:")) {
    const name = as.slice("query:".length);
    if (name.length === 0) {
      throw new PluginRefusal("plugin.invalid_args", "the secret's query parameter is unnamed");
    }
    const url = new URL(placed.url);
    url.searchParams.set(name, value);
    return { ...placed, url };
  }
  if (as.startsWith("body:")) {
    const field = as.slice("body:".length);
    if (field.length === 0) {
      throw new PluginRefusal("plugin.invalid_args", "the secret's body field is unnamed");
    }
    const type = mediaTypeOf(placed.headers);
    const text = placed.body === undefined ? "" : decoder.decode(placed.body);
    if (type === FORM) {
      const form = new URLSearchParams(text);
      form.set(field, value);
      return { ...placed, body: encoder.encode(form.toString()) };
    }
    if (type === "application/json" || type.endsWith("+json") || type === "") {
      let parsed: unknown = {};
      if (text.trim().length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new PluginRefusal(
            "plugin.invalid_args",
            "a secret goes into a body field of a JSON object or a form only",
          );
        }
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          "a secret goes into a body field of a JSON object or a form only",
        );
      }
      const object = { ...(parsed as Record<string, unknown>), [field]: value };
      return {
        ...placed,
        headers: {
          ...placed.headers,
          "content-type": placed.headers["content-type"] ?? "application/json",
        },
        body: encoder.encode(JSON.stringify(object)),
      };
    }
    throw new PluginRefusal(
      "plugin.invalid_args",
      "a secret goes into a body field of a JSON object or a form only",
    );
  }
  throw new PluginRefusal(
    "plugin.invalid_args",
    "the secret's placement is header:<name>, bearer, query:<name>, basic or body:<field>",
  );
}

/** How many secrets one request may carry, and how many values of its answer it may seal. */
export const SECRETS_PER_REQUEST = 5;

/** The longest a sealed secret lives where the answer names a longer time: ten years, as a collection's retention goes. */
const MAX_SECRET_LIFE_SECONDS = 3650 * 86_400;

/** A path into the answer's JSON, as `$.a.b.0.c` spells one: the keys and indexes it names. */
const PATH = /^\$(?:\.[A-Za-z0-9_-]+)+$/;

/**
 * The seals a request names, read at the edge before it goes out: each the name of a secret
 * setting to a path into the answer, or to the path with how long the value lasts, in seconds or
 * as a path to the seconds. Anything else is refused, and the request is never made.
 */
export function validateSeal(value: unknown): Readonly<Record<string, SecretSeal>> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PluginRefusal(
      "plugin.invalid_args",
      "seal names the secret settings to seal, each with a path into the answer",
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > SECRETS_PER_REQUEST) {
    throw new PluginRefusal(
      "plugin.invalid_args",
      `a request seals at most ${SECRETS_PER_REQUEST} values of its answer`,
    );
  }
  const seal: Record<string, SecretSeal> = {};
  for (const [name, wanted] of entries) {
    const given =
      typeof wanted === "string"
        ? { path: wanted, expiresIn: undefined }
        : typeof wanted === "object" && wanted !== null && !Array.isArray(wanted)
          ? (wanted as { readonly path?: unknown; readonly expiresIn?: unknown })
          : {};
    const { path, expiresIn } = given;
    if (typeof path !== "string" || !PATH.test(path)) {
      throw new PluginRefusal(
        "plugin.invalid_args",
        `the seal of ${name} names no path into the answer as $.a.b spells one`,
      );
    }
    const lasts =
      expiresIn === undefined ||
      (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) ||
      (typeof expiresIn === "string" && PATH.test(expiresIn));
    if (!lasts) {
      throw new PluginRefusal(
        "plugin.invalid_args",
        `the seal of ${name} says how long it lasts in seconds, or as a path to the seconds`,
      );
    }
    seal[name] = expiresIn === undefined ? path : { path, expiresIn };
  }
  return seal;
}

/** The value at a path in parsed JSON, or nothing where the path leads nowhere. */
export function readPath(value: unknown, path: string): unknown {
  if (!PATH.test(path)) {
    throw new PluginRefusal("plugin.invalid_args", `${path} is not a path as $.a.b spells one`);
  }
  let current: unknown = value;
  for (const step of path.slice(2).split(".")) {
    if (Array.isArray(current)) {
      const index = Number(step);
      current = Number.isInteger(index) && index >= 0 ? current[index] : undefined;
    } else if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[step];
    } else {
      return undefined;
    }
  }
  return current;
}

/** The path a seal names, and how long its value lasts, in seconds or as a path to them. */
function sealOf(seal: SecretSeal): {
  readonly path: string;
  readonly expiresIn: number | string | undefined;
} {
  return typeof seal === "string"
    ? { path: seal, expiresIn: undefined }
    : { path: seal.path, expiresIn: seal.expiresIn };
}

/** What was taken out of an answer to be sealed: the setting's name, the value, and when it expires. */
export interface Sealed {
  readonly name: string;
  readonly value: string;
  readonly expiresAt: Date | undefined;
}

/**
 * Seals what the plugin named of an answer (ADR-0070): the answer's JSON is read, each value
 * named is taken out for the console to seal, with its expiry where one is named, and the
 * answer the plugin receives says `"[sealed]"` where each stood. A path that leads to no string
 * seals nothing and leaves the answer as it is there; an answer that is no JSON seals nothing.
 */
export function sealAnswer(
  bytes: Uint8Array,
  seal: Readonly<Record<string, SecretSeal>>,
  now: Date,
  maxLength: number,
): { readonly bytes: Uint8Array; readonly sealed: readonly Sealed[] } {
  const entries = Object.entries(seal);
  if (entries.length === 0) {
    return { bytes, sealed: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return { bytes, sealed: [] };
  }
  const sealed: Sealed[] = [];
  for (const [name, wanted] of entries) {
    const { path, expiresIn } = sealOf(wanted);
    const value = readPath(parsed, path);
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
      continue;
    }
    const seconds =
      typeof expiresIn === "number"
        ? expiresIn
        : typeof expiresIn === "string"
          ? readPath(parsed, expiresIn)
          : undefined;
    const expiresAt =
      typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
        ? new Date(now.getTime() + Math.min(Math.floor(seconds), MAX_SECRET_LIFE_SECONDS) * 1000)
        : undefined;
    sealed.push({ name, value, expiresAt });
    replacePath(parsed, path, "[sealed]");
  }
  return { bytes: sealed.length === 0 ? bytes : encoder.encode(JSON.stringify(parsed)), sealed };
}

function replacePath(value: unknown, path: string, replacement: string): void {
  const steps = path.slice(2).split(".");
  const last = steps.pop();
  let current: unknown = value;
  for (const step of steps) {
    if (Array.isArray(current)) {
      current = current[Number(step)];
    } else if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[step];
    } else {
      return;
    }
  }
  if (last === undefined) {
    return;
  }
  if (Array.isArray(current)) {
    current[Number(last)] = replacement;
  } else if (typeof current === "object" && current !== null) {
    (current as Record<string, unknown>)[last] = replacement;
  }
}
