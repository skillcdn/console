# deploy/

Everything needed to build the image and hand it to whatever runs it. This repository stops at an image that builds: publishing images, registries, deployment pipelines, infrastructure definitions, DNS, TLS and rollout live outside it ([ADR-0002](../docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md), [AGENTS.md](../AGENTS.md) rule 8).

| File | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | The one multi-stage image. Roles `api`, `worker` and `migrate` are selected by the container command. |
| [`compose.dev.yaml`](compose.dev.yaml) | Local development dependencies (PostgreSQL 18 on `127.0.0.1:5433`, next to a SkillCDN development database on 5432). Not a production topology. |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, build, typecheck, tests (integration tests run against a PostgreSQL service container), a secret scan, and an image build that is then exercised: exit codes, `migrate`, readiness, the page, non-root user, clean shutdown. It needs no secrets. |

A release workflow for the package arrives with its first publish ([roadmap](../docs/roadmap.md)).

## The image

One multi-stage image, non-root, production dependencies only, no secrets and no configuration baked in. It carries the server, the migrations and the default UI (`WEB_ROOT=/app/web`; set it to an empty value to run without a UI). The container command selects the role:

```sh
docker build -f deploy/Dockerfile -t skillcdn-console .    # from the repository root
docker run --rm --env-file .env skillcdn-console migrate    # one-off role, before a new version rolls out
docker run --rm -p 11199:11199 --env-file .env skillcdn-console api
docker run --rm --env-file .env skillcdn-console worker
```

## Environment contract

The console is configured only through environment variables. [`.env.example`](../.env.example) is the source of truth; this table adds what operators need to know. Both are updated in the same change as the config module. A variable that is set to an empty value counts as unset; a value that does not parse stops the process at boot with exit code `78` and the names of the variables at fault, never their values.

