// The agent accounts' routes (docs/specs/rest.md, "Agent accounts"; ADR-0084). An agent account
// is a member, so everything a member is asked or told goes through the board's own routes; what
// is here is what only an agent account has. Every route runs as the board's do: parse, ask who
// is asking and whether they may, then do the work; what the asker may not see is not found.

import { randomBytes } from "node:crypto";
import {
  DEFAULT_PROPOSALS,
  isHandle,
  MAX_AGENT_ELSEWHERE,
  MAX_LANGUAGE_TAG_LENGTH,
  MAX_PROPOSALS,
  onboardingOf,
  type ProviderKey,
  proposeAgents,
  RESERVED_HANDLES,
  REST_ROUTES,
  type RestAgentProposals,
  type RestAgents,
  type RestAvatarParts,
  type RestManager,
  type RestSessions,
  restAgentInputSchema,
  restAgentPatchSchema,
  rollAvatar,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type AccessSettings,
  configuresWorkspace,
  personVisibleTo,
  supervises,
} from "../auth/policy.js";
import type { Sessions } from "../auth/sessions.js";
import type { Database } from "../db/client.js";
import { findRunner, runnersOf, setAgentHours } from "../db/queries/agent-runners.js";
import {
  AgentError,
  type AgentReader,
  accountsOfAgent,
  createAgentAccount,
  findAgent,
  listAgents,
  recordAgentAccounts,
  takenHandles,
  updateAgentPersona,
} from "../db/queries/agents.js";
import type { Actor } from "../db/queries/events.js";
import {
  findPerson,
  listAdministrators,
  PersonError,
  type PersonRecord,
} from "../db/queries/people.js";
import { findProjectByKey } from "../db/queries/plugin-board.js";
import { createTask } from "../db/queries/tasks.js";
import type { TokenRecord } from "../db/queries/tokens.js";
import { readWorkspaceSettings } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { errorBody } from "./app.js";
import {
  type Access,
  administratorRequired,
  foreignOrigin,
  sessionRequired,
  signInRequired,
} from "./auth.js";
import type { AppEnv } from "./request-context.js";
import { restAgent, restPerson, restSession } from "./rest-shapes.js";

export interface AgentsRestDependencies {
  readonly database: Database;
  readonly access: Access;
  /** Where members are signed in; nothing where nobody signs in. */
  readonly sessions: Sessions | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The providers people sign in through: what an account may name. None where nobody signs in. */
  readonly signIn: readonly ProviderKey[];
}

const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Caller {
  readonly person: PersonRecord;
  readonly token: TokenRecord | undefined;
}

/** A seed of the console's own for a persona: twelve characters nobody chose. */
const freshSeed = (): string => randomBytes(9).toString("base64url");

/** The avatar an account is made with: the parts as they were chosen, else rolled from the seed given or from one of the console's own. */
function personaOf(input: {
  readonly avatarSeed?: string | undefined;
  readonly avatarParts?: RestAvatarParts | undefined;
}): { readonly avatarSeed: string | undefined; readonly avatarParts: RestAvatarParts } {
  if (input.avatarParts !== undefined) {
    return { avatarSeed: input.avatarSeed, avatarParts: input.avatarParts };
  }
  const avatarSeed = input.avatarSeed ?? freshSeed();
  return { avatarSeed, avatarParts: rollAvatar(avatarSeed) };
}

/** The first thing wrong with what was sent, for a person. */
function problemOf(
  issues: readonly { readonly path?: PropertyKey[]; readonly message: string }[],
): string {
  const issue = issues[0];
  if (issue === undefined) {
    return "The request is not readable.";
  }
  const path = (issue.path ?? []).map(String).join(".");
  return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}

/** Who a change is attributed to: the person, and the agent they act as when with a token. */
const actorOf = (caller: Caller): Actor =>
  caller.token === undefined
    ? { id: caller.person.id }
    : { id: caller.person.id, agent: caller.token.name };

