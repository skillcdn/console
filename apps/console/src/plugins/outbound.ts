import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { MAX_PLUGIN_SECRET_LENGTH } from "@skillcdn/console/api";
import {
  isPluginSecretKey,
  MAX_PLUGIN_OUTBOUND_BYTES,
  outboundAllows,
  PLUGIN_OUTBOUND_MS,
  PLUGIN_OUTBOUND_PER_MINUTE,
  type PluginFetchInit,
  PluginRefusal,
  type SealOutcome,
  type SecretUse,
} from "@skillcdn/console/plugin";
import { isPublicAddress } from "../adapters/https-pictures.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import {
  type Carried,
  FIXED_HEADERS,
  formsOf,
  type Placed,
  placeSecret,
  SECRETS_PER_REQUEST,
  scrubAnswer,
  sealAnswer,
  sealKeyOf,
  validateSeal,
} from "./placements.js";
import { createRateLimiter, type RateLimiter } from "./rate.js";

// A plugin's outbound request (docs/specs/plugins.md, "The context", `ctx.fetch`; ADR-0050,
// ADR-0070): to a host the plugin declared and an administrator consented to, over https, to a
// public address the console resolves itself and pins, within the bounds a minute, of size and of
// time, with a method that has no server send the request back; the secrets the plugin names are
// put in by the console, each where the plugin said and to the hosts its setting allows, and
// never cross to the plugin, the answer scrubbed of them; what the plugin names of the answer is
// sealed as a secret by the console, from the hosts its setting allows, and the plugin reads the
// answer without it, or without the body where it cannot be read. What comes back is read whole,
// to the bound, and handed over as bytes; a redirect is handed over as it is, never followed.

/** What an outbound request answered, whole. */
export interface OutboundAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
}

/** What the plugin reads of an answer: scrubbed, and what became of each value it named to seal, there where it named any. */
export interface PluginAnswer extends OutboundAnswer {
  readonly sealed?: Readonly<Record<string, SealOutcome>>;
}

/** The methods a request may use: none that has a server send the request back, as TRACE does, or opens a tunnel. */
export const OUTBOUND_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

/** True when the host is among those a secret's setting names, or the setting names none. */
function withinHosts(hosts: readonly string[] | undefined, host: string): boolean {
  return hosts === undefined || hosts.some((named) => outboundAllows(`outbound:${named}`, host));
}

/** One request to one address: the transport, replaceable in tests. */
export type OutboundSend = (input: {
  readonly url: URL;
  readonly address: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | undefined;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}) => Promise<OutboundAnswer>;

/** A secret as the console opens it for a request: its value, when it expires, and the hosts it may go to. */
export interface OpenedSecret {
  readonly value: string;
  readonly expiresAt: Date | undefined;
  /** The hosts the setting pins it to, as `outbound:<host>` names them; any host the plugin reaches when none. */
  readonly hosts: readonly string[] | undefined;
}

/** What the console says of a secret setting a request seals, before the request goes out. */
export interface Sealable {
  /** The hosts the setting pins it to, whose answers alone it is sealed from; any when none. */
  readonly hosts: readonly string[] | undefined;
  /** For a keyed secret (ADR-0111): how many keys it may keep, and the keys it keeps now. */
  readonly keyed: { readonly max: number; readonly keys: ReadonlySet<string> } | undefined;
}

/** The console's side of the secrets a request names: opening one to put it in, sealing one from the answer. */
export interface SecretAccess {
  /**
   * Refuses a name that is no secret setting of the plugin, before the request goes out; answers
   * what is needed to seal it otherwise.
   */
  sealable(name: string): Promise<Sealable>;
  /** The secret's value, under `key` for a keyed one; refuses a key given for one that is not, and none for one that is. */
  open(name: string, key: string | undefined): Promise<OpenedSecret | undefined>;
  /** Seals the value, under `key` for a keyed one; answers `false` where a new key would be past the secret's bound. */
  seal(
    name: string,
    key: string | undefined,
    value: string,
    expiresAt: Date | undefined,
    host: string,
  ): Promise<boolean>;
}

export interface OutboundOptions {
  readonly clock: Clock;
  readonly logger: Logger;
  /** The addresses a host resolves to; the system's resolver when left out. */
  readonly resolve?: ((host: string) => Promise<readonly string[]>) | undefined;
  /** The transport; https when left out. */
  readonly send?: OutboundSend | undefined;
  /** The requests one plugin makes a minute; the package's bound when left out. */
  readonly perMinute?: number | undefined;
}

const systemResolve = async (host: string): Promise<readonly string[]> =>
  (await lookup(host, { all: true })).map((found) => found.address);

