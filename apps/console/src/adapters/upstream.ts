import type * as z from "zod";
import { ProviderError } from "../ports/identity-provider.js";

// What the adapters of identity providers share: sending a request with a timeout and no
// redirects, reading a reply that is bounded, and decoding it as the shape the adapter expects.
// A person's credential arrives as an argument and leaves in the request it is sent with.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A token reply and a profile are a few hundred bytes; this bounds what an upstream can send. */
export const MAX_REPLY_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Reads a body up to `maxBytes`, then gives up: `content-length` is a hint, not a promise. */
export async function readBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (response.body === null) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Reads a reply of the provider as the shape the adapter expects of it. Only the fields we
 * read are validated; the provider adds fields freely. A reply that is something else is
 * `invalid`.
 */
export function decodeJson<Schema extends z.ZodType>(
  body: Uint8Array,
  schema: Schema,
  who: string,
): z.infer<Schema> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    throw new ProviderError("invalid", `${who} sent a reply that is not JSON`, { cause: error });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderError("invalid", `${who} sent a reply in an unexpected shape`);
  }
  return parsed.data;
}

/** A name or a picture as the provider gives it, when it is usable, else nothing. */
export function clean(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text.length === 0 ? undefined : text;
}

/** A picture only when the browser can load it over https. */
export function httpsOnly(value: string | null | undefined): string | undefined {
  const url = clean(value);
  return url?.startsWith("https://") === true ? url : undefined;
}

export interface UpstreamOptions {
  /** What the provider is called in log messages. */
  readonly who: string;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface Upstream {
  /** Sends, and turns whatever went wrong on the way into a `ProviderError`. */
  request(url: string, init: RequestInit): Promise<Response>;
  /**
   * The body of a reply as `schema`, for a response that was `ok`. A refusal, or a body that
   * goes on for too long, is `invalid`.
   */
  reply<Schema extends z.ZodType>(response: Response, schema: Schema): Promise<z.infer<Schema>>;
}

export function createUpstream(options: UpstreamOptions): Upstream {
  const { who } = options;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async request(url, init) {
      let response: Response;
      try {
        response = await send(url, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new ProviderError("transient", `${who} could not be reached`, { cause: error });
      }
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        throw new ProviderError(
          response.status === 429 ? "rate_limited" : "transient",
          `${who} answered ${response.status}`,
        );
      }
      return response;
    },
    async reply(response, schema) {
      const bytes = response.ok ? await readBody(response, MAX_REPLY_BYTES) : undefined;
      if (bytes === undefined) {
        // A body that was too long was cancelled by the reader; one that was refused is not read.
        if (!response.ok) {
          await response.body?.cancel();
        }
        throw new ProviderError("invalid", `${who} rejected the request (${response.status})`);
      }
      return decodeJson(bytes, schema, who);
    },
  };
}
