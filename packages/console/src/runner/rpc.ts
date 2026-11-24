import { type Child, type Cut, plainCut } from "./types.js";

// JSON-RPC over a product's standard input and output, a message a line: what the `acp` driver
// speaks to an agent and the `codex` driver to the product's app server. Everything a product
// writes is data: a line that is no message is passed over, and nothing of one is run.

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The most that is shown of what an error carries beside its message. */
const MAX_DETAIL_LENGTH = 1000;
/** The answer to a request for a method the client does not offer. */
export const METHOD_NOT_FOUND = -32601;

/**
 * What an error carries beside its message, as words: a product may say "Internal error" and put
 * why under `data`, as text or as an object with a message of its own.
 */
function detailOf(data: unknown, cut: Cut): string | undefined {
  const words = isObject(data)
    ? (textOf(data.message) ?? textOf(data.details) ?? textOf(data.error))
    : textOf(data);
  const detail = words?.trim();
  return detail === undefined || detail.length === 0 ? undefined : cut(detail, MAX_DETAIL_LENGTH);
}

/** What a request was refused with, as the protocol says it: the message, with what it carries beside it. */
export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string, data?: unknown, cut: Cut = plainCut) {
    const detail = detailOf(data, cut);
    super(detail === undefined || message.includes(detail) ? message : `${message}: ${detail}`);
    this.code = code;
  }
}

/** The two ends of the protocol on one process: requests with their answers, and what arrives unasked. */
export interface Connection {
  request(method: string, params: Json): Promise<unknown>;
  /** Says something that takes no answer; with nothing beside the method where no `params` are given. */
  notify(method: string, params?: Json): Promise<void>;
  /** Answers a request of the product's. */
  answer(id: unknown, result: Json): Promise<void>;
  refuse(id: unknown, code: number, message: string): Promise<void>;
  /** Reads the process to its end, handing over what the product says and asks. */
  read(on: {
    notification(method: string, params: Json): void;
    request(id: unknown, method: string, params: Json): void;
  }): Promise<void>;
}

export function connectionOf(
  child: Child,
  options: {
    /** What cuts what an error carries beside its message. */
    readonly cut?: Cut | undefined;
    /** Whether a message names the protocol's version, as the protocol has it: a product may leave it out on the wire, and is then written to without. */
    readonly header?: boolean | undefined;
  } = {},
): Connection {
  const cut = options.cut ?? plainCut;
  const header: Json = options.header === false ? {} : { jsonrpc: "2.0" };
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const write = (message: Json): Promise<void> =>
    child.write(JSON.stringify({ ...header, ...message }));
  return {
    request(method, params) {
      const id = next;
      next += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ id, method, params }).catch((error: unknown) => {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    notify: (method, params) => write(params === undefined ? { method } : { method, params }),
    answer: (id, result) => write({ id, result }),
    refuse: (id, code, message) => write({ id, error: { code, message } }),
    async read(on) {
      try {
        for await (const text of child.lines) {
          if (text.trim().length === 0) {
            continue;
          }
          let line: unknown;
          try {
            line = JSON.parse(text);
          } catch {
            // What is no message of the protocol is none of the runner's: a line a product
            // printed beside it, say.
            continue;
          }
          if (!isObject(line)) {
            continue;
          }
          const method = textOf(line.method);
          if (method !== undefined) {
            const params = isObject(line.params) ? line.params : {};
            if (line.id === undefined || line.id === null) {
              on.notification(method, params);
            } else {
              on.request(line.id, method, params);
            }
            continue;
          }
          const waiting = typeof line.id === "number" ? pending.get(line.id) : undefined;
          if (waiting === undefined || typeof line.id !== "number") {
            continue;
          }
          pending.delete(line.id);
          if (isObject(line.error)) {
            waiting.reject(
              new RpcError(
                typeof line.error.code === "number" ? line.error.code : 0,
                textOf(line.error.message) ?? "the request was refused",
                line.error.data,
                cut,
              ),
            );
          } else {
            waiting.resolve(line.result);
          }
        }
      } catch {
        // The output closed in the middle of a line: how the process ended says the rest.
      }
      // Nothing answers what was asked of a process that is gone.
      for (const waiting of pending.values()) {
        waiting.reject(new Error("the product's process ended"));
      }
      pending.clear();
    },
  };
}
