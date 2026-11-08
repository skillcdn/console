import type { SealOutcome, SecretPlacement, SecretSeal } from "@skillcdn/console/plugin";
import { PluginRefusal } from "@skillcdn/console/plugin";

// Where a secret goes into an outbound request, and what of an answer is sealed as one
// (docs/specs/plugins.md, "The context", `ctx.fetch`; ADR-0070): pure, so that the tests need no
// network. The console puts a secret in and takes a secret out; the plugin names the places. What
// the console put in or took out never reaches the plugin in the answer, in any form it knows.

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

/**
 * The value at a path in parsed JSON, or nothing where the path leads nowhere: a key the answer
 * holds itself, never one every object inherits (`$.constructor`).
 */
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
      current = Object.hasOwn(current, step)
        ? (current as Record<string, unknown>)[step]
        : undefined;
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

/** What the plugin reads where the console sealed a value of the answer. */
const SEALED_MARK = "[sealed]";

/** What the plugin reads where the console withheld a value: one it could not seal, or a secret the request carried. */
const WITHHELD_MARK = "[withheld]";

/** A secret a request carried, by its setting, as the forms it may come back in. */
export interface Carried {
  readonly name: string;
  readonly forms: readonly string[];
}

/** An answer as sealing leaves it: the bytes the plugin reads, what to seal, and what became of each value named. */
export interface SealedAnswer {
  readonly bytes: Uint8Array;
  readonly sealed: readonly Sealed[];
  readonly outcomes: Readonly<Record<string, SealOutcome>>;
  /** The strings taken out where they stood, sealed or withheld: what is taken out of the rest of the answer too. */
  readonly taken: readonly string[];
}

/**
 * Seals what the plugin named of an answer (ADR-0070), and fails closed: the answer's JSON is
 * read, each value named is taken out for the console to seal, with its expiry where one is
 * named, and the answer the plugin receives says `"[sealed]"` where each stood. A value that
 * cannot be sealed, being no string, over the bound, or holding a secret the request carried from
 * another setting, is not handed over either: `"[withheld]"` stands in its place. An answer that
 * is no JSON object or array is withheld whole, since nothing in it can be told apart from the
 * values named. A path that leads to nothing, `null` or an empty string seals nothing and takes
 * nothing out. Every value is read before any is replaced, so that no seal reads another's mark.
 */
