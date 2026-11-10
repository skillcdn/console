// The invitation that leads a machine to an agent account, and the setup it opens (ADR-0088):
// a supervisor makes the code, makes it again or takes it away; whoever holds the code reads,
// without signing in, which account the setup is for and the services of its workspace, and
// nothing secret. The code gives nobody the account: the account is entered through its own
// sign-in at the provider, and through nothing here.

import { randomInt } from "node:crypto";
import {
  CONNECT_CODE_ALPHABET,
  CONNECT_CODE_LENGTH,
  INVITATION_DAYS,
  normalizeConnectCode,
  type ProviderKey,
  REST_ROUTES,
  type RestAgentInvitation,
  type RestAgentInvitationMade,
  type RestAgentInvitationState,
  type RestAgentSetup,
  setupCommandOf,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { hashToken } from "../auth/secrets.js";
import type { Database } from "../db/client.js";
import {
  accountOfInvitation,
  findInvitation,
  type InvitationRecord,
  makeInvitation,
  revokeInvitation,
} from "../db/queries/agent-invitations.js";
import { readWorkspaceSettings, type WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { createAgentGuards } from "./agent-guards.js";
import { errorBody } from "./app.js";
import type { Access } from "./auth.js";
import type { AppEnv } from "./request-context.js";
import { restPerson } from "./rest-shapes.js";

export interface AgentInvitationsRestDependencies {
  readonly database: Database;
  readonly access: Access;
  readonly workspace: () => Promise<WorkspaceRecord>;
  /** The console's own address, which a setup is told to come back to. */
  readonly origin: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

const DAY_MS = 86_400_000;
const GROUP = CONNECT_CODE_LENGTH / 2;

/** A code as a connection's is spelled: two groups, from the system's randomness. */
function newCode(): string {
  const letters = Array.from(
    { length: CONNECT_CODE_LENGTH },
    () => CONNECT_CODE_ALPHABET[randomInt(CONNECT_CODE_ALPHABET.length)] ?? "A",
  ).join("");
  return `${letters.slice(0, GROUP)}-${letters.slice(GROUP)}`;
}

const restInvitation = (invitation: InvitationRecord): RestAgentInvitation => ({
  createdAt: invitation.createdAt.toISOString(),
  expiresAt: invitation.expiresAt.toISOString(),
  by: invitation.by === undefined ? null : restPerson(invitation.by),
});

export function registerAgentInvitationsRest(
  app: Hono<AppEnv>,
  dependencies: AgentInvitationsRestDependencies,
): void {
  const { database, access, workspace, origin, clock, logger } = dependencies;
  const { supervising } = createAgentGuards(database, access);
  const ONE = `${REST_ROUTES.agents}/:handle/invitation`;
  const nowhere = (c: Context<AppEnv>): Response =>
    c.json(
      errorBody("setup.not_found", "No setup has that code: it was never made, or it ended."),
      404,
    );

  // The invitation as it stands, for a supervisor: when it was made and when it ends. Never the
  // code, which was shown once, when it was made.
  app.get(ONE, async (c) => {
    const found = await supervising(c, false);
    if (found instanceof Response) {
      return found;
    }
    const invitation = await findInvitation(database, found.agent.id, clock.now());
    const body: RestAgentInvitationState = {
      invitation: invitation === undefined ? null : restInvitation(invitation),
    };
    return c.json(body);
  });

  // Makes the invitation, in place of the one there was: the code, this once, and the command
  // that sets a machine up with it.
  app.post(ONE, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    const now = clock.now();
    const code = newCode();
    await makeInvitation(database, {
      account: found.agent,
      by:
        found.caller.token === undefined
          ? { id: found.caller.person.id }
          : { id: found.caller.person.id, agent: found.caller.token.name },
      codeHash: hashToken(code),
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY_MS),
      now,
    });
    const invitation = await findInvitation(database, found.agent.id, now);
    if (invitation === undefined) {
      throw new Error("the invitation made was not found");
    }
    // Who invited which account; never the code.
    logger.info(
      { person: found.caller.person.id, agent: found.agent.id, requestId: c.get("requestId") },
      "an agent account was invited to a machine",
    );
    const body: RestAgentInvitationMade = {
      invitation: restInvitation(invitation),
      code,
      command: setupCommandOf(origin, code),
    };
    return c.json(body, 201);
  });

  app.delete(ONE, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    await revokeInvitation(database, found.agent.id);
    logger.info(
      { person: found.caller.person.id, agent: found.agent.id, requestId: c.get("requestId") },
      "an agent account's invitation was taken away",
    );
    return c.body(null, 204);
  });

  // What a code opens, for whoever holds it, signed in or not: which account the setup is for,
  // the login it signs in with, and the services of its workspace. Nothing secret, and nothing
  // by which the account is entered.
  app.get(`${REST_ROUTES.setup}/:code`, async (c) => {
    c.header("cache-control", "no-store");
    const code = normalizeConnectCode(c.req.param("code"));
    if (code === undefined) {
      return nowhere(c);
    }
    const found = await workspace();
    const invited = await accountOfInvitation(database, found.id, hashToken(code), clock.now());
    if (invited === undefined || invited.account.handle === undefined) {
      return nowhere(c);
    }
    const settings = await readWorkspaceSettings(database, found.id);
    const { account } = invited;
    const body: RestAgentSetup = {
      account: {
        handle: invited.account.handle,
        name: account.name ?? null,
        title: account.title ?? null,
        login: account.login,
        host: account.host as ProviderKey,
        avatarParts: account.avatarParts ?? null,
      },
      workspace: {
        name: found.name,
        handle: settings.handle,
        domain: settings.domain,
        services: { ...settings.services },
      },
      console: { url: origin },
      expiresAt: invited.expiresAt.toISOString(),
    };
    return c.json(body);
  });
}
