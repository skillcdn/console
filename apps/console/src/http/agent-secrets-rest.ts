// The routes of an agent account's secret store (docs/specs/rest.md, "Agent accounts";
// ADR-0087): the account reads, writes and removes its own, on a session of its own; a
// supervisor seeds one write-only, removes one, and reads the account's record of them. A value
// is answered to the account alone, on the one route that reads it, and is never logged.
//
// And the routes of a secret offered to an account (ADR-0169): any member who sees the account
// offers one, which is kept sealed apart from the store and answered to nobody; the account
// lists what waits, and takes one into its store or leaves it, on a session of its own.

import {
  isHandle,
  isSecretName,
  MAX_AGENT_SECRET_BYTES,
  MAX_AGENT_SECRETS,
  MAX_SECRET_OFFER_NOTE_LENGTH,
  MAX_SECRET_OFFERS_BY_ONE,
  MAX_SECRET_OFFERS_KEPT,
  MAX_SECRET_OFFERS_WAITING,
  RESERVED_HANDLES,
  REST_ROUTES,
  type RestAgentSecret,
  type RestAgentSecretAccesses,
  type RestAgentSecretOffer,
  type RestAgentSecretOffers,
  type RestAgentSecrets,
  type RestAgentSecretValue,
  restAgentSecretInputSchema,
  restAgentSecretOfferInputSchema,
  restAgentSecretOfferTakeInputSchema,
  SECRET_OFFER_DAYS,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessSettings, personVisibleTo, supervises } from "../auth/policy.js";
import type { Secrets } from "../auth/secrets.js";
import type { Database } from "../db/client.js";
import { sendSignal } from "../db/queries/agent-runners.js";
import {
  leaveSecretOffer,
  listSecretOffers,
  offerSecret,
  readsWakesInParts,
  type SecretOfferRecord,
  secretOfferWake,
  takeSecretOffer,
} from "../db/queries/agent-secret-offers.js";
import {
  listSecretAccesses,
  listSecrets,
  readSecret,
  removeSecret,
  SecretError,
  type SecretRecord,
  setSecret,
} from "../db/queries/agent-secrets.js";
import { findAgent } from "../db/queries/agents.js";
import type { Actor } from "../db/queries/events.js";
import type { PersonRecord } from "../db/queries/people.js";
import { readWorkspaceSettings } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { errorBody } from "./app.js";
import { type Access, type AccessCaller, foreignOrigin, signInRequired } from "./auth.js";
import type { AppEnv } from "./request-context.js";
import { restPerson } from "./rest-shapes.js";

export interface AgentSecretsRestDependencies {
  readonly database: Database;
  readonly access: Access;
  /** Seals the values; left out where nobody signs in, and then there is no store. */
  readonly secrets: Secrets | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
}

const MAX_BODY_BYTES = 64 * 1024;
/** How many lines of the record one page carries when none is asked for, and the most it may. */
const ACCESSES_PAGE = 50;
const MAX_ACCESSES_PAGE = 200;

