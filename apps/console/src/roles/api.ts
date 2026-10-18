import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import process from "node:process";
import { EVENTS_PAGE_LIMIT, MAX_TOKENS_PER_PERSON } from "@skillcdn/console/api";
import { loadWebRoot, type WebRoot, WebRootError } from "@skillcdn/console/web";
import type { Hono } from "hono";
import { createContainerCredentials } from "../adapters/container-credentials.js";
import { createDirectorySource } from "../adapters/directory-packs.js";
import { createGitHubProvider } from "../adapters/github-login.js";
import { createGitHubOrganization } from "../adapters/github-organization.js";
import { createGoogleProvider } from "../adapters/google-login.js";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { createS3BlobStore } from "../adapters/s3-blob-store.js";
import { createSkillCdnSource } from "../adapters/skillcdn.js";
import { systemClock } from "../adapters/system-clock.js";
import { Connections } from "../auth/connect.js";
import { Login } from "../auth/login.js";
import { Membership } from "../auth/membership.js";
import { createSecrets } from "../auth/secrets.js";
import { Sessions } from "../auth/sessions.js";
import { Tokens } from "../auth/tokens.js";
import { type AuthConfig, type Config, ConfigError } from "../config/config.js";
import { createDatabase, type Database } from "../db/client.js";
import { startEventListener } from "../db/listener.js";
import { ensureWorkspace, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { createApp } from "../http/app.js";
import type { AppAuth } from "../http/auth.js";
import { createClientAddressResolver } from "../http/client-address.js";
import { LiveFeed } from "../http/live-feed.js";
import type { AppEnv } from "../http/request-context.js";
import { startServer } from "../http/server.js";
import { Archivist } from "../jobs/archivist.js";
import { Janitor } from "../jobs/janitor.js";
import { OrganizationSync } from "../jobs/organization-sync.js";
import type { Logger } from "../logger.js";
import { type BlobStore, BlobStoreError } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import { fixedCredentials } from "../ports/credentials.js";
import type { IdentityProvider } from "../ports/identity-provider.js";
import type { OrganizationDirectory } from "../ports/organization.js";
import type { PackSource } from "../ports/skill-source.js";
import { Skills, type SkillsConfig } from "../skills.js";
import { APP_NAME, APP_VERSION } from "../version.js";

/** How often what time has ended is removed, when this process does the worker's work. */
const JANITOR_INTERVAL_MS = 15 * 60_000;
/** How often what was done or dropped long enough ago is put away (ADR-0029), the same way. */
const ARCHIVE_INTERVAL_MS = 60 * 60_000;
/** How often the organization is read, when this process does the worker's work. */
export const ORGANIZATION_SYNC_INTERVAL_MS = 10 * 60_000;
/** How long a feed subscriber waits in silence before a heartbeat: under what proxies allow idle. */
const FEED_HEARTBEAT_MS = 25_000;
/** How long a subscriber goes without asking, nudge or no nudge: a missed nudge costs this much. */
const FEED_POLL_MS = 15_000;
/** How long a read of a decision may hold its request for the answer: under what proxies allow. */
const DECISION_WAIT_MS = 50_000;

export interface ApiPorts {
  readonly database: Database;
  /** The identity providers people sign in through. Needed, with `auth` configured, for anyone to. */
  readonly providers?: readonly IdentityProvider[] | undefined;
  /** The organization at the git host whose members are in (ADR-0022). Left out, none vouches. */
  readonly organization?: OrganizationDirectory | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly isShuttingDown: () => boolean;
  /** A loaded build of the default UI. Left out, the server is API only. */
  readonly web?: WebRoot | undefined;
  /** Where the bytes of files handed in are kept. Left out, in the database. */
  readonly blobs?: BlobStore | undefined;
  /** The deployment's side of the packs, where the addresses of a git host are read. Left out, read over HTTPS from the configured deployment. */
  readonly skillSource?: PackSource | undefined;
  /** Where packs served from this machine are read (ADR-0031). Left out, the directory the configuration names; without one, a `local` address is asked of the deployment. */
  readonly packDirectory?: PackSource | undefined;
  /** The console's version, which the command is held to (ADR-0025). The package's when left out; for tests. */
  readonly version?: string | undefined;
}

export type ApiConfig = Pick<Config, "workspace"> & {
  /** Left out, nobody signs in. What it needs of the providers arrives through the ports. */
  readonly auth?: Omit<AuthConfig, "github" | "google"> | undefined;
  /** Left out, no proxy is trusted and every request is logged. */
  readonly http?: Pick<
    Config["http"],
    "trustedProxies" | "clientIpHeader" | "requestIdHeader" | "accessLog"
  >;
  /** The timing of the live feed; the built-in values when left out. For tests. */
  readonly feed?: { readonly heartbeatMs?: number; readonly pollMs?: number } | undefined;
  /** How long a read of a decision may wait for its answer; the built-in value when left out. For tests. */
  readonly agents?: { readonly waitMs?: number } | undefined;
  /** The organization's skills, and the directory packs served from this machine are read from. Left out: no address, the public deployment, no directory. */
  readonly skills?: (SkillsConfig & { readonly directory?: string | undefined }) | undefined;
};

/**
 * The workspace of this deployment, found once and kept. A failure is not kept: the next
 * request asks again.
 */
export function workspaceResolver(
  database: Database,
  clock: Clock,
  name: string,
): () => Promise<WorkspaceRecord> {
  let found: Promise<WorkspaceRecord> | undefined;
  return () => {
    if (found === undefined) {
      found = ensureWorkspace(database, { name, now: clock.now() }).catch((error: unknown) => {
        found = undefined;
        throw error;
      });
    }
    return found;
  };
}

/** Wires the services of the `api` role to their ports. Tests call this with their own ports. */
export function createApi(
  config: ApiConfig,
  ports: ApiPorts,
): { readonly app: Hono<AppEnv>; readonly auth: AppAuth | undefined; readonly feed: LiveFeed } {
  const { database, clock, logger } = ports;
  const workspace = workspaceResolver(database, clock, config.workspace.name);

  // People sign in only where the deployment is configured for it and a provider can be asked
  // who they are. Everything that follows from it hangs off this one value: without it there
  // are no sessions, and the board is nobody's.
  let auth: AppAuth | undefined;
  const providers = ports.providers ?? [];
  if (config.auth !== undefined && providers.length > 0) {
    const origin = config.auth.publicUrl;
    const secure = origin.startsWith("https://");
    const membership = new Membership({
      admins: config.auth.admins,
      domains: config.auth.domains,
      organization: ports.organization,
      logger,
    });
    if (membership.empty) {
      // People let in on the People page still get in; the first administrator cannot.
      logger.warn(
        "signing in is configured, and the configuration lets nobody in: name ADMINS, or a Workspace domain, so that the first administrator can sign in",
      );
    }
    const sessions = new Sessions({
      database,
      clock,
      logger,
      ttlMs: config.auth.sessionTtlMs,
      secure,
    });
    const secrets = createSecrets(config.auth.secret);
    const tokens = new Tokens({
      database,
      clock,
      logger,
      limit: MAX_TOKENS_PER_PERSON,
      daysAtMost: config.auth.tokenDaysAtMost,
    });
    auth = {
      origin,
      sessions,
      tokens,
      secrets,
      connections: new Connections({
        database,
        clock,
        logger,
        tokens,
        workspaceId: async () => (await workspace()).id,
        // The page of the default UI for a code (ADR-0010); a custom console serves it where it likes.
        pageFor: (code) => `${origin}/connect/${code}`,
      }),
      membership,
      organization: ports.organization,
      logins: new Map(
        providers.map((provider) => [
          provider.key,
          new Login({
            database,
            workspaceId: async () => (await workspace()).id,
            provider,
            membership,
            sessions,
            secrets,
            clock,
            logger,
            origin,
            secure,
          }),
        ]),
      ),
      providers: providers.map((provider) => ({ key: provider.key, label: provider.label })),
    };
  }

  const feed = new LiveFeed({
    database,
    pageLimit: EVENTS_PAGE_LIMIT,
    heartbeatMs: config.feed?.heartbeatMs ?? FEED_HEARTBEAT_MS,
    pollMs: config.feed?.pollMs ?? FEED_POLL_MS,
  });

  const skillsConfig = config.skills ?? { source: "https://skillcdn.ai", address: undefined };
  const skills = new Skills({
    config: skillsConfig,
    deployment:
      ports.skillSource ??
      createSkillCdnSource({
        baseUrl: skillsConfig.source,
        userAgent: `${APP_NAME}/${APP_VERSION}`,
        logger,
      }),
    directory:
      ports.packDirectory ??
      (config.skills?.directory === undefined
        ? undefined
        : createDirectorySource({ root: config.skills.directory, clock, logger })),
    clock,
    logger,
  });

  const app = createApp({
    database,
    workspace,
    auth,
    feed,
    blobs: ports.blobs ?? createPgBlobStore(database),
    skills,
    web: ports.web,
    version: ports.version ?? APP_VERSION,
    clock,
    logger,
    isShuttingDown: ports.isShuttingDown,
    agents: { waitMs: config.agents?.waitMs ?? DECISION_WAIT_MS },
    requests: {
      addresses: createClientAddressResolver({
        trustedProxies: config.http?.trustedProxies ?? [],
        header: config.http?.clientIpHeader ?? "x-forwarded-for",
      }),
      requestIdHeader: config.http?.requestIdHeader ?? "x-request-id",
      accessLog: config.http?.accessLog ?? true,
      newRequestId: randomUUID,
      now: () => performance.now(),
    },
  });
  return { app, auth, feed };
}

/**
 * Where the bytes of files go: the bucket when one is configured, with the rows of the database
 * behind it for what was kept there before; else the rows. A bucket that is not there, or is
 * served from elsewhere, is a setting to fix before anything else runs; one that does not
 * answer is reported, and tried again with the first file.
 */
async function blobStoreOf(
  config: Config,
  database: Database,
  logger: Logger,
  userAgent: string,
): Promise<BlobStore> {
  const rows = createPgBlobStore(database);
  const bucket = config.blobs.bucket;
  if (bucket === undefined) {
    return rows;
  }
  const credentials =
    bucket.credentials.kind === "keys"
      ? fixedCredentials({
          accessKeyId: bucket.credentials.accessKeyId,
          secretAccessKey: bucket.credentials.secretAccessKey,
          sessionToken: bucket.credentials.sessionToken,
        })
      : createContainerCredentials({
          url: bucket.credentials.url,
          authorization: bucket.credentials.authorization,
          authorizationFile: bucket.credentials.authorizationFile,
          clock: systemClock,
          logger,
        });
  const store = createS3BlobStore({
    endpoint: bucket.endpoint,
    bucket: bucket.bucket,
    region: bucket.region,
    credentials,
    keyPrefix: bucket.keyPrefix,
    pathStyle: bucket.pathStyle,
    clock: systemClock,
    logger,
    userAgent,
    before: rows,
  });
  try {
    await store.probe();
    logger.info(
      { bucket: bucket.bucket, endpoint: bucket.endpoint, credentials: bucket.credentials.kind },
      "files go to the bucket",
    );
  } catch (error) {
    if (
      error instanceof BlobStoreError &&
      (error.kind === "bucket_not_found" || error.kind === "misplaced")
    ) {
      throw new ConfigError([`S3_BUCKET: ${error.message}`]);
    }
    logger.warn(
      { err: error, bucket: bucket.bucket },
      "the bucket did not answer at start; files go to it once it does",
    );
  }
  return store;
}

/** Resolves on the first of the signals a platform stops a container with. */
export function shutdownSignal(): Promise<string> {
  return new Promise((resolve) => {
    process.once("SIGTERM", () => resolve("SIGTERM"));
    process.once("SIGINT", () => resolve("SIGINT"));
  });
}

/**
 * The composition root of the `api` role: builds the dependency graph, serves HTTP, and owns
 * shutdown. Resolves when the process has shut down cleanly.
 */
export async function runApi(config: Config, logger: Logger): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    ca: config.database.ca,
    maxConnections: config.database.poolMax,
    applicationName: `${APP_NAME}-api`,
  });
  const userAgent = `${APP_NAME}/${APP_VERSION}`;
  const providers: IdentityProvider[] = [];
  if (config.auth?.github !== undefined) {
    providers.push(
      createGitHubProvider({
        webUrl: config.auth.github.webUrl,
        apiUrl: config.auth.github.apiUrl,
        clientId: config.auth.github.clientId,
        clientSecret: config.auth.github.clientSecret,
        userAgent,
      }),
    );
  }
  if (config.auth?.google !== undefined) {
    providers.push(
      createGoogleProvider({
        clientId: config.auth.google.clientId,
        clientSecret: config.auth.google.clientSecret,
        domain: config.auth.google.domain,
        userAgent,
      }),
    );
  }
  const organization = organizationOf(config, userAgent);
  let web: WebRoot | undefined;
  if (config.web.root !== undefined) {
    try {
      web = await loadWebRoot(config.web.root);
    } catch (error) {
      if (error instanceof WebRootError) {
        // A setting that points at the wrong place, not a failure of the process.
        throw new ConfigError([`WEB_ROOT: ${error.message}`]);
      }
      throw error;
    }
    logger.info({ files: web.files }, "serving the UI");
  }
  if (config.skills.directory !== undefined) {
    // A setting that points at the wrong place, not a failure of the process; a pack that is
    // not there is found out when it is read.
    const info = await stat(config.skills.directory).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) {
      throw new ConfigError([
        `SKILLS_DIR: not a directory that can be read: ${config.skills.directory}`,
      ]);
    }
    logger.info(
      { directory: config.skills.directory },
      "packs served from this machine are read from the directory",
    );
  }
  const blobs = await blobStoreOf(config, database, logger, userAgent);
  let shuttingDown = false;
  const { app, feed } = createApi(config, {
    database,
    providers,
    organization,
    clock: systemClock,
    logger,
    isShuttingDown: () => shuttingDown,
    web,
    blobs,
  });
  // What any process changes reaches this one's subscribers through the database's own channel.
  const listener = startEventListener({
    connectionString: config.database.url,
    ca: config.database.ca,
    logger,
    onNudge: () => feed.nudge(),
  });
  // A single-container install has no worker; the flag makes this process carry its work.
  const janitor = config.worker.inProcess
    ? new Janitor({ database, clock: systemClock, logger })
    : undefined;
  janitor?.start(JANITOR_INTERVAL_MS);
  const archivist =
    config.worker.inProcess && config.worker.archiveAfterDays > 0
      ? new Archivist({
          database,
          clock: systemClock,
          logger,
          afterDays: config.worker.archiveAfterDays,
        })
      : undefined;
  archivist?.start(ARCHIVE_INTERVAL_MS);
  const workspace = workspaceResolver(database, systemClock, config.workspace.name);
  const sync =
    config.worker.inProcess && organization !== undefined
      ? new OrganizationSync({
          database,
          organization,
          workspaceId: async () => (await workspace()).id,
          clock: systemClock,
          logger,
        })
      : undefined;
  if (sync !== undefined) {
    void sync.sync();
    sync.start(ORGANIZATION_SYNC_INTERVAL_MS);
  }

  const server = await startServer({
    fetch: app.fetch,
    host: config.http.host,
    port: config.http.port,
    keepAliveMs: config.http.keepAliveMs,
    requestTimeoutMs: config.http.requestTimeoutMs,
    logger,
  });
  logger.info(
    {
      host: config.http.host,
      port: server.port,
      worker: config.worker.inProcess,
      signIn: providers.map((provider) => provider.key),
    },
    "api listening",
  );

  const signal = await shutdownSignal();
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  // Readiness fails from here on; the feed lets its streams go, the listener stops accepting,
  // requests in flight finish.
  feed.close();
  await server.close(config.http.shutdownGraceMs);
  await listener.close();
  await janitor?.close();
  await archivist?.close();
  await sync?.close();
  await database.close();
  logger.info("shutdown complete");
}

/** The organization at the git host, read through the app the configuration names, or none. */
export function organizationOf(
  config: Config,
  userAgent: string,
): OrganizationDirectory | undefined {
  const github = config.auth?.github;
  if (github?.organization === undefined) {
    return undefined;
  }
  return createGitHubOrganization({
    apiUrl: github.apiUrl,
    organization: github.organization.name,
    appId: github.organization.appId,
    privateKey: github.organization.privateKey,
    userAgent,
    clock: systemClock,
  });
}