/** One request over https to the address given, the host's name on the connection and in the request. */
const httpsSend: OutboundSend = ({ url, address, method, headers, body, timeoutMs, maxBytes }) =>
  new Promise((resolve, reject) => {
    const family = isIP(address) === 6 ? 6 : 4;
    const request = httpsRequest(
      url,
      {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { "content-length": body.byteLength }),
        },
        servername: url.hostname,
        timeout: timeoutMs,
        // The address was checked; a name resolved again could lead elsewhere.
        lookup: (_host, options, callback) => {
          if (options.all === true) {
            (callback as (err: null, addresses: { address: string; family: number }[]) => void)(
              null,
              [{ address, family }],
            );
          } else {
            (callback as (err: null, address: string, family: number) => void)(
              null,
              address,
              family,
            );
          }
        },
      },
      (response) => {
        const flat: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) {
            flat[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
          }
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        response.on("data", (chunk: Uint8Array) => {
          total += chunk.byteLength;
          if (total > maxBytes) {
            response.destroy();
            reject(new PluginRefusal("plugin.too_many", `the answer is over ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve({ status: response.statusCode ?? 0, headers: flat, bytes });
        });
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy(new PluginRefusal("plugin.timeout", "the host did not answer in time"));
    });
    request.on("error", reject);
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });

/** The secrets a request names, the one and the several together, each named once. */
function secretsOf(init: PluginFetchInit): readonly SecretUse[] {
  const uses = [...(init.secret === undefined ? [] : [init.secret]), ...(init.secrets ?? [])];
  if (uses.length > SECRETS_PER_REQUEST) {
    throw new PluginRefusal(
      "plugin.invalid_args",
      `a request carries at most ${SECRETS_PER_REQUEST} secrets`,
    );
  }
  for (const use of uses) {
    if (typeof use?.name !== "string" || typeof use.as !== "string") {
      throw new PluginRefusal("plugin.invalid_args", "a secret is named, with where it goes");
    }
    if (use.key !== undefined && !isPluginSecretKey(use.key)) {
      throw new PluginRefusal(
        "plugin.invalid_args",
        `the key of ${use.name} is letters, digits, _ and -, up to 64`,
      );
    }
  }
  return uses;
}

export class Outbound {
  private readonly options: OutboundOptions;
  private readonly requests: RateLimiter;

  constructor(options: OutboundOptions) {
    this.options = options;
    this.requests = createRateLimiter({
      perMinute: options.perMinute ?? PLUGIN_OUTBOUND_PER_MINUTE,
      clock: options.clock,
    });
  }

  /**
   * One request of the plugin: refused unless the URL is https to a host among the plugin's
   * consented `outbound:<host>` capabilities and resolves to public addresses alone, and the
   * method is one of `OUTBOUND_METHODS`; the secrets named, if any, put where each `as` says,
   * each within the hosts its setting pins it to and before its expiry, read by the console and
   * never handed over, every form of them taken out of the answer; and what `seal` names of the
   * answer, from a host its setting allows, taken out and sealed, the plugin reading the answer
   * without it and with what became of each.
   */
  async fetch(
    key: string,
    consent: readonly string[],
    target: string,
    init: PluginFetchInit,
    secrets: SecretAccess,
  ): Promise<PluginAnswer> {
    if (!URL.canParse(target)) {
      throw new PluginRefusal("plugin.invalid_args", "fetch takes a URL");
    }
    const url = new URL(target);
    if (url.protocol !== "https:") {
      throw new PluginRefusal("plugin.invalid_args", "an outbound request is https");
    }
    const host = url.hostname.toLowerCase();
    if (!consent.some((capability) => outboundAllows(capability, host))) {
      throw new PluginRefusal("plugin.forbidden", `the plugin has no capability outbound:${host}`);
    }
    const perMinute = this.options.perMinute ?? PLUGIN_OUTBOUND_PER_MINUTE;
    if (!this.requests.take(key)) {
      throw new PluginRefusal(
        "plugin.rate_limited",
        `the plugin makes ${perMinute} outbound requests a minute`,
      );
    }
    const method =
      init.method === undefined
        ? "GET"
        : typeof init.method === "string"
          ? init.method.toUpperCase()
          : "";
    // A server that answers TRACE sends the request back, the secrets the console put in with it.
    if (!OUTBOUND_METHODS.has(method)) {
      throw new PluginRefusal(
        "plugin.invalid_args",
        "the method is GET, HEAD, POST, PUT, PATCH, DELETE or OPTIONS",
      );
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      const lower = name.toLowerCase();
      if (!FIXED_HEADERS.has(lower) && typeof value === "string" && /^[\x20-\x7e]*$/.test(value)) {
        headers[lower] = value;
      }
    }
    // What the answer is to give up is checked before anything is sent: a request with a side
    // elsewhere is not made for a seal that would be refused after it.
    const seal = validateSeal(init.seal);
    const keyed = new Map<string, NonNullable<Sealable["keyed"]>>();
    for (const [name, wanted] of Object.entries(seal)) {
      const { hosts, keyed: keeps } = await secrets.sealable(name);
      // A keyed secret is sealed under a key, and a secret that is not under none (ADR-0111).
      if ((keeps === undefined) !== (sealKeyOf(wanted) === undefined)) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          keeps === undefined
            ? `the secret ${name} keeps one value, and is sealed under no key`
            : `the secret ${name} keeps a value per key, and its seal names the key`,
        );
      }
      if (keeps !== undefined) {
        keyed.set(name, keeps);
      }
      // A secret pinned to hosts is sealed from their answers alone, as it goes to them alone: a
      // value from another host could stand in for a token, or for a signing secret and let a
      // forged webhook through.
      if (!withinHosts(hosts, host)) {
        throw new PluginRefusal(
          "plugin.forbidden",
          `the secret ${name} is sealed from ${(hosts ?? []).join(", ")} only`,
        );
      }
    }
    let placed: Placed = {
      url,
      headers,
      body:
        init.body === undefined
          ? undefined
          : typeof init.body === "string"
            ? new TextEncoder().encode(init.body)
            : init.body,
    };
    const now = this.options.clock.now();
    const carried: Carried[] = [];
    for (const use of secretsOf(init)) {
      const secret = await secrets.open(use.name, use.key);
      if (secret === undefined) {
        throw new PluginRefusal("plugin.forbidden", `the secret ${use.name} is not set`);
      }
      if (secret.expiresAt !== undefined && secret.expiresAt.getTime() <= now.getTime()) {
        throw new PluginRefusal(
          "plugin.forbidden",
          `the secret ${use.name} expired at ${secret.expiresAt.toISOString()}`,
        );
      }
      // A secret pinned to hosts goes to those and no other, whatever else the plugin may reach.
      if (!withinHosts(secret.hosts, host)) {
        throw new PluginRefusal(
          "plugin.forbidden",
          `the secret ${use.name} goes to ${(secret.hosts ?? []).join(", ")} only`,
        );
      }
      placed = placeSecret(placed, use.as, secret.value);
      carried.push({ name: use.name, key: use.key, forms: formsOf(secret.value, use.as) });
    }
    const addresses =
      isIP(host) !== 0
        ? [host]
        : await (this.options.resolve ?? systemResolve)(host).catch(() => [] as readonly string[]);
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
      throw new PluginRefusal(
        "plugin.forbidden",
        `${host} does not resolve to a public address the console reaches`,
      );
    }
    const address = addresses[0] as string;
    const startedAt = performance.now();
    let answer: OutboundAnswer;
    try {
      answer = await (this.options.send ?? httpsSend)({
        url: placed.url,
        address,
        method,
        headers: placed.headers,
        body: placed.body,
        timeoutMs: PLUGIN_OUTBOUND_MS,
        maxBytes: MAX_PLUGIN_OUTBOUND_BYTES,
      });
    } catch (error) {
      if (error instanceof PluginRefusal) {
        throw error;
      }
      this.options.logger.warn({ plugin: key, host, err: error }, "plugin outbound request failed");
      throw new PluginRefusal("plugin.failed", `the request to ${host} failed`);
    }
    // What the plugin named of the answer is sealed here, and the plugin reads the rest (ADR-0070):
    // a value that cannot be sealed is withheld, and the body of an answer that cannot be read.
    const sealing = sealAnswer(
      answer.bytes,
      seal,
      this.options.clock.now(),
      MAX_PLUGIN_SECRET_LENGTH,
      carried,
      (name, under) => {
        const keeps = keyed.get(name);
        return keeps === undefined || keeps.keys.has(under) || keeps.keys.size < keeps.max;
      },
    );
    const outcomes: Record<string, SealOutcome> = { ...sealing.outcomes };
    for (const one of sealing.sealed) {
      // A key added by another request since the keys were read may have taken the last place:
      // the value is not kept, and was taken out of the answer all the same.
      if (!(await secrets.seal(one.name, one.key, one.value, one.expiresAt, host))) {
        outcomes[one.name] = "too_many";
      }
    }
    // What the console put into the request, or took out of the answer, is taken out of the rest
    // of it in every form it knows: an echo of the request, a redirect carrying its URL.
    const scrubbed = scrubAnswer(answer.headers, sealing.bytes, [
      ...carried.flatMap((one) => one.forms),
      ...sealing.taken.flatMap((value) => formsOf(value)),
    ]);
    this.options.logger.info(
      {
        plugin: key,
        host,
        method,
        status: answer.status,
        bytes: answer.bytes.byteLength,
        sealed: outcomes,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "plugin outbound request",
    );
    return {
      status: answer.status,
      headers: scrubbed.headers,
      bytes: scrubbed.bytes,
      ...(Object.keys(seal).length === 0 ? {} : { sealed: outcomes }),
    };
  }
}