export function sealAnswer(
  bytes: Uint8Array,
  seal: Readonly<Record<string, SecretSeal>>,
  now: Date,
  maxLength: number,
  carried: readonly Carried[] = [],
): SealedAnswer {
  const entries = Object.entries(seal);
  if (entries.length === 0) {
    return { bytes, sealed: [], outcomes: {}, taken: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    const outcome: SealOutcome = "not_json";
    return {
      bytes: new Uint8Array(0),
      sealed: [],
      outcomes: Object.fromEntries(entries.map(([name]) => [name, outcome])),
      taken: [],
    };
  }
  const named = entries.map(([name, wanted]) => {
    const { path, expiresIn } = sealOf(wanted);
    return { name, path, expiresIn, value: readPath(parsed, path) };
  });
  const sealed: Sealed[] = [];
  const outcomes: Record<string, SealOutcome> = {};
  const taken: string[] = [];
  const marks: (readonly [path: string, mark: string])[] = [];
  for (const { name, path, expiresIn, value } of named) {
    if (value === undefined || value === null || value === "") {
      outcomes[name] = "absent";
      continue;
    }
    if (typeof value !== "string") {
      outcomes[name] = "not_a_string";
      marks.push([path, WITHHELD_MARK]);
      continue;
    }
    taken.push(value);
    // A value that holds a secret the request carried is an echo of it: sealed as another
    // setting, it would go where that setting lets it, past the hosts its own setting names.
    const withheld: SealOutcome | undefined =
      value.length > maxLength
        ? "too_long"
        : carried.some(
              (secret) => secret.name !== name && secret.forms.some((form) => value.includes(form)),
            )
          ? "echoed"
          : undefined;
    if (withheld !== undefined) {
      outcomes[name] = withheld;
      marks.push([path, WITHHELD_MARK]);
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
    outcomes[name] = "sealed";
    marks.push([path, SEALED_MARK]);
  }
  for (const [path, mark] of marks) {
    replacePath(parsed, path, mark);
  }
  return {
    bytes: marks.length === 0 ? bytes : encoder.encode(JSON.stringify(parsed)),
    sealed,
    outcomes,
    taken,
  };
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

/** The fewest bytes a value is looked for in base64 by: a shorter one's letters turn up in any base64 by chance. */
const MIN_BASE64_BYTES = 8;

/** A percent-encoding with its hex digits small, as a server that encodes again may spell it. */
const smallHex = (encoded: string): string =>
  encoded.replace(/%[0-9A-F]{2}/g, (sequence) => sequence.toLowerCase());

/** Base64 in the alphabet of a URL. */
const urlAlphabet = (base64: string): string => base64.replaceAll("+", "-").replaceAll("/", "_");

/** A value as it is, escaped as JSON, URL-encoded as a URL's part and as a query or a form encodes it, each with its hex digits big or small. */
function spelledForms(text: string): readonly string[] {
  // A lone surrogate, which an answer's JSON may hold, is encoded as a form encodes it, not thrown on.
  const part = encodeURIComponent(text.toWellFormed());
  const query = new URLSearchParams([["", text]]).toString().slice(1);
  return [text, JSON.stringify(text).slice(1, -1), part, query, smallHex(part), smallHex(query)];
}

/**
 * A value in base64, in a header's alphabet and in a URL's: whole, padded or not, and inside a
 * longer run of base64 at each of the three places its first byte may fall, without the letters
 * it shares with what is around it, so that a value encoded together with others is found too.
 * A value too short to tell from chance has none.
 */
function base64Forms(text: string): readonly string[] {
  const bytes = Buffer.from(text.toWellFormed(), "utf8");
  if (bytes.byteLength < MIN_BASE64_BYTES) {
    return [];
  }
  const whole = bytes.toString("base64");
  const forms = [whole, whole.replace(/=+$/, ""), bytes.toString("base64url")];
  for (const offset of [0, 1, 2]) {
    const shifted = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    // The letters made of the value's bits alone: past the bits of the bytes before it, and
    // short of the last letter, which shares its bits with whatever follows.
    const inside = shifted.slice(
      Math.ceil((offset * 8) / 6),
      Math.floor(((offset + bytes.byteLength) * 8) / 6),
    );
    forms.push(inside, urlAlphabet(inside));
  }
  return forms;
}

/**
 * The forms a value may come back in, to be taken out of an answer: as it is, escaped as JSON,
 * URL-encoded as a URL's part and as a query or a form encodes it, with the hex digits big or
 * small; in base64, whole or inside a longer run of it, in a header's alphabet or a URL's; and
 * each with its slashes escaped, as some JSON spells them. For basic authentication, the pair's
 * forms and the password's alone.
 */
export function formsOf(value: string, as?: SecretPlacement): readonly string[] {
  const forms = [...spelledForms(value), ...base64Forms(value)];
  if (as === "basic") {
    // The header carries the pair as this, however short it is.
    forms.push(Buffer.from(value.toWellFormed(), "utf8").toString("base64"));
    const colon = value.indexOf(":");
    if (colon >= 0 && colon < value.length - 1) {
      const password = value.slice(colon + 1);
      forms.push(...spelledForms(password), ...base64Forms(password));
    }
  }
  const escaped = forms.flatMap((form) =>
    form.includes("/") ? [form, form.replaceAll("/", "\\/")] : [form],
  );
  return [...new Set(escaped)].filter((form) => form.length > 0);
}

/**
 * Takes every form out of an answer, the names and the values of its headers and its body, with
 * `"[withheld]"` in its place: a server that echoes the request, a redirect that carries its URL,
 * hands the plugin no secret the console put in or took out. The body is searched as bytes, and
 * comes through as it was where no form is in it. The longest form goes first, so that a shorter
 * one never leaves part of it behind.
 */
export function scrubAnswer(
  headers: Readonly<Record<string, string>>,
  bytes: Uint8Array,
  forms: readonly string[],
): { readonly headers: Readonly<Record<string, string>>; readonly bytes: Uint8Array } {
  const ordered = [...new Set(forms)]
    .filter((form) => form.length > 0)
    .sort((a, b) => b.length - a.length);
  if (ordered.length === 0) {
    return { headers, bytes };
  }
  const scrubbed: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    scrubbed[scrubText(name, ordered)] = scrubText(value, ordered);
  }
  return { headers: scrubbed, bytes: scrubBytes(bytes, ordered) };
}

function scrubText(text: string, forms: readonly string[]): string {
  let scrubbed = text;
  for (const form of forms) {
    scrubbed = scrubbed.replaceAll(form, WITHHELD_MARK);
  }
  return scrubbed;
}

function scrubBytes(bytes: Uint8Array, forms: readonly string[]): Uint8Array {
  const mark = encoder.encode(WITHHELD_MARK);
  let current = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let changed = false;
  for (const form of forms) {
    const needle = Buffer.from(form, "utf8");
    let at = current.indexOf(needle);
    if (at < 0) {
      continue;
    }
    const parts: Uint8Array[] = [];
    let from = 0;
    while (at >= 0) {
      parts.push(current.subarray(from, at), mark);
      from = at + needle.byteLength;
      at = current.indexOf(needle, from);
    }
    parts.push(current.subarray(from));
    current = Buffer.concat(parts);
    changed = true;
  }
  return changed ? new Uint8Array(current) : bytes;
}