const restSecret = (secret: SecretRecord): RestAgentSecret => ({
  name: secret.name,
  setAt: secret.setAt.toISOString(),
  seeded: secret.seeded,
  expiresOn: secret.expiresOn ?? null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const restOffer = (offer: SecretOfferRecord): RestAgentSecretOffer => ({
  id: offer.id,
  name: offer.name,
  note: offer.note ?? null,
  by: offer.by === undefined ? null : restPerson(offer.by),
  agent: offer.agent ?? null,
  expiresOn: offer.expiresOn ?? null,
  state: offer.state,
  at: offer.at.toISOString(),
  endsAt: offer.endsAt.toISOString(),
  decidedAt: offer.decidedAt?.toISOString() ?? null,
  takenAs: offer.takenAs ?? null,
});

/** Who a change is attributed to: the member, and the agent they act as when with a token. */
const actorOf = (caller: AccessCaller): Actor =>
  caller.token === undefined
    ? { id: caller.person.id }
    : { id: caller.person.id, agent: caller.token.name };

export function registerAgentSecretsRest(
  app: Hono<AppEnv>,
  dependencies: AgentSecretsRestDependencies,
): void {
  const { database, access, secrets, clock, logger } = dependencies;
  const OWN = `${REST_ROUTES.agents}/me/secrets`;
  const THEIRS = `${REST_ROUTES.agents}/:handle/secrets`;
  const OWN_OFFERS = `${REST_ROUTES.agents}/me/secret-offers`;
  const THEIR_OFFERS = `${REST_ROUTES.agents}/:handle/secret-offers`;

  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);
  const noSuchSecret = (c: Context<AppEnv>): Response =>
    c.json(errorBody("secret.not_found", "The account keeps no secret of that name."), 404);
  const noSuchAgent = (c: Context<AppEnv>): Response =>
    c.json(errorBody("agent.not_found", "The agent account was not found."), 404);
  const failure = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof SecretError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "secret.not_found" || error.code === "secret.offer_not_found" ? 404 : 409,
      );
    }
    throw error;
  };
  /** The secret's name in the path, or nothing for text that is not one. */
  const nameOf = (c: Context<AppEnv>): string | undefined => {
    const name = c.req.param("name") ?? "";
    return isSecretName(name) ? name : undefined;
  };
  /** What a `PUT` carries: the value within its bound, and the day it ends on; or the refusal. */
  const inputOf = async (
    c: Context<AppEnv>,
  ): Promise<{ readonly value: string; readonly expiresOn: string | null } | Response> => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restAgentSecretInputSchema.safeParse(json);
    if (!parsed.success) {
      // Never the value back: only that it, or the day, does not read.
      return invalid(c, "value: a text of at least one character; expiresOn: a day, or null.");
    }
    if (Buffer.byteLength(parsed.data.value, "utf8") > MAX_AGENT_SECRET_BYTES) {
      return c.json(
        errorBody(
          "secret.too_large",
          `A secret's value is at most ${MAX_AGENT_SECRET_BYTES} bytes.`,
        ),
        400,
      );
    }
    return { value: parsed.data.value, expiresOn: parsed.data.expiresOn ?? null };
  };

  /**
   * The account asking of its own store, or the refusal. The store is an agent account's, and
   * is read by the account itself: on a session of its own, a browser's or its command's, never
   * with a token it made for an agent of its own, so that what such an agent holds reads none
   * of the account's secrets. A change on a browser's session comes from the console's own pages.
   */
  const owning = async (
    c: Context<AppEnv>,
    changes: boolean,
  ): Promise<{ readonly caller: AccessCaller; readonly secrets: Secrets } | Response> => {
    if (changes && !access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await access.caller(c);
    if (caller === undefined || secrets === undefined) {
      return signInRequired(c);
    }
    if (caller.person.kind !== "agent") {
      return noSuchAgent(c);
    }
    if (caller.token !== undefined) {
      return c.json(
        errorBody(
          "secret.own_session",
          "The secret store is read by the account itself, signed in, not with a token it made.",
        ),
        403,
      );
    }
    return { caller, secrets };
  };

  /** The agent account a supervisor asks about, with a session or a token, or the refusal. */
  const supervising = async (
    c: Context<AppEnv>,
    changes: boolean,
  ): Promise<
    | { readonly caller: AccessCaller; readonly agent: PersonRecord; readonly secrets: Secrets }
    | Response
  > => {
    if (changes && !access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await access.caller(c);
    if (caller === undefined || secrets === undefined) {
      return signInRequired(c);
    }
    const handle = c.req.param("handle") ?? "";
    if (!isHandle(handle) || RESERVED_HANDLES.includes(handle)) {
      return noSuchAgent(c);
    }
    const settings: AccessSettings = await readWorkspaceSettings(
      database,
      caller.person.workspaceId,
    );
    const found = await findAgent(database, caller.person.workspaceId, handle, {
      visible: personVisibleTo(caller.person, settings),
      supervises: supervises(caller.person),
    });
    if (found === undefined) {
      return noSuchAgent(c);
    }
    if (!found.supervised) {
      return c.json(
        errorBody("auth.forbidden", "Only a supervisor of the agent account may do this."),
        403,
      );
    }
    return { caller, agent: found.person, secrets };
  };

  /**
   * The agent account a member asks about, with a session or a token, and whether they
   * supervise it; or the refusal. An account the member may not see is none there is.
   */
  const seeing = async (
    c: Context<AppEnv>,
    changes: boolean,
  ): Promise<
    | {
        readonly caller: AccessCaller;
        readonly agent: PersonRecord;
        readonly supervised: boolean;
        readonly secrets: Secrets;
      }
    | Response
  > => {
    if (changes && !access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await access.caller(c);
    if (caller === undefined || secrets === undefined) {
      return signInRequired(c);
    }
    const handle = c.req.param("handle") ?? "";
    if (!isHandle(handle) || RESERVED_HANDLES.includes(handle)) {
      return noSuchAgent(c);
    }
    const settings: AccessSettings = await readWorkspaceSettings(
      database,
      caller.person.workspaceId,
    );
    const found = await findAgent(database, caller.person.workspaceId, handle, {
      visible: personVisibleTo(caller.person, settings),
      supervises: supervises(caller.person),
    });
    if (found === undefined) {
      return noSuchAgent(c);
    }
    return { caller, agent: found.person, supervised: found.supervised, secrets };
  };

  const noSuchOffer = (c: Context<AppEnv>): Response =>
    c.json(errorBody("secret.offer_not_found", "No such offer waits for the account."), 404);
  /** The offer's id in the path, or nothing for text that is not one. */
  const offerOf = (c: Context<AppEnv>): string | undefined => {
    const id = c.req.param("id") ?? "";
    return UUID.test(id) ? id.toLowerCase() : undefined;
  };

  // What the account itself was offered (ADR-0169), on a session of its own as its store is
  // read. Registered before the routes that take a handle, of which `me` is none.
  app.get(OWN_OFFERS, async (c) => {
    const found = await owning(c, false);
    if (found instanceof Response) {
      return found;
    }
    const body: RestAgentSecretOffers = {
      items: (
        await listSecretOffers(database, found.caller.person.id, {
          waiting: true,
          limit: MAX_SECRET_OFFERS_WAITING,
          now: clock.now(),
        })
      ).map(restOffer),
    };
    return c.json(body);
  });

  app.post(`${OWN_OFFERS}/:id/take`, tooLarge, async (c) => {
    const found = await owning(c, true);
    if (found instanceof Response) {
      return found;
    }
    const id = offerOf(c);
    if (id === undefined) {
      return noSuchOffer(c);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restAgentSecretOfferTakeInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(
        c,
        "as: a name of lowercase letters, digits, dots, hyphens and underscores; replace: true or false.",
      );
    }
    try {
      const taken = await takeSecretOffer(database, found.secrets, {
        accountId: found.caller.person.id,
        offerId: id,
        as: parsed.data.as,
        replace: parsed.data.replace === true,
        actor: actorOf(found.caller),
        limit: MAX_AGENT_SECRETS,
        now: clock.now(),
      });
      // The names, never the value.
      logger.info(
        {
          person: found.caller.person.id,
          offer: id,
          secret: taken.secret.name,
          requestId: c.get("requestId"),
        },
        "an offered secret was taken by its account",
      );
      return c.json(restSecret(taken.secret));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${OWN_OFFERS}/:id`, async (c) => {
    const found = await owning(c, true);
    if (found instanceof Response) {
      return found;
    }
    const id = offerOf(c);
    if (id === undefined) {
      return noSuchOffer(c);
    }
    try {
      const left = await leaveSecretOffer(database, {
        accountId: found.caller.person.id,
        offerId: id,
        now: clock.now(),
      });
      logger.info(
        {
          person: found.caller.person.id,
          offer: id,
          secret: left.name,
          requestId: c.get("requestId"),
        },
        "an offered secret was left by its account",
      );
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  // A member's part: a secret offered to an account they see, which changes nothing of what the
  // account keeps, and what they may read of the account's record of its offers.
  app.post(THEIR_OFFERS, tooLarge, async (c) => {
    const found = await seeing(c, true);
    if (found instanceof Response) {
      return found;
    }
    if (found.agent.id === found.caller.person.id) {
      return c.json(
        errorBody(
          "secret.offer_own",
          "An account sets a secret of its own itself, signed in: console secret <name> --set",
        ),
        409,
      );
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restAgentSecretOfferInputSchema.safeParse(json);
    if (!parsed.success) {
      // Never the value back, nor the note: only what each must be.
      return invalid(
        c,
        `name: lowercase letters, digits, dots, hyphens and underscores; value: a text of at least one character; note: one line of at most ${MAX_SECRET_OFFER_NOTE_LENGTH} characters; expiresOn: a day, or null.`,
      );
    }
    if (Buffer.byteLength(parsed.data.value, "utf8") > MAX_AGENT_SECRET_BYTES) {
      return c.json(
        errorBody(
          "secret.too_large",
          `A secret's value is at most ${MAX_AGENT_SECRET_BYTES} bytes.`,
        ),
        400,
      );
    }
    const now = clock.now();
    let offer: SecretOfferRecord;
    try {
      offer = await offerSecret(database, found.secrets, {
        accountId: found.agent.id,
        name: parsed.data.name,
        value: parsed.data.value,
        note: parsed.data.note ?? null,
        expiresOn: parsed.data.expiresOn ?? null,
        actor: actorOf(found.caller),
        waiting: MAX_SECRET_OFFERS_WAITING,
        byOne: MAX_SECRET_OFFERS_BY_ONE,
        days: SECRET_OFFER_DAYS,
        kept: MAX_SECRET_OFFERS_KEPT,
        now,
      });
    } catch (error) {
      return failure(c, error);
    }
    // The name, never the value, nor what the offerer wrote.
    logger.info(
      {
        person: found.caller.person.id,
        agent: found.agent.id,
        offer: offer.id,
        secret: offer.name,
        requestId: c.get("requestId"),
      },
      "a secret was offered to an agent account",
    );
    // The account is told at once: a wake of the console's own, which says who offers, under
    // which name, and the commands. The offer is kept whether the wake is or not, and the
    // account's listing has it either way.
    try {
      await sendSignal(database, {
        account: found.agent,
        kind: "wake",
        by: undefined,
        source: "console",
        key: `secret-offer:${offer.id}`,
        text: secretOfferWake(
          offer,
          found.caller.person,
          await readsWakesInParts(database, found.agent.id),
        ),
        set: undefined,
        now,
      });
    } catch (error) {
      logger.error(
        { err: error, agent: found.agent.id, offer: offer.id, requestId: c.get("requestId") },
        "the wake of an offered secret was not sent",
      );
    }
    return c.json(restOffer(offer), 201);
  });

  app.get(THEIR_OFFERS, async (c) => {
    const found = await seeing(c, false);
    if (found instanceof Response) {
      return found;
    }
    // A supervisor reads the account's record whole; any other member, what they offered it
    // themselves, and so nothing anyone else wrote.
    const body: RestAgentSecretOffers = {
      items: (
        await listSecretOffers(database, found.agent.id, {
          waiting: false,
          by: found.supervised ? undefined : found.caller.person.id,
          limit: MAX_SECRET_OFFERS_KEPT + MAX_SECRET_OFFERS_WAITING,
          now: clock.now(),
        })
      ).map(restOffer),
    };
    return c.json(body);
  });

  // The account's own store. Registered before the routes that take a handle, of which `me` is none.
  app.get(OWN, async (c) => {
    const found = await owning(c, false);
    if (found instanceof Response) {
      return found;
    }
    const body: RestAgentSecrets = {
      items: (await listSecrets(database, found.caller.person.id)).map(restSecret),
    };
    return c.json(body);
  });

  app.get(`${OWN}/:name`, async (c) => {
    const found = await owning(c, false);
    if (found instanceof Response) {
      return found;
    }
    const name = nameOf(c);
    if (name === undefined) {
      return noSuchSecret(c);
    }
    try {
      const secret = await readSecret(database, found.secrets, {
        accountId: found.caller.person.id,
        name,
        actor: actorOf(found.caller),
        now: clock.now(),
      });
      // The name, never the value.
      logger.info(
        { person: found.caller.person.id, secret: name, requestId: c.get("requestId") },
        "a secret was read by its account",
      );
      const body: RestAgentSecretValue = { ...restSecret(secret), value: secret.value };
      return c.json(body);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.put(`${OWN}/:name`, tooLarge, async (c) => {
    const found = await owning(c, true);
    if (found instanceof Response) {
      return found;
    }
    const name = nameOf(c);
    if (name === undefined) {
      return invalid(c, "name: lowercase letters, digits, dots, hyphens and underscores.");
    }
    const input = await inputOf(c);
    if (input instanceof Response) {
      return input;
    }
    try {
      const secret = await setSecret(database, found.secrets, {
        accountId: found.caller.person.id,
        name,
        value: input.value,
        expiresOn: input.expiresOn,
        actor: actorOf(found.caller),
        seeded: false,
        limit: MAX_AGENT_SECRETS,
        now: clock.now(),
      });
      logger.info(
        { person: found.caller.person.id, secret: name, requestId: c.get("requestId") },
        "a secret was set by its account",
      );
      return c.json(restSecret(secret));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${OWN}/:name`, async (c) => {
    const found = await owning(c, true);
    if (found instanceof Response) {
      return found;
    }
    const name = nameOf(c);
    if (name === undefined) {
      return noSuchSecret(c);
    }
    try {
      await removeSecret(database, {
        accountId: found.caller.person.id,
        name,
        actor: actorOf(found.caller),
        seeded: false,
        now: clock.now(),
      });
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  // A supervisor's part: the names, a secret seeded write-only, one removed, and the record.
  // Never a value: nothing here opens one.
  app.get(THEIRS, async (c) => {
    const found = await supervising(c, false);
    if (found instanceof Response) {
      return found;
    }
    const body: RestAgentSecrets = {
      items: (await listSecrets(database, found.agent.id)).map(restSecret),
    };
    return c.json(body);
  });

  app.put(`${THEIRS}/:name`, tooLarge, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    const name = nameOf(c);
    if (name === undefined) {
      return invalid(c, "name: lowercase letters, digits, dots, hyphens and underscores.");
    }
    const input = await inputOf(c);
    if (input instanceof Response) {
      return input;
    }
    try {
      const secret = await setSecret(database, found.secrets, {
        accountId: found.agent.id,
        name,
        value: input.value,
        expiresOn: input.expiresOn,
        actor: actorOf(found.caller),
        seeded: true,
        limit: MAX_AGENT_SECRETS,
        now: clock.now(),
      });
      logger.info(
        {
          person: found.caller.person.id,
          agent: found.agent.id,
          secret: name,
          requestId: c.get("requestId"),
        },
        "a secret was seeded by a supervisor",
      );
      return c.json(restSecret(secret));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${THEIRS}/:name`, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    const name = nameOf(c);
    if (name === undefined) {
      return noSuchSecret(c);
    }
    try {
      await removeSecret(database, {
        accountId: found.agent.id,
        name,
        actor: actorOf(found.caller),
        seeded: true,
        now: clock.now(),
      });
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.agents}/:handle/secret-accesses`, async (c) => {
    const found = await supervising(c, false);
    if (found instanceof Response) {
      return found;
    }
    const before = c.req.query("before");
    const limit = c.req.query("limit");
    const page = {
      before: before === undefined ? undefined : Number(before),
      limit: limit === undefined ? ACCESSES_PAGE : Number(limit),
    };
    if (
      (page.before !== undefined && (!Number.isSafeInteger(page.before) || page.before < 1)) ||
      !Number.isInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > MAX_ACCESSES_PAGE
    ) {
      return invalid(c, `before: a line's id; limit: from 1 to ${MAX_ACCESSES_PAGE}.`);
    }
    const listed = await listSecretAccesses(database, found.agent.id, page);
    const body: RestAgentSecretAccesses = {
      items: listed.items.map((line) => ({
        id: line.id,
        name: line.name,
        action: line.action,
        by: line.by === undefined ? null : restPerson(line.by),
        agent: line.agent ?? null,
        seeded: line.seeded,
        at: line.at.toISOString(),
      })),
      more: listed.more,
    };
    return c.json(body);
  });
}
