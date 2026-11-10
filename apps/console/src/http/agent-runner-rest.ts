// The routes between the console and an agent account's runner (docs/specs/runner.md;
// ADR-0085): the heartbeat, the signals a supervisor sends and the record of them, and the
// stream the runner receives them on. What a runner sends is untrusted data, parsed by schema,
// bounded, and stored as data.

import {
  MAX_FILE_BYTES,
  MAX_SIGNAL_ATTACHMENTS,
  MAX_SIGNALS_PAGE_LIMIT,
  REST_ROUTES,
  type RestRunnerHeartbeat,
  type RestSignal,
  type RestSignals,
  restFileInputSchema,
  restRunnerHeartbeatInputSchema,
  restSignalInputSchema,
  SIGNALS_PAGE_LIMIT,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { Database } from "../db/client.js";
import {
  findRunner,
  findSignalFile,
  listSignals,
  listSignalsAfter,
  recordHeartbeat,
  type SignalRecord,
  sendSignal,
} from "../db/queries/agent-runners.js";
import type { Actor } from "../db/queries/events.js";
import type { Logger } from "../logger.js";
import type { BlobStore } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import { createAgentGuards } from "./agent-guards.js";
import { errorBody } from "./app.js";
import type { Access, AccessCaller } from "./auth.js";
import { imageTypeOf, type KeptPictureType, pictureResponse } from "./kept-pictures.js";
import type { AgentWakes } from "./live-feed.js";
import type { AppEnv } from "./request-context.js";
import { restPerson } from "./rest-shapes.js";

export interface AgentRunnerRestDependencies {
  readonly database: Database;
  readonly access: Access;
  /** Where the pictures sent with a tell are kept, among the board's files. */
  readonly blobs: BlobStore;
  /** Whoever waits in this process for something new of an agent account. */
  readonly wakes: AgentWakes;
  readonly clock: Clock;
  readonly logger: Logger;
}

const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The kinds of picture a signal carries, as they were read off the bytes when it was sent. */
const PICTURE_TYPES: ReadonlyMap<string, KeptPictureType> = new Map([
  ["image/png", "image/png"],
  ["image/jpeg", "image/jpeg"],
  ["image/gif", "image/gif"],
  ["image/webp", "image/webp"],
]);
/** How many signals one look of a stream sends before it looks again. */
const STREAM_PAGE = 100;

export const restSignal = (signal: SignalRecord): RestSignal => ({
  number: signal.number,
  kind: signal.kind,
  by: signal.by === undefined ? null : restPerson(signal.by),
  agent: signal.agent ?? null,
  plugin: signal.plugin ?? null,
  source: signal.source,
  key: signal.key ?? null,
  text: signal.text,
  set: signal.set ?? null,
  attachments: signal.attachments.map((file) => ({
    id: file.id,
    name: file.name,
    size: file.size,
    contentType: file.contentType,
  })),
  at: signal.at.toISOString(),
});

/** Who a signal is sent by: the member, and the agent they act as when with a token. */
const actorOf = (caller: AccessCaller): Actor =>
  caller.token === undefined
    ? { id: caller.person.id }
    : { id: caller.person.id, agent: caller.token.name };

export function registerAgentRunnerRest(
  app: Hono<AppEnv>,
  dependencies: AgentRunnerRestDependencies,
): void {
  const { database, access, blobs, wakes, clock, logger } = dependencies;
  const OWN = `${REST_ROUTES.agents}/me`;

  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  /** A signal with pictures is a form: as large as its pictures may be together, and what wraps them. */
  const formTooLarge = bodyLimit({
    maxSize: MAX_FILE_BYTES + MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);
  const problemOf = (
    issues: readonly { readonly path?: PropertyKey[]; readonly message: string }[],
  ): string => {
    const issue = issues[0];
    if (issue === undefined) {
      return "The request is not readable.";
    }
    const path = (issue.path ?? []).map(String).join(".");
    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  };
  /** A page of a record: from before a number on, a bounded number of lines; or nothing for what does not read. */
  const pageOf = (
    c: Context<AppEnv>,
  ): { readonly before: number | undefined; readonly limit: number } | undefined => {
    const before = c.req.query("before");
    const limit = c.req.query("limit");
    const page = {
      before: before === undefined ? undefined : Number(before),
      limit: limit === undefined ? SIGNALS_PAGE_LIMIT : Number(limit),
    };
    return (page.before !== undefined && (!Number.isSafeInteger(page.before) || page.before < 1)) ||
      !Number.isInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > MAX_SIGNALS_PAGE_LIMIT
      ? undefined
      : page;
  };

  const { running, own, supervising } = createAgentGuards(database, access);

  // The heartbeat: how the agent stands, what its runner is, and where the record stands.
  app.put(`${OWN}/runner`, tooLarge, async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restRunnerHeartbeatInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const runner = await recordHeartbeat(database, {
      account: caller.person,
      heartbeat: parsed.data,
      now: clock.now(),
    });
    const body: RestRunnerHeartbeat = {
      latest: runner.latest,
      delivered: runner.delivered,
      settings: { model: runner.model ?? null, effort: runner.effort ?? null },
      state: runner.state ?? parsed.data.state,
    };
    return c.json(body);
  });

  // The runner's stream of signals, from the number after `after` on, in order.
  app.get(`${OWN}/signals/stream`, async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    const asked = Number(c.req.query("after") ?? "0");
    const lastSeen = Number(c.req.header("last-event-id"));
    if (!Number.isSafeInteger(asked) || asked < 0) {
      return invalid(c, "after: the number of a signal, or 0.");
    }
    let cursor = Number.isSafeInteger(lastSeen) && lastSeen > asked ? lastSeen : asked;
    const accountId = caller.person.id;
    /** Whether the stream is still the account's command's: asked again before every delivery, since a stream outlives the request that opened it. */
    const stillRuns = async (): Promise<boolean> => {
      try {
        const again = await running(c);
        return !(again instanceof Response) && again.person.id === accountId;
      } catch {
        return false;
      }
    };
    c.header("x-accel-buffering", "no");
    return streamSSE(
      c,
      async (stream) => {
        let open = true;
        stream.onAbort(() => {
          open = false;
          wakes.nudge(accountId);
        });
        while (open && !wakes.closed) {
          // Taken before the look, so that a signal sent while looking wakes the wait after it.
          const mark = wakes.mark;
          if (!(await stillRuns())) {
            break;
          }
          const signals = await listSignalsAfter(database, accountId, cursor, STREAM_PAGE);
          for (const signal of signals) {
            cursor = signal.number;
            await stream.writeSSE({
              id: String(signal.number),
              event: "signal",
              data: JSON.stringify(restSignal(signal)),
            });
          }
          if (signals.length === STREAM_PAGE) {
            continue;
          }
          const how = await wakes.wait(accountId, mark);
          if (how === "timeout" && open) {
            await stream.write(": ping\n\n");
          }
        }
      },
      async (error) => {
        logger.warn({ err: error, requestId: c.get("requestId") }, "a signals stream failed");
      },
    );
  });

  // The account's own record of what it was told.
  app.get(`${OWN}/signals`, async (c) => {
    const caller = await own(c);
    if (caller instanceof Response) {
      return caller;
    }
    const page = pageOf(c);
    if (page === undefined) {
      return invalid(c, `before: a signal's number; limit: from 1 to ${MAX_SIGNALS_PAGE_LIMIT}.`);
    }
    const listed = await listSignals(database, caller.person.id, page);
    const body: RestSignals = { items: listed.items.map(restSignal), more: listed.more };
    return c.json(body);
  });

  /**
   * The pictures of a form, kept among the board's files: a few, pictures by their bytes, within
   * the bound on a file together. What they were kept as, or the refusal.
   */
  const picturesOf = async (
    c: Context<AppEnv>,
    form: FormData,
  ): Promise<
    | {
        readonly name: string;
        readonly size: number;
        readonly contentType: string;
        readonly sha256: string;
      }[]
    | Response
  > => {
    const parts = form.getAll("file");
    if (parts.length > MAX_SIGNAL_ATTACHMENTS) {
      return invalid(c, `file: at most ${MAX_SIGNAL_ATTACHMENTS} pictures with one signal.`);
    }
    const read: { name: string; contentType: string; bytes: Uint8Array }[] = [];
    let total = 0;
    for (const part of parts) {
      if (!(part instanceof File)) {
        return invalid(c, "file: every part called file is a file.");
      }
      const named = restFileInputSchema.safeParse({ name: part.name });
      if (!named.success || named.data === undefined) {
        return invalid(c, problemOf(named.success ? [] : named.error.issues));
      }
      total += part.size;
      if (part.size === 0 || total > MAX_FILE_BYTES) {
        return part.size === 0
          ? invalid(c, `file: ${named.data.name} is empty.`)
          : c.json(errorBody("request.too_large", "The pictures are too large together."), 413);
      }
      const bytes = new Uint8Array(await part.arrayBuffer());
      // What it is is read off its bytes, whatever the form called it.
      const contentType = imageTypeOf(bytes);
      if (contentType === undefined) {
        return invalid(c, "file: a picture, a PNG, a JPEG, a GIF or a WebP.");
      }
      read.push({ name: named.data.name, contentType, bytes });
    }
    const kept = [];
    for (const picture of read) {
      const stored = await blobs.put(picture.bytes, clock.now());
      kept.push({
        name: picture.name,
        size: stored.size,
        contentType: picture.contentType,
        sha256: stored.sha256,
      });
    }
    return kept;
  };

  // A supervisor sends a signal: a tell, an interruption, a stop, a start, the model and the
  // effort, a wake. In their own name, on the account's record. As JSON, or as a form where a
  // tell or an interruption carries pictures: the part `signal` with what the JSON would say,
  // and a part `file` for each picture.
  app.post(`${REST_ROUTES.agents}/:handle/signals`, formTooLarge, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    let json: unknown;
    let form: FormData | undefined;
    try {
      if ((c.req.header("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
        form = await c.req.formData();
        const part = form.get("signal");
        json = typeof part === "string" && part.length <= MAX_BODY_BYTES ? JSON.parse(part) : null;
      } else {
        const raw = await c.req.text();
        if (raw.length > MAX_BODY_BYTES) {
          return c.json(errorBody("request.too_large", "The request body is too large."), 413);
        }
        json = JSON.parse(raw);
      }
    } catch {
      return invalid(c, "The request body is not readable.");
    }
    const parsed = restSignalInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const input = parsed.data;
    const carries = form !== undefined && form.getAll("file").length > 0;
    if (carries && input.kind !== "tell" && input.kind !== "interrupt") {
      return invalid(c, "file: pictures go with a tell or an interrupt.");
    }
    if (input.kind === "set" && input.set !== undefined) {
      // A model or an effort is one of those the runner last offered, where it offered any.
      const offers = (await findRunner(database, found.agent.id))?.offers;
      const unknown = (chosen: string | null | undefined, offered: string[] | undefined) =>
        typeof chosen === "string" &&
        offered !== undefined &&
        offered.length > 0 &&
        !offered.includes(chosen);
      if (unknown(input.set.model, offers?.models) || unknown(input.set.effort, offers?.efforts)) {
        return c.json(
          errorBody(
            "signal.not_offered",
            "The model or the effort is none of those the agent's product offers.",
          ),
          400,
        );
      }
    }
    const files = form === undefined || !carries ? [] : await picturesOf(c, form);
    if (files instanceof Response) {
      return files;
    }
    const signal = await sendSignal(database, {
      account: found.agent,
      kind: input.kind,
      by: actorOf(found.caller),
      source: "person",
      key: undefined,
      text: (input.text ?? "").trim(),
      set: input.kind === "set" ? input.set : undefined,
      files,
      now: clock.now(),
    });
    // In this process at once; in the others through the database's own channel.
    wakes.nudge(found.agent.id);
    logger.info(
      {
        person: found.caller.person.id,
        agent: found.agent.id,
        signal: signal.number,
        kind: signal.kind,
        requestId: c.get("requestId"),
      },
      "a signal was sent",
    );
    return c.json(restSignal(signal), 201);
  });

  /** A picture sent with a signal of an account, as its bytes; nothing for one that is not that signal's. */
  const pictureOf = async (c: Context<AppEnv>, accountId: string): Promise<Response> => {
    const number = Number(c.req.param("number"));
    const fileId = c.req.param("file") ?? "";
    const file =
      Number.isSafeInteger(number) && number > 0 && UUID.test(fileId)
        ? await findSignalFile(database, accountId, number, fileId)
        : undefined;
    const type = file === undefined ? undefined : PICTURE_TYPES.get(file.contentType);
    const bytes =
      file === undefined || type === undefined ? undefined : await blobs.get(file.sha256);
    if (type === undefined || bytes === undefined) {
      return c.json(errorBody("file.not_found", "The file was not found."), 404);
    }
    return pictureResponse(c, type, bytes);
  };

  // The pictures of a signal: for the account, whose runner hands them to the product, and for
  // its supervisors, who sent them.
  app.get(`${OWN}/signals/:number/files/:file`, async (c) => {
    const caller = await own(c);
    return caller instanceof Response ? caller : pictureOf(c, caller.person.id);
  });

  app.get(`${REST_ROUTES.agents}/:handle/signals/:number/files/:file`, async (c) => {
    const found = await supervising(c, false);
    return found instanceof Response ? found : pictureOf(c, found.agent.id);
  });

  app.get(`${REST_ROUTES.agents}/:handle/signals`, async (c) => {
    const found = await supervising(c, false);
    if (found instanceof Response) {
      return found;
    }
    const page = pageOf(c);
    if (page === undefined) {
      return invalid(c, `before: a signal's number; limit: from 1 to ${MAX_SIGNALS_PAGE_LIMIT}.`);
    }
    const listed = await listSignals(database, found.agent.id, page);
    const body: RestSignals = { items: listed.items.map(restSignal), more: listed.more };
    return c.json(body);
  });
}