export function registerAgentsRest(app: Hono<AppEnv>, dependencies: AgentsRestDependencies): void {
  const { database, access, sessions, clock, logger, signIn } = dependencies;

  /** Who is asking and with what, or the refusal to answer with. */
  const asking = async (c: Context<AppEnv>): Promise<Caller | Response> =>
    (await access.caller(c)) ?? signInRequired(c);
  /** Who is asking something that changes the board: from the console's own pages on a session, or with a token. */
  const changing = async (c: Context<AppEnv>): Promise<Caller | Response> => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    return asking(c);
  };
  /** How the asker reads the agent accounts: whom they may see as a member, and whom they supervise. */
  const readerOf = (person: PersonRecord, settings: AccessSettings): AgentReader => ({
    visible: personVisibleTo(person, settings),
    supervises: supervises(person),
  });
  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);
  const notFound = (c: Context<AppEnv>): Response =>
    c.json(errorBody("agent.not_found", "The agent account was not found."), 404);
  /** The handle in the path, or nothing for text that is not one. */
  const handleOf = (c: Context<AppEnv>): string | undefined => {
    const handle = c.req.param("handle") ?? "";
    return isHandle(handle) && !RESERVED_HANDLES.includes(handle) ? handle : undefined;
  };
  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  const failure = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof AgentError) {
      const status =
        error.code === "agent.not_found"
          ? 404
          : error.code === "agent.invalid_manager" || error.code === "agent.invalid_project"
            ? 400
            : 409;
      return c.json(errorBody(error.code, error.message), status);
    }
    if (error instanceof PersonError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "person.not_found" ? 404 : 409,
      );
    }
    throw error;
  };

  // Whom whoever asks reports to (ADR-0084): a person or an agent account, or nobody; and the
  // administrators, who stand in where there is nobody. For every member: a manager is whom one
  // turns to first, and anyone may need to know who that is.
  app.get(REST_ROUTES.meManager, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    const [manager, administrators] = await Promise.all([
      person.managerId === undefined
        ? undefined
        : findPerson(database, person.workspaceId, person.managerId),
      listAdministrators(database, person.workspaceId),
    ]);
    const body: RestManager = {
      manager: manager === undefined ? null : restPerson(manager),
      administrators: administrators.map(restPerson),
    };
    return c.json(body);
  });

  /**
   * The agent account a supervisor asks about on the console's own pages, or the refusal: where
   * an account is signed in is seen and ended as a person's own sessions are, by a person signed
   * in and never with a token (board #309), so that a credential which leaks reaches nobody's
   * sessions; and of an agent account by its supervisors alone (ADR-0084).
   */
  const supervising = async (
    c: Context<AppEnv>,
    changes: boolean,
  ): Promise<{ readonly person: PersonRecord; readonly agent: PersonRecord } | Response> => {
    if (access.presentsToken(c)) {
      return sessionRequired(c);
    }
    const caller = await (changes ? changing(c) : asking(c));
    if (caller instanceof Response) {
      return caller;
    }
    const handle = handleOf(c);
    const settings = await readWorkspaceSettings(database, caller.person.workspaceId);
    const found =
      handle === undefined
        ? undefined
        : await findAgent(
            database,
            caller.person.workspaceId,
            handle,
            readerOf(caller.person, settings),
          );
    if (found === undefined) {
      return notFound(c);
    }
    if (!found.supervised) {
      return c.json(
        errorBody("auth.forbidden", "Only a supervisor of the agent account may do this."),
        403,
      );
    }
    return { person: caller.person, agent: found.person };
  };

  app.get(`${REST_ROUTES.agents}/:handle/sign-ins`, async (c) => {
    const found = await supervising(c, false);
    if (found instanceof Response) {
      return found;
    }
    if (sessions === undefined) {
      return signInRequired(c);
    }
    const body: RestSessions = {
      items: (await sessions.listOf(found.agent)).map(restSession),
      idleDays: sessions.idleDays,
    };
    return c.json(body);
  });

  app.delete(`${REST_ROUTES.agents}/:handle/sign-ins/:id`, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id");
    const outcome =
      sessions === undefined || !UUID.test(id)
        ? undefined
        : await sessions.endOne(found.agent, id, undefined);
    if (outcome === undefined || !outcome.ended) {
      return c.json(errorBody("session.not_found", "The session was not found."), 404);
    }
    logger.info(
      {
        person: found.person.id,
        agent: found.agent.id,
        sessionId: id,
        requestId: c.get("requestId"),
      },
      "an agent account's session ended by a supervisor",
    );
    return c.body(null, 204);
  });

  // The agent accounts the asker may see, as the people are seen: everything that lists people
  // lists them among it, and this lists them alone, with whom each reports to.
  app.get(REST_ROUTES.agents, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    const settings = await readWorkspaceSettings(database, person.workspaceId);
    const agents = await listAgents(database, person.workspaceId, readerOf(person, settings));
    // How each stands, for whoever sees it; what its runner said, for its supervisors and itself.
    const runners = await runnersOf(
      database,
      agents.map((agent) => agent.person.id),
    );
    const body: RestAgents = {
      items: agents.map((agent) =>
        restAgent(
          agent,
          runners.get(agent.person.id),
          agent.supervised || agent.person.id === person.id,
        ),
      ),
    };
    return c.json(body);
  });

  /**
   * The onboarding of an account just made (ADR-0088, points 4 and 5): its first task, in the
   * project it starts in, with the account as its worker and whoever made the account as its
   * owner, in the words of the workspace's services. The board wakes the account with it, as
   * with any ready task it is at work on (ADR-0085), and the wake waits on the account's record
   * until a runner first connects.
   */
  const onboard = async (
    caller: Caller,
    account: PersonRecord,
    projectKey: string,
  ): Promise<{ project: string; number: number } | null> => {
    const handle = account.handle;
    const project = await findProjectByKey(database, account.workspaceId, projectKey);
    if (handle === undefined || project === undefined) {
      return null;
    }
    const settings = await readWorkspaceSettings(database, account.workspaceId);
    const words = onboardingOf({ handle, workspace: settings });
    const task = await createTask(database, {
      scope: { workspaceId: account.workspaceId, projectId: project.id },
      actor: actorOf(caller),
      task: { title: words.title, body: words.body, state: "ready", workerIds: [account.id] },
      now: clock.now(),
    });
    return { project: projectKey, number: task.number };
  };

  // An administrator makes an agent account (ADR-0084), signed in or through their agent's
  // token (ADR-0021): the member's row at once, and the login let in.
  app.post(REST_ROUTES.agents, tooLarge, async (c) => {
    const caller = await changing(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    if (!configuresWorkspace(person)) {
      return administratorRequired(c);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restAgentInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const input = parsed.data;
    if (!signIn.includes(input.host)) {
      return c.json(
        errorBody("agent.unknown_host", "Nobody signs in through that provider here."),
        400,
      );
    }
    try {
      const agent = await createAgentAccount(database, {
        workspaceId: person.workspaceId,
        actor: actorOf(caller),
        host: input.host,
        login: input.login,
        handle: input.handle,
        name: input.name,
        title: input.title ?? undefined,
        // The parts as they were chosen; else rolled, from the seed given or one of the console's own.
        ...personaOf(input),
        // Whoever makes it answers for it, unless they name another.
        managerId: input.managerId ?? person.id,
        projectKey: input.project,
        convert: input.convert === true,
        now: clock.now(),
      });
      logger.info(
        { person: person.id, agent: agent.person.id, requestId: c.get("requestId") },
        "an agent account was made",
      );
      const onboarding = await onboard(caller, agent.person, input.project).catch(
        (error: unknown) => {
          // The account is made: its first task is the console's courtesy, and a board that
          // takes no more tasks does not unmake it.
          logger.warn(
            { agent: agent.person.id, err: error, requestId: c.get("requestId") },
            "the onboarding task of an agent account was not made",
          );
          return null;
        },
      );
      return c.json(restAgent(agent, undefined, false, { onboarding }), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // A few personas to choose from, for whoever makes an account (ADR-0084): a name in the
  // language asked for, a handle nobody has, and an avatar, rolled again at each asking. A
  // suggestion: what is sent to make the account is whatever its maker settled on.
  app.get(`${REST_ROUTES.agents}/proposals`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    if (!configuresWorkspace(person)) {
      return administratorRequired(c);
    }
    const asked = c.req.query("count");
    const count = asked === undefined ? DEFAULT_PROPOSALS : Number(asked);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PROPOSALS) {
      return invalid(c, `count: must be a whole number from 1 to ${MAX_PROPOSALS}`);
    }
    const lang = c.req.query("lang");
    if (
      lang !== undefined &&
      (lang.length > MAX_LANGUAGE_TAG_LENGTH || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang))
    ) {
      return invalid(c, "lang: must be a language tag");
    }
    const settings = await readWorkspaceSettings(database, person.workspaceId);
    const body: RestAgentProposals = {
      items: proposeAgents(
        Array.from({ length: count }, () => freshSeed()),
        {
          // The language asked for; else the asker's own, else the workspace's (ADR-0081).
          lang: lang ?? person.language ?? settings.language ?? undefined,
          taken: await takenHandles(database, person.workspaceId),
        },
      ),
    };
    return c.json(body);
  });

  // A supervisor keeps the account's persona (ADR-0084): its name, its title, its avatar.
  app.patch(`${REST_ROUTES.agents}/:handle`, tooLarge, async (c) => {
    const caller = await changing(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    const handle = handleOf(c);
    if (handle === undefined) {
      return notFound(c);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restAgentPatchSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const settings = await readWorkspaceSettings(database, person.workspaceId);
    const reader = readerOf(person, settings);
    // An account the asker may see and does not supervise is theirs to read, not to keep. The
    // accounts it holds elsewhere are the one thing the account records of itself.
    const seen = await findAgent(database, person.workspaceId, handle, reader);
    if (seen === undefined) {
      return notFound(c);
    }
    // The accounts it holds elsewhere and the hours of its day are what the account keeps of
    // itself, as its supervisors may; its persona is theirs alone.
    const { accounts, dayStart, dayEnd, ...persona } = parsed.data;
    const keepsPersona = Object.values(persona).some((value) => value !== undefined);
    const own = seen.person.id === person.id;
    if (!seen.supervised && (!own || keepsPersona)) {
      return c.json(
        errorBody("auth.forbidden", "Only a supervisor of the agent account may do this."),
        403,
      );
    }
    try {
      const agent = keepsPersona
        ? await updateAgentPersona(database, {
            workspaceId: person.workspaceId,
            actor: actorOf(caller),
            handle,
            reader,
            name: persona.name,
            title: persona.title,
            avatarParts: persona.avatarParts,
            avatarSeed: persona.avatarSeed,
            now: clock.now(),
          })
        : seen;
      const held =
        accounts === undefined
          ? await accountsOfAgent(database, agent.person.id)
          : await recordAgentAccounts(database, {
              workspaceId: person.workspaceId,
              actor: actorOf(caller),
              account: agent.person,
              accounts,
              limit: MAX_AGENT_ELSEWHERE,
              now: clock.now(),
            });
      const runner =
        dayStart === undefined && dayEnd === undefined
          ? await findRunner(database, agent.person.id)
          : await setAgentHours(database, {
              account: agent.person,
              actor: actorOf(caller),
              dayStart,
              dayEnd,
              now: clock.now(),
            });
      return c.json(restAgent(agent, runner, true, { accounts: held }));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.agents}/:handle`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    const handle = handleOf(c);
    if (handle === undefined) {
      return notFound(c);
    }
    const settings = await readWorkspaceSettings(database, person.workspaceId);
    const agent = await findAgent(database, person.workspaceId, handle, readerOf(person, settings));
    if (agent === undefined) {
      return notFound(c);
    }
    return c.json(
      restAgent(
        agent,
        await findRunner(database, agent.person.id),
        agent.supervised || agent.person.id === person.id,
        { accounts: await accountsOfAgent(database, agent.person.id) },
      ),
    );
  });
}