| Variable | Roles | Required | Secret | Notes |
|---|---|---|---|---|
| `NODE_ENV` | all | no | no | The image sets `production`. |
| `LOG_LEVEL` | all | no | no | Default `info`. |
| `HOST`, `PORT` | `api` | no | no | Defaults `0.0.0.0` and `11199`. |
| `SHUTDOWN_GRACE_SECONDS` | `api` | no | no | Default `20`. Keep the platform's stop timeout above it. |
| `HTTP_KEEP_ALIVE_SECONDS`, `HTTP_REQUEST_TIMEOUT_SECONDS` | `api` | no | no | Defaults `65` and `60`. See [Behind a reverse proxy](#behind-a-reverse-proxy). |
| `ACCESS_LOG` | `api` | no | no | Default `true`: one log line per request, probes excluded, with the client address and the user agent and never the query string. Keep the log only as long as your privacy policy says, or turn it off. |
| `TRUSTED_PROXIES` | `api` | no | no | Addresses or CIDR networks whose forwarding headers are believed. Default: none. |
| `CLIENT_IP_HEADER`, `REQUEST_ID_HEADER` | `api` | no | no | Defaults `x-forwarded-for` and `x-request-id`. Read only from trusted proxies. |
| `DATABASE_URL` | all | yes | **yes** | PostgreSQL connection string. |
| `DATABASE_POOL_MAX` | `api` | no | no | Default `10` connections per process. |
| `WORKSPACE_NAME` | `api`, `worker` | no | no | What the board is called. Default `Console`. The workspace row is made at boot by whichever role comes first and renamed from here. |
| `WORKER_IN_PROCESS` | `api` | no | no | Default `false`. `true` makes the `api` role carry the worker's work itself, for an install with one container and no `worker`. |
| `PUBLIC_URL` | `api` | no | no | The origin people use, such as `https://console.example.com`, without a path. Required for signing in: it is where a provider sends people back, what the session cookie is bound to, and what requests that change something must come from. See [Signing in](#signing-in). |
| `GITHUB_CLIENT_ID` | `api` | no | no | The client id of the GitHub OAuth app (or GitHub App) people sign in through. With `GITHUB_CLIENT_SECRET`: both or neither. |
| `GITHUB_CLIENT_SECRET` | `api` | no | **yes** | Its client secret. |
| `AUTH_SECRET` | `api` | no | **yes** | What a sign-in in flight is sealed with. At least 32 characters, the same on every replica. Signing in exists only when this, `PUBLIC_URL` and at least one provider's client id and secret are set; setting some of them is a configuration error. |
| `MEMBERS` | `api` | no | no | Who may sign in: logins at GitHub, addresses at Google, comma-separated, compared without regard to case. Checked at sign-in and on every request after. Empty lets nobody in unless a Workspace domain does, and is logged at boot. |
| `GITHUB_WEB_URL`, `GITHUB_API_URL` | `api` | no | no | Defaults `https://github.com` and `https://api.github.com`. GitHub Enterprise Server: `https://<host>` and `https://<host>/api/v3`. |
| `GOOGLE_CLIENT_ID` | `api` | no | no | The client id of the OAuth client registered at Google for signing in. With `GOOGLE_CLIENT_SECRET`: both or neither. |
| `GOOGLE_CLIENT_SECRET` | `api` | no | **yes** | Its client secret. |
| `GOOGLE_WORKSPACE_DOMAIN` | `api` | no | no | A Google Workspace domain whose accounts are all members, as Google vouches for them at sign-in, besides whoever `MEMBERS` lists; also the domain offered at the account picker. Needs the Google client. |
| `ADMINS` | `api` | no | no | Who configures the board: logins among `MEMBERS`, comma-separated. Made administrators when they sign in; an administrator may make or unmake others on the People page, and the board keeps at least one. Empty: nobody, until someone is listed. |
| `SESSION_TTL_DAYS` | `api` | no | no | How long a browser stays signed in without being used. Default `30`. |
| `WEB_ROOT` | `api` | no | no | Directory of a build of the default UI. The image sets `/app/web`; set it to an empty value to run without a UI. A directory without an `index.html` is a configuration error. |

Every secret `NAME` may also be supplied as `NAME_FILE`, so container secret mounts work.

## What a platform must provide

Written so that a cloud deployment is the image as containers, a managed PostgreSQL and a bucket, and nothing else:

- **Secrets at runtime**, as environment variables or mounted files; never as build arguments.
- **A managed PostgreSQL** reachable from the containers; `migrate` runs once per rollout, before the new `api` and `worker` start, and migrations follow expand, then contract, across separate releases.
- **Object storage with the S3 API** for what runs hand in, once the S3 implementation of the blob-store port lands; until then the bytes live in PostgreSQL.
- **Health probes** on `GET /healthz` (liveness) and `GET /readyz` (readiness), and a stop timeout above the shutdown grace period, so that `SIGTERM` lets requests in flight finish.
- **Logs from stdout**, JSON, one line per event; they never contain tokens or what an agent handed in.
- **A reverse proxy or load balancer** that terminates TLS and limits requests per client; the image does neither.

## Signing in

People sign in through an identity provider the organization already uses: GitHub, Google (Workspace), or both. For GitHub, register an OAuth app at the host (or use a GitHub App's own client id and secret): its homepage is `PUBLIC_URL`, and its authorization callback URL is `PUBLIC_URL/auth/gh/callback`; no scopes are needed. For Google, register an OAuth client of the web application type in a Google Cloud project, with `PUBLIC_URL/auth/google/callback` as an authorized redirect URI; the console asks for identity only (`openid email profile`). Either way the console asks the provider who the person is, once, and keeps nothing of the credential. Then set the provider's client id and secret, `AUTH_SECRET` (32 random characters or more), `PUBLIC_URL`, and who may use the board: `MEMBERS` (logins at GitHub, addresses at Google), `GOOGLE_WORKSPACE_DOMAIN` for everyone of a Workspace, and `ADMINS`, those among them who configure it.

What the browser holds is a session cookie that scripts cannot read, bound to the host over TLS (`__Host-`); the database holds its hash. A request that changes something must come from the console's own pages: the browser names its origin, and the console compares it with `PUBLIC_URL`. A login taken out of `MEMBERS`, or a domain out of `GOOGLE_WORKSPACE_DOMAIN`, is out on the next request.

An agent, a script or a console of a person's own holds a token instead, made by that person on the console's Tokens page and presented as `Authorization: Bearer`: it is that person for the board's purposes, needs no origin, expires after at most a year or never, as the person chooses, and is removed on the same page. The database holds its hash; a token cannot make tokens; a person holds a bounded number of them. Nothing here needs configuring.

An agent works the board through the `console` command of `@skillcdn/console`, signed in with that token ([docs/specs/cli.md](../docs/specs/cli.md)); nothing of it is configured here. A read of a decision that waits for its answer (`GET /api/v1/decisions/<id>?wait=`) holds its request for up to 50 seconds, so a proxy's read timeout must allow it.

## Behind a reverse proxy

A proxy in front reuses idle connections to the console. `HTTP_KEEP_ALIVE_SECONDS` must be longer than the proxy's own idle timeout, or the proxy now and then sends a request into a connection the console has just closed. `HTTP_REQUEST_TIMEOUT_SECONDS` bounds how long one request may take to arrive in full.

The client address and the request id are read from the proxy's headers only when the proxy's address is in `TRUSTED_PROXIES`; from anyone else, the headers are ignored and the client is the peer. With `x-forwarded-for`, the chain is walked from the nearest proxy and the first address that is not a trusted proxy is the client.

## Process contract

- Exit codes: `64` for a usage error (no role, or an unknown one), `78` for invalid configuration, `70` for a failure the process could not recover from.
- `GET /healthz` is liveness. `GET /readyz` is readiness: the database reachable, the schema at least at the version this build ships, the workspace found, and not shutting down.
- `SIGTERM` or `SIGINT`: readiness fails, the listener stops accepting, requests in flight finish, idle connections close, and the process exits within `SHUTDOWN_GRACE_SECONDS`; what is still open then is cut off.

## Building a release

CI builds the image on every change and exercises it, but publishes nothing. A release is built from a commit of `main` with `docker build -f deploy/Dockerfile`, tagged with that commit, and pushed to whatever registry the deployment uses, by whoever operates it; none of that lives here.

## Rollout contract

1. Build the image from the commit, and run its `migrate` role once against the database, before anything else of the new version starts. Migrations only add (expand); what the previous version reads is removed in a later release (contract), so the old `api` and `worker` keep working while the new ones roll out.
2. Start the new `api` replicas; the platform sends traffic once `GET /readyz` answers `200`, which it does only with the schema of this build applied and the workspace found.
3. Stop the old replicas with `SIGTERM` and a stop timeout above `SHUTDOWN_GRACE_SECONDS`: readiness fails at once, requests in flight finish, the feed's streams end (browsers reconnect to the new replicas on their own, from where they were), and the process exits `0`.
4. Replace the `worker` the same way; a sweep it was in the middle of is the next one's work.

The definitions of a particular deployment (accounts, networks, hostnames, sizes) are not in this repository and must not be added to it.

## Gotchas

- The image build keeps the pnpm store in a BuildKit cache mount, and the `pnpm fetch` layer copies packages out of it. A build that dies halfway (the daemon stopped, the machine went down) can leave a truncated file in the store, and every later build then fails in `pnpm install --offline` with `ERR_PNPM_CMD_SHIM_PARSE_MANIFEST` on some package's `package.json`. Clear the mount and rebuild without the layer cache: `docker builder prune -f --filter type=exec.cachemount`, then `docker build --no-cache ...`.
- `docker stop` sends `SIGTERM`, which the roles handle; `kill` from a Windows shell does not deliver signals to a Node.js process, so a shutdown is only seen in a container or on Linux.
