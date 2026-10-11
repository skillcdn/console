import { readFileSync } from "node:fs";
import * as z from "zod";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import {
  type Credentials,
  CredentialsError,
  type CredentialsSource,
} from "../ports/credentials.js";
import { type FetchLike, readBody } from "./upstream.js";

// The credentials a platform hands a container through an endpoint of its own (ADR-0018): the
// one the container services of AWS use for a task's role, at an address the platform puts in
// the environment, answering a key pair with its token and the time it expires. They are asked
// for again before they expire and never kept past it; nothing of them is logged.

/** The platform's answer: the fields the signature needs, and when to ask again. */
const answerSchema = z.object({
  AccessKeyId: z.string().min(1),
  SecretAccessKey: z.string().min(1),
  Token: z.string().min(1).optional(),
  Expiration: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "must be a time")
    .optional(),
});

/** The platform answers in a few hundred bytes; this bounds what is read of it. */
const MAX_ANSWER_BYTES = 16 * 1024;
/** The endpoint is on the host or in the task, and answers in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5_000;
/** Asked for again this long before they expire, so that no request carries credentials about to. */
const RENEW_MARGIN_MS = 5 * 60_000;
/** How long an answer without an expiration is kept. */
const DEFAULT_LIFETIME_MS = 15 * 60_000;

export interface ContainerCredentialsOptions {
  /** Where the platform answers, as configuration resolved it. */
  readonly url: string;
  /** What the request carries as `Authorization`, where the platform wants one. */
  readonly authorization?: string | undefined;
  /** The file that holds it instead, read on every request, where the platform rotates it. */
  readonly authorizationFile?: string | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly readFile?: ((path: string) => string) | undefined;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

export function createContainerCredentials(
  options: ContainerCredentialsOptions,
): CredentialsSource {
  const { clock, logger } = options;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const readFile = options.readFile ?? ((path) => readFileSync(path, "utf8"));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current: { readonly credentials: Credentials; readonly expiresAt: number } | undefined;
  let asking: Promise<Credentials> | undefined;

  const authorizationOf = (): string | undefined => {
    if (options.authorizationFile === undefined) {
      return options.authorization;
    }
    try {
      return readFile(options.authorizationFile).trim();
    } catch (error) {
      throw new CredentialsError("the platform's authorization token could not be read", {
        cause: error,
      });
    }
  };

  const ask = async (): Promise<Credentials> => {
    const headers: Record<string, string> = { accept: "application/json" };
    const authorization = authorizationOf();
    if (authorization !== undefined) {
      headers.authorization = authorization;
    }
    let response: Response;
    try {
      response = await send(options.url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new CredentialsError("the platform's credentials endpoint could not be reached", {
        cause: error,
      });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CredentialsError(`the platform's credentials endpoint answered ${response.status}`);
    }
    const body = await readBody(response, MAX_ANSWER_BYTES);
    if (body === undefined) {
      throw new CredentialsError("the platform's credentials endpoint answered more than expected");
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch (error) {
      throw new CredentialsError(
        "the platform's credentials endpoint answered something that is not JSON",
        {
          cause: error,
        },
      );
    }
    const parsed = answerSchema.safeParse(value);
    if (!parsed.success) {
      throw new CredentialsError(
        "the platform's credentials endpoint answered in an unexpected shape",
      );
    }
    const expiresAt =
      parsed.data.Expiration === undefined
        ? clock.now().getTime() + DEFAULT_LIFETIME_MS
        : Date.parse(parsed.data.Expiration);
    const credentials: Credentials = {
      accessKeyId: parsed.data.AccessKeyId,
      secretAccessKey: parsed.data.SecretAccessKey,
      sessionToken: parsed.data.Token,
    };
    current = { credentials, expiresAt };
    logger.debug(
      { expiresAt: new Date(expiresAt).toISOString() },
      "the platform's credentials were read",
    );
    return credentials;
  };

  return {
    async credentials() {
      const now = clock.now().getTime();
      if (current !== undefined && now < current.expiresAt - RENEW_MARGIN_MS) {
        return current.credentials;
      }
      // One question at a time, however many requests are waiting on the answer.
      asking ??= ask().finally(() => {
        asking = undefined;
      });
      try {
        return await asking;
      } catch (error) {
        // The platform renews ahead of time; what it handed before is good until it expires.
        if (current !== undefined && now < current.expiresAt) {
          logger.warn(
            { err: error },
            "the platform's credentials could not be renewed; the current ones serve until they expire",
          );
          return current.credentials;
        }
        throw error;
      }
    },
  };
}
