// The routes of an agent account's sessions and their transcript (docs/specs/runner.md;
// ADR-0086): its runner begins and ends a session, reports its events in numbered batches and
// hands in its pictures; its supervisors and the account read them, a page at a time and as
// they happen; an administrator seals an event. What a runner sends is untrusted data, parsed
// by schema, bounded, stored as data and answered as text and as pictures that are never run.

import {
  MAX_FILE_BYTES,
  MAX_SESSIONS_PAGE_LIMIT,
  MAX_TRANSCRIPT_BATCH_BYTES,
  MAX_TRANSCRIPT_PAGE_LIMIT,
  REST_ROUTES,
  type RestAgentSession,
  type RestAgentSessions,
  type RestTranscriptBatch,
  type RestTranscriptEvent,
  type RestTranscriptEvents,
  type RestTranscriptFile,
  type RestTranscriptText,
  restAgentSessionEndInputSchema,
  restAgentSessionInputSchema,
  restFileInputSchema,
  restTranscriptBatchInputSchema,
  restTranscriptSealInputSchema,
  SESSIONS_PAGE_LIMIT,
  TRANSCRIPT_PAGE_LIMIT,
  TRANSCRIPT_PICTURE_TYPES,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { administers } from "../auth/policy.js";
import type { Database } from "../db/client.js";
import {
  addTranscriptFile,
  appendEvents,
  attachedMonths,
  beginSession,
  endSession,
  findSession,
  findTranscriptFile,
  listSessionEvents,
  listSessions,
  type SessionRecord,
  sealEvent,
  TranscriptError,
  type TranscriptEventRecord,
  type TranscriptFileRecord,
  wholeTextOf,
} from "../db/queries/transcript.js";
import type { Logger } from "../logger.js";
import type { BlobStore } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import { createAgentGuards } from "./agent-guards.js";
import { errorBody } from "./app.js";
import type { Access } from "./auth.js";
import { imageTypeOf, type KeptPictureType, pictureResponse } from "./kept-pictures.js";
import type { AgentWakes } from "./live-feed.js";
import type { AppEnv } from "./request-context.js";
import { restPerson } from "./rest-shapes.js";

export interface AgentTranscriptRestDependencies {
  readonly database: Database;
  readonly access: Access;
  readonly blobs: BlobStore;
  /** Whoever waits in this process for something new of a session. */
  readonly wakes: AgentWakes;
  readonly clock: Clock;
  readonly logger: Logger;
}

const MAX_BODY_BYTES = 64 * 1024;
/** How many events one look of a stream sends before it looks again. */
const STREAM_PAGE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PICTURE_TYPES: ReadonlySet<string> = new Set(TRANSCRIPT_PICTURE_TYPES);

/** How the API answers each thing that is wrong with what was asked of a transcript. */
const STATUS = {
  "transcript.session_not_found": 404,
  "transcript.event_not_found": 404,
  "transcript.session_over": 409,
  "transcript.gap": 409,
  "transcript.away": 409,
  "transcript.out_of_order": 400,
  "transcript.unknown_file": 400,
  "transcript.too_fast": 429,
} as const;

const WORDS: Record<keyof typeof STATUS, string> = {
  "transcript.session_not_found": "The session was not found.",
  "transcript.event_not_found": "The event was not found.",
  "transcript.session_over": "The session is over: nothing more is added to it.",
  "transcript.gap": "The events of a session are numbered one after another.",
  "transcript.away": "The month the session is kept under is put away.",
  "transcript.out_of_order": "The events of a batch are numbered in order, none twice.",
  "transcript.unknown_file": "An event names a picture that was not handed in to its session.",
  "transcript.too_fast": "The session hands in pictures faster than it may.",
};

export const restAgentSession = (
  session: SessionRecord,
  attached: ReadonlySet<string>,
): RestAgentSession => ({
  id: session.id,
  month: session.month,
  startedAt: session.startedAt.toISOString(),
  endedAt: session.endedAt?.toISOString() ?? null,
  ended: session.ended ?? null,
  product: session.product,
  model: session.model ?? null,
  effort: session.effort ?? null,
  resumed: session.resumed,
  machine: session.machine,
  events: session.events,
  lastEventAt: session.lastEventAt?.toISOString() ?? null,
  away: !attached.has(session.month),
});

const restFile = (file: TranscriptFileRecord): RestTranscriptFile => ({
  id: file.id,
  name: file.name,
  size: file.size,
  contentType: file.contentType,
});

export const restTranscriptEvent = (event: TranscriptEventRecord): RestTranscriptEvent => ({
  n: event.n,
  kind: event.kind,
  at: event.at.toISOString(),
  text: event.text,
  whole: event.whole ?? null,
  data: event.data,
  files: event.files.map(restFile),
  sealed:
    event.sealed === undefined
      ? null
      : {
          by: event.sealed.by === undefined ? null : restPerson(event.sealed.by),
          at: event.sealed.at.toISOString(),
          reason: event.sealed.reason,
        },
});

export function registerAgentTranscriptRest(
  app: Hono<AppEnv>,
  dependencies: AgentTranscriptRestDependencies,
): void {
  const { database, access, blobs, wakes, clock, logger } = dependencies;
  const { running, reading } = createAgentGuards(database, access);
  const OWN = `${REST_ROUTES.agents}/me/sessions`;
  const THEIRS = `${REST_ROUTES.agents}/:handle/sessions`;

  const tooLarge = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    });
  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);
  const noSuchSession = (c: Context<AppEnv>): Response =>
    c.json(errorBody("transcript.session_not_found", WORDS["transcript.session_not_found"]), 404);
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
  /** What went wrong, as the API says it; anything that is not the transcript's own is thrown on. */
  const failure = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof TranscriptError) {
      const code = error.code as keyof typeof STATUS;
      const next = error.expected === undefined ? "" : ` The next is ${error.expected}.`;
      return c.json(errorBody(code, `${WORDS[code]}${next}`), STATUS[code]);
    }
    throw error;
  };
  const json = async (c: Context<AppEnv>): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      return undefined;
    }
  };
  /** A whole number a path or a query names, at least `least`, or nothing for what is none. */
  const wholeOf = (value: string | undefined, least: number): number | undefined => {
    const number = Number(value);
    return value !== undefined && /^[0-9]+$/.test(value) && Number.isSafeInteger(number)
      ? number >= least
        ? number
        : undefined
      : undefined;
  };

  /** The session `:id` names of the account `:handle` names, for whoever may read it; or the refusal. */
  const sessionOf = async (
    c: Context<AppEnv>,
  ): Promise<
    | { readonly session: SessionRecord; readonly agentId: string; readonly readerId: string }
    | Response
  > => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id") ?? "";
    const session = UUID.test(id) ? await findSession(database, found.agent.id, id) : undefined;
    return session === undefined
      ? noSuchSession(c)
      : { session, agentId: found.agent.id, readerId: found.caller.person.id };
  };

  // The runner begins a session: what it runs, and where. One of the account's is open at a
  // time; the one that was is taken over.
  app.post(OWN, tooLarge(MAX_BODY_BYTES), async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    const parsed = restAgentSessionInputSchema.safeParse(await json(c));
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const begun = await beginSession(database, {
      account: caller.person,
      session: parsed.data,
      now: clock.now(),
    });
    for (const previous of begun.tookOver) {
      wakes.nudge(previous);
    }
    logger.info(
      {
        agent: caller.person.id,
        session: begun.session.id,
        tookOver: begun.tookOver.length,
        requestId: c.get("requestId"),
      },
      "a session began",
    );
    return c.json(restAgentSession(begun.session, new Set([begun.session.month])), 201);
  });

  // A batch of the session's events, in order. The same number sent again changes nothing.
  app.post(`${OWN}/:id/events`, tooLarge(MAX_TRANSCRIPT_BATCH_BYTES), async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchSession(c);
    }
    const parsed = restTranscriptBatchInputSchema.safeParse(await json(c));
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    try {
      const body: RestTranscriptBatch = await appendEvents(database, blobs, {
        account: caller.person,
        sessionId: id,
        events: parsed.data.events,
        now: clock.now(),
      });
      // In this process at once; in the others through the database's own channel.
      wakes.nudge(id);
      return c.json(body);
    } catch (error) {
      return failure(c, error);
    }
  });

  // A picture of the session, as the part of a form: kept on the month's shelf, and answered
  // with the id an event names it by.
  app.post(`${OWN}/:id/files`, tooLarge(MAX_FILE_BYTES + MAX_BODY_BYTES), async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchSession(c);
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return invalid(c, "The request body is not a form with a file in it.");
    }
    const part = form.get("file");
    if (!(part instanceof File)) {
      return invalid(c, "file: the form needs a part called file.");
    }
    const type = part.type.split(";")[0]?.trim().toLowerCase() ?? "";
    const parsed = restFileInputSchema.safeParse({ name: part.name, contentType: type });
    if (!parsed.success || parsed.data === undefined) {
      return invalid(c, problemOf(parsed.success ? [] : parsed.error.issues));
    }
    if (!PICTURE_TYPES.has(type)) {
      return invalid(c, `file: a picture, one of ${TRANSCRIPT_PICTURE_TYPES.join(", ")}.`);
    }
    if (part.size === 0) {
      return invalid(c, "file: the file is empty.");
    }
    if (part.size > MAX_FILE_BYTES) {
      return c.json(errorBody("request.too_large", "The file is too large."), 413);
    }
    const bytes = new Uint8Array(await part.arrayBuffer());
    // What it is is read off its bytes: a picture said to be one kind and being another is none.
    if (imageTypeOf(bytes) !== type) {
      return invalid(c, "file: the bytes are not a picture of the kind it is said to be.");
    }
    try {
      const kept = await addTranscriptFile(database, blobs, {
        account: caller.person,
        sessionId: id,
        name: parsed.data.name,
        contentType: type,
        bytes,
        now: clock.now(),
      });
      return c.json(restFile(kept), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // The runner ends a session, and says how. Ended already, it stays as it ended.
  app.post(`${OWN}/:id/end`, tooLarge(MAX_BODY_BYTES), async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchSession(c);
    }
    const parsed = restAgentSessionEndInputSchema.safeParse(await json(c));
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const ended = await endSession(database, {
      account: caller.person,
      sessionId: id,
      how: parsed.data.how,
      now: clock.now(),
    });
    if (ended === undefined) {
      return noSuchSession(c);
    }
    wakes.nudge(id);
    logger.info(
      { agent: caller.person.id, session: id, ended: ended.ended, requestId: c.get("requestId") },
      "a session ended",
    );
    return c.json(restAgentSession(ended, await attachedMonths(database)));
  });

  // The account's sessions, the newest first, for its supervisors and for the account.
  app.get(THEIRS, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const before = c.req.query("before");
    const limit = c.req.query("limit");
    const page = {
      before: before === undefined ? undefined : new Date(before),
      limit: limit === undefined ? SESSIONS_PAGE_LIMIT : (wholeOf(limit, 1) ?? 0),
    };
    if (
      (page.before !== undefined && Number.isNaN(page.before.getTime())) ||
      page.limit < 1 ||
      page.limit > MAX_SESSIONS_PAGE_LIMIT
    ) {
      return invalid(
        c,
        `before: the moment a session began; limit: from 1 to ${MAX_SESSIONS_PAGE_LIMIT}.`,
      );
    }
    const [listed, attached] = await Promise.all([
      listSessions(database, found.agent.id, page),
      attachedMonths(database),
    ]);
    const body: RestAgentSessions = {
      items: listed.items.map((session) => restAgentSession(session, attached)),
      more: listed.more,
    };
    return c.json(body);
  });

  app.get(`${THEIRS}/:id`, async (c) => {
    const found = await sessionOf(c);
    if (found instanceof Response) {
      return found;
    }
    return c.json(restAgentSession(found.session, await attachedMonths(database)));
  });

  // The events of a session after a number, in order, a page at a time. Of a session whose
  // month is put away there are none to read, and the session says so.
  app.get(`${THEIRS}/:id/events`, async (c) => {
    const found = await sessionOf(c);
    if (found instanceof Response) {
      return found;
    }
    const after = c.req.query("after");
    const limit = c.req.query("limit");
    const page = {
      after: after === undefined ? 0 : wholeOf(after, 0),
      limit: limit === undefined ? TRANSCRIPT_PAGE_LIMIT : (wholeOf(limit, 1) ?? 0),
    };
    if (page.after === undefined || page.limit < 1 || page.limit > MAX_TRANSCRIPT_PAGE_LIMIT) {
      return invalid(
        c,
        `after: the number of an event, or 0; limit: from 1 to ${MAX_TRANSCRIPT_PAGE_LIMIT}.`,
      );
    }
    const listed = await listSessionEvents(database, found.session, page.after, page.limit);
    const body: RestTranscriptEvents = {
      items: listed.items.map(restTranscriptEvent),
      more: listed.more,
    };
    return c.json(body);
  });

  // The same as they happen: each `event` with an event as its data and its number as its id,
  // and an `end` with the session once it is over and everything of it was sent.
  app.get(`${THEIRS}/:id/events/stream`, async (c) => {
    const found = await sessionOf(c);
    if (found instanceof Response) {
      return found;
    }
    const asked = wholeOf(c.req.query("after") ?? "0", 0);
    if (asked === undefined) {
      return invalid(c, "after: the number of an event, or 0.");
    }
    const lastSeen = wholeOf(c.req.header("last-event-id"), 0);
    let cursor = lastSeen !== undefined && lastSeen > asked ? lastSeen : asked;
    const { agentId, readerId } = found;
    const sessionId = found.session.id;
    /** Whether whoever opened the stream may still read the session: asked before every look, since a stream outlives the request that opened it. */
    const stillReads = async (): Promise<boolean> => {
      try {
        const again = await reading(c);
        return (
          !(again instanceof Response) &&
          again.agent.id === agentId &&
          again.caller.person.id === readerId
        );
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
          wakes.nudge(sessionId);
        });
        while (open && !wakes.closed) {
          // Taken before the look, so that what is appended while looking wakes the wait after it.
          const mark = wakes.mark;
          if (!(await stillReads())) {
            break;
          }
          // The session first: one that is over had all its events before it ended.
          const session = await findSession(database, agentId, sessionId);
          if (session === undefined) {
            break;
          }
          const page = await listSessionEvents(database, session, cursor, STREAM_PAGE);
          for (const event of page.items) {
            cursor = event.n;
            await stream.writeSSE({
              id: String(event.n),
              event: "event",
              data: JSON.stringify(restTranscriptEvent(event)),
            });
          }
          if (page.more) {
            continue;
          }
          if (session.endedAt !== undefined) {
            await stream.writeSSE({
              event: "end",
              data: JSON.stringify(restAgentSession(session, await attachedMonths(database))),
            });
            break;
          }
          const how = await wakes.wait(sessionId, mark);
          if (how === "timeout" && open) {
            await stream.write(": ping\n\n");
          }
        }
      },
      async (error) => {
        logger.warn({ err: error, requestId: c.get("requestId") }, "a transcript stream failed");
      },
    );
  });

  // The whole text of one event, where its row keeps the beginning alone.
  app.get(`${THEIRS}/:id/events/:n/text`, async (c) => {
    const found = await sessionOf(c);
    if (found instanceof Response) {
      return found;
    }
    const n = wholeOf(c.req.param("n"), 1);
    const text = n === undefined ? undefined : await wholeTextOf(database, blobs, found.session, n);
    if (n === undefined || text === undefined) {
      return c.json(
        errorBody("transcript.event_not_found", WORDS["transcript.event_not_found"]),
        404,
      );
    }
    const body: RestTranscriptText = { n, text };
    return c.json(body);
  });

  // A picture of a session, shown in place: one of the kinds a transcript keeps, never sniffed
  // and never run.
  app.get(`${THEIRS}/:id/files/:file`, async (c) => {
    const found = await sessionOf(c);
    if (found instanceof Response) {
      return found;
    }
    const fileId = c.req.param("file");
    const file = UUID.test(fileId)
      ? await findTranscriptFile(database, found.session, fileId)
      : undefined;
    const bytes =
      file === undefined || !PICTURE_TYPES.has(file.contentType)
        ? undefined
        : await blobs.get(file.sha256, { transcript: found.session.month });
    if (file === undefined || bytes === undefined) {
      return c.json(errorBody("file.not_found", "The file was not found."), 404);
    }
    return pictureResponse(c, file.contentType as KeptPictureType, bytes);
  });

  // An administrator seals an event (ADR-0086, point 5): what it held is replaced by who
  // sealed it, when and why. The one way anything leaves a transcript.
  app.post(`${THEIRS}/:id/events/:n/seal`, tooLarge(MAX_BODY_BYTES), async (c) => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return c.json(
        errorBody("auth.forbidden_origin", "This request must come from the console itself."),
        403,
      );
    }
    const found = await sessionOf(c);
    if (found instanceof Response) {
      return found;
    }
    const caller = await access.caller(c);
    if (caller === undefined || !administers(caller.person)) {
      return c.json(errorBody("auth.forbidden", "Only an administrator may do this."), 403);
    }
    const n = wholeOf(c.req.param("n"), 1);
    const parsed = restTranscriptSealInputSchema.safeParse(await json(c));
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    if (n === undefined) {
      return c.json(
        errorBody("transcript.event_not_found", WORDS["transcript.event_not_found"]),
        404,
      );
    }
    try {
      const sealed = await sealEvent(database, blobs, {
        session: found.session,
        n,
        by: caller.person,
        reason: parsed.data.reason,
        now: clock.now(),
      });
      // Who sealed which event; never why, and never what it held.
      logger.info(
        {
          person: caller.person.id,
          agent: found.agentId,
          session: found.session.id,
          event: n,
          requestId: c.get("requestId"),
        },
        "a transcript event was sealed",
      );
      return c.json(restTranscriptEvent(sealed));
    } catch (error) {
      return failure(c, error);
    }
  });
}
