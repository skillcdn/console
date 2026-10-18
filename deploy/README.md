# deploy/

Everything needed to build the image and hand it to whatever runs it. This repository stops at an image that builds: publishing images, registries, deployment pipelines, infrastructure definitions, DNS, TLS and rollout live outside it ([ADR-0002](../docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md), [AGENTS.md](../AGENTS.md) rule 8).

| File | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | The one multi-stage image. Roles `api`, `worker` and `migrate` are selected by the container command. |
| [`compose.dev.yaml`](compose.dev.yaml) | Local development dependencies (PostgreSQL 18 on `127.0.0.1:5433`, next to a SkillCDN development database on 5432). Not a production topology. |
| [`compose.yaml`](compose.yaml) | The smallest install: the image next to PostgreSQL on one machine, the worker inside the api, the files in the database, the packs read from a directory. For a trial, one machine, or a closed network ([below](#the-smallest-install-and-a-closed-network)). |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, build, typecheck, tests (integration tests run against a PostgreSQL service container), a secret scan, and an image build that is then exercised: exit codes, `migrate`, readiness, the page, the license and the console's own pack in the image, non-root user, clean shutdown. It needs no secrets. |
| [`../.github/workflows/release.yml`](../.github/workflows/release.yml) | Versions and publishes `@skillcdn/console` from the pending changesets: a pull request that bumps the version and the changelog, and, once it is merged, a publish through the registry's trusted publishing, with provenance and no stored secret ([ADR-0007](../docs/adr/0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md)); the version's major and minor are SkillCDN's ([ADR-0034](../docs/adr/0034-the-package-is-versioned-on-skillcdns-line-one-line-at-a-time-with-a-patch-of-its-own.md)). Images are not published from here. |

## The image

One multi-stage image, non-root, production dependencies only, no secrets and no configuration baked in. It carries the server, the migrations and the default UI (`WEB_ROOT=/app/web`; set it to an empty value to run without a UI), and the console's own skills as a pack served from the machine, at `/app/packs/skillcdn/console` under `SKILLS_DIR=/app/packs` ([ADR-0031](../docs/adr/0031-the-console-reads-a-pack-as-the-skillcdn-command-does-and-a-local-one-from-a-directory.md)), with an organization's packs mounted beside it. It writes nothing to its own filesystem at runtime, so a platform may mount the root filesystem read-only. The container command selects the role:

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
| `DATABASE_CA` | all | no | no | The authority the database's certificate is checked against, as PEM, one certificate or a bundle, where the platform's authority is its own: the chain and the host name are verified, as `sslmode=verify-full` does. For a platform that hands a container no files; also as `DATABASE_CA_FILE`. With it, `DATABASE_URL` carries no `ssl` parameters of its own. |
| `WORKSPACE_NAME` | `api`, `worker` | no | no | What the board is called. Default `Console`. The workspace row is made at boot by whichever role comes first and renamed from here. |
| `WORKER_IN_PROCESS` | `api` | no | no | Default `false`. `true` makes the `api` role carry the worker's work itself, for an install with one container and no `worker`. |
| `TASK_ARCHIVE_AFTER_DAYS` | `worker` (`api` with `WORKER_IN_PROCESS`) | no | no | Default `30`. How many days after a task was done or dropped, and last touched, the console puts it away ([ADR-0029](../docs/adr/0029-a-task-done-or-dropped-is-put-away-out-of-the-board-and-open-by-its-number.md)): out of the board and the lists, open by its number. `0` never puts a task away. |
| `PUBLIC_URL` | `api` | no | no | The origin people use, such as `https://console.example.com`, without a path. Required for signing in: it is where a provider sends people back, what the session cookie is bound to, and what requests that change something must come from. See [Signing in](#signing-in). |
| `GITHUB_CLIENT_ID` | `api` | no | no | The client id of the GitHub OAuth app (or GitHub App) people sign in through. With `GITHUB_CLIENT_SECRET`: both or neither. |
| `GITHUB_CLIENT_SECRET` | `api` | no | **yes** | Its client secret. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_ORG` | `api`, `worker` | no | the key: **yes** | The organization at GitHub whose members are all in, read through a GitHub App installed on it with the organization permission Members, read-only ([ADR-0022](../docs/adr/0022-who-is-in-is-the-consoles-own-record-and-an-administrator-keeps-it.md)): the app's id (or its client id), its private key as PEM (also as `GITHUB_APP_PRIVATE_KEY_FILE`), and the organization's login. All three or none, with the GitHub client. Asked at sign-in, and read whole by the worker every ten minutes: those who left are out, those who returned are in. |
| `AUTH_SECRET` | `api` | no | **yes** | What a sign-in in flight is sealed with. At least 32 characters, the same on every replica. Signing in exists only when this, `PUBLIC_URL` and at least one provider's client id and secret are set; setting some of them is a configuration error. |
| `GITHUB_WEB_URL`, `GITHUB_API_URL` | `api` | no | no | Defaults `https://github.com` and `https://api.github.com`. GitHub Enterprise Server: `https://<host>` and `https://<host>/api/v3`. |
| `GOOGLE_CLIENT_ID` | `api` | no | no | The client id of the OAuth client registered at Google for signing in. With `GOOGLE_CLIENT_SECRET`: both or neither. |
| `GOOGLE_CLIENT_SECRET` | `api` | no | **yes** | Its client secret. |
| `GOOGLE_WORKSPACE_DOMAIN` | `api` | no | no | A Google Workspace domain whose accounts are all in, as Google vouches for them at sign-in; also the domain offered at the account picker. Needs the Google client. Taken out, its people are out on the next request. |
| `ADMINS` | `api` | no | no | The first administrators: logins at GitHub, addresses at Google, comma-separated, compared without regard to case. Let in when they sign in, by this alone, and made administrators then; an administrator may make or unmake others on the People page, and the board keeps at least one in. Everyone else is let in on the People page, by the organization or by the domain ([Signing in](#signing-in)). |
| `SESSION_TTL_DAYS` | `api` | no | no | How long a browser stays signed in without being used. Default `30`. |
| `TOKEN_DAYS_AT_MOST` | `api` | no | no | The most days a token for an agent may be good for, when the organization requires an expiry: a token that would not expire, or would outlast it, is refused wherever one is made, and the pages offer only what is allowed. Unset: a person chooses, up to a year or never. |
| `WEB_ROOT` | `api` | no | no | Directory of a build of the UI: the default one, or [the organization's own](#a-custom-console-in-the-image). The image sets `/app/web`; set it to an empty value to run without a UI. A directory without an `index.html` is a configuration error. |
| `SKILLCDN_URL` | `api` | no | no | The origin of the SkillCDN deployment the organization's skills are read through. Default `https://skillcdn.ai`. |
| `SKILLS_ADDRESS` | `api` | no | no | The address of the organization's skills, as the standard spells one: at that deployment (`/gh/<owner>/<repo>`, with `@<ref>` and a path when needed), or a pack read from `SKILLS_DIR` (`/local/<owner>/<name>`); what a project shows when it names no address of its own on its Settings page. Unset: such a project's Skills page says there is no address yet. The console asks as nobody unless a SkillCDN token reads the pack: the project's own ([ADR-0028](../docs/adr/0028-the-console-reads-a-projects-pack-through-the-deployments-rest-api-with-a-pack-token-for-a-private-one.md)), or, for a project that names no address, the workspace's, which an administrator sets on the Settings page or with `console workspace pack-token`; either is connected with a code approved at the deployment ([ADR-0036](../docs/adr/0036-a-private-pack-is-connected-with-a-code-a-person-approves-from-the-projects-settings.md); SkillCDN 0.3.1 or later) or pasted, and needs `AUTH_SECRET` to be kept sealed; without one a private repository shows only where the deployment serves it to anyone. |
| `SKILLS_DIR` | `api` | no | no | The directory the packs of `local` addresses are read from, laid out as `<owner>/<name>`, each a directory in the SkillCDN Format, read with the reading rules a deployment applies and asked of no deployment ([ADR-0031](../docs/adr/0031-the-console-reads-a-pack-as-the-skillcdn-command-does-and-a-local-one-from-a-directory.md)). The image sets `/app/packs`, where the console's own skills are at `skillcdn/console`; an organization mounts its packs beside it. A directory that is not there is a configuration error; a pack that is not there is not found. Unset: a `local` address is not found. |
| `S3_ENDPOINT` | `api` | no | no | The origin of the store with the S3 API that files go to, such as `https://s3.us-east-1.amazonaws.com`. With `S3_BUCKET`: both or neither. Unset: the bytes of files are kept in PostgreSQL. See [The bucket](#the-bucket). |
| `S3_BUCKET` | `api` | no | no | The bucket, which must exist: the console makes none, and refuses to start when it is not there. |
| `S3_CREDENTIALS` | `api` | no | no | How requests to the bucket are signed. `keys`, the default: the pair below. `platform`: the credentials the platform hands the container at an endpoint of its own and renews, as a task's role on ECS or a pod's identity on EKS, named by the platform's own variables (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, or `AWS_CONTAINER_CREDENTIALS_FULL_URI` with `AWS_CONTAINER_AUTHORIZATION_TOKEN` or its `_FILE`), which the console reads only then ([ADR-0018](../docs/adr/0018-the-bucket-may-be-reached-with-the-credentials-the-platform-hands-the-container.md)). With `platform`, the keys are not set. |
| `S3_ACCESS_KEY_ID` | `api` | no | no | The access key id of the pair the console signs with. With `S3_SECRET_ACCESS_KEY`: both, required with `S3_CREDENTIALS=keys`. |
| `S3_SECRET_ACCESS_KEY` | `api` | no | **yes** | Its secret. |
| `S3_REGION` | `api` | no | no | The region the signature names. Default `us-east-1`, which a store without regions accepts. |
| `S3_SESSION_TOKEN` | `api` | no | **yes** | The token that comes with temporary credentials, when the pair is one. The console does not renew it; credentials the platform renews are `S3_CREDENTIALS=platform`. |
| `S3_KEY_PREFIX` | `api` | no | no | What every key begins with: folders ending with a slash, such as `console/`, for a bucket shared with something else. Default: nothing. |
| `S3_PATH_STYLE` | `api` | no | no | Default `true`: the bucket in the path (`endpoint/bucket/key`), which every store accepts. `false` puts it in the host (`bucket.endpoint`), as some require. |

Every secret `NAME` may also be supplied as `NAME_FILE`, so container secret mounts work.

## A custom console in the image

The default UI is a build of the package's composition with the default configuration, and the `api` role serves whatever build `WEB_ROOT` names: its files, and its page for every path that is not a file or the API's, under the same policy ([ADR-0014](../docs/adr/0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md)). An organization's own console, built from `@skillcdn/console` in a repository of its own ([the package's README](../packages/console/README.md#the-components-and-the-composition)), replaces the default UI by taking its place:

```dockerfile
# From the console image the organization builds (see "Building a release"), with the build of
# its own console in place of the default UI.
ARG CONSOLE_IMAGE=skillcdn-console
FROM ${CONSOLE_IMAGE}
COPY --chown=node:node dist/ /app/web/
```

A volume mounted over `/app/web`, or `WEB_ROOT` pointing at a mounted directory, does the same without a second image. The build is static files that the `api` role reads once at boot: a new build means a new container. A person's own console is not the deployment's concern: a member serves one from their own machine with `console serve`, which carries its requests to this console with the member's token.

## What a platform must provide

Written so that a cloud deployment is the image as containers, a managed PostgreSQL and a bucket, and nothing else:

- **Secrets at runtime**, as environment variables or mounted files; never as build arguments.
- **A managed PostgreSQL** reachable from the containers, over TLS: `DATABASE_URL` takes the driver's parameters, `?sslmode=verify-full`, with `&sslrootcert=/path/to/ca.pem` where the platform's certificate authority is its own; or, for a platform that hands a container no files, the authority's PEM as `DATABASE_CA`, which verifies the same. `migrate` runs once per rollout, before the new `api` and `worker` start, and migrations follow expand, then contract, across separate releases.
- **A bucket with the S3 API** for the files runs hand in and people attach, and a pair of keys that may read and write objects in it, or, where the platform hands the container credentials of its own, a role that may ([The bucket](#the-bucket)). Without one the bytes live in PostgreSQL, which the smallest install is fine with.
- **Outbound HTTPS** to the SkillCDN deployment (`SKILLCDN_URL`) for the packs read at one, to the identity providers people sign in through, and to the bucket's endpoint. A console whose packs are all in `SKILLS_DIR`, whose provider is inside its network and whose files are in the database needs none of it ([the smallest install](#the-smallest-install-and-a-closed-network)).
- **Health probes** on `GET /healthz` (liveness) and `GET /readyz` (readiness), and a stop timeout above the shutdown grace period, so that `SIGTERM` lets requests in flight finish.
- **Logs from stdout**, JSON, one line per event; they never contain tokens or what an agent handed in.
- **A reverse proxy or load balancer** that terminates TLS and limits requests per client; the image does neither.

## The smallest install, and a closed network

One machine runs the whole console: the image next to PostgreSQL, the worker inside the `api` role (`WORKER_IN_PROCESS=true`), the files in the database, and the packs read from a directory on the machine (`SKILLS_DIR`), so that nothing of it needs the internet. [`compose.yaml`](compose.yaml) is that shape: `postgres`, `migrate` run once before the api, and `api`, with the organization's packs mounted beside the console's own. It is for a trial, a small team on one machine, or a network that reaches nothing outside; the cloud shape is [the reference deployment](#the-reference-deployment). What is set: `POSTGRES_PASSWORD` in the environment, and in `deploy/.env`, which git ignores, what signing in needs, `PUBLIC_URL`, a provider, `AUTH_SECRET` and `ADMINS` ([Signing in](#signing-in)), with `CONSOLE_BIND=0.0.0.0` where other machines reach the console and a proxy in front terminates TLS. Then:

```sh
docker build -f deploy/Dockerfile -t skillcdn-console .    # where the machine reaches the internet
POSTGRES_PASSWORD=... docker compose -f deploy/compose.yaml up -d
```

A closed network reaches no registry, no git host and no SkillCDN deployment, so what goes in is carried. The images, saved where they were built and loaded inside: `docker save skillcdn-console postgres:18 | gzip > console-images.tgz`, then `docker load < console-images.tgz`. The command for the agents' machines, as the package's tarball: `npm pack @skillcdn/console` where npm is reachable, `npm install -g skillcdn-console-<version>.tgz` inside, which brings the console's skills with it. The packs, each a directory in the SkillCDN Format, synchronized by any means into `deploy/packs/<name>`, which the compose file serves as `/local/org/<name>` (rename `org` in it to the organization's own name); a project names its pack on its Settings page, or `SKILLS_ADDRESS` names the organization's, and the console's own skills are at `/local/skillcdn/console` from the image. An agent reads every pack through the console, `console skills` and `console skill`, with the words a deployment would give it ([ADR-0031](../docs/adr/0031-the-console-reads-a-pack-as-the-skillcdn-command-does-and-a-local-one-from-a-directory.md)); nothing of a pack leaves the machine. Signing in needs an identity provider the network reaches: GitHub Enterprise Server inside it (`GITHUB_WEB_URL`, `GITHUB_API_URL`), or Google where the network lets it through; with neither nobody signs in, and a console for such a network is an open question of [the architecture](../docs/architecture.md#open-questions).

## The reference deployment

An organization deploys the console with an agent, through [`skills/deploying-a-console`](../skills/deploying-a-console/SKILL.md) ([ADR-0017](../docs/adr/0017-the-reference-deployment-is-the-image-on-aws-behind-cloudflare-written-as-a-skill.md)): the image as tasks on AWS (ECS with Fargate) next to a managed PostgreSQL (RDS) and a bucket (S3), which the tasks reach with their role's own credentials and no key ([ADR-0018](../docs/adr/0018-the-bucket-may-be-reached-with-the-credentials-the-platform-hands-the-container.md)), the secrets in a parameter store, reached only through Cloudflare, whose tunnel's connector runs beside the `api` container so that nothing listens on the internet; built and rolled out by a private deployment repository of the organization's own on every push, with `migrate` as a one-off task before the services roll. The skill asks the organization's size and shows the monthly cost before anything is made, sized from one person to a hundred; the shape held on an organization's own accounts (2026-10). It is the reference, not the only way: every other platform deploys from this contract, and the definitions of an organization's own deployment stay in its own repository.

## Signing in

People sign in through an identity provider the organization already uses: GitHub, Google (Workspace), or both. For GitHub, register a GitHub App (the organization's settings, Developer settings, GitHub Apps): its homepage is `PUBLIC_URL`, its callback URL `PUBLIC_URL/auth/gh/callback`, no webhook, and, for the organization to say who is in, the organization permission Members, read-only, with the app installed on the organization; the app's client id and a client secret sign people in, and its id with a private key read the organization (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_ORG`). An OAuth app signs people in as well, without an organization to vouch for them. No scopes are needed: the console asks only who the person is. For Google, register an OAuth client of the web application type in a Google Cloud project, with `PUBLIC_URL/auth/google/callback` as an authorized redirect URI; the console asks for identity only (`openid email profile`). Either way the console asks the provider who the person is, once, and keeps nothing of the credential. Then set the provider's client id and secret, `AUTH_SECRET` (32 random characters or more), `PUBLIC_URL`, and `ADMINS`: the first administrators, by GitHub login or Google address, let in by that alone and made administrators when they sign in.

Who else is in is the console's own record, kept by an administrator ([ADR-0022](../docs/adr/0022-who-is-in-is-the-consoles-own-record-and-an-administrator-keeps-it.md)): on the People page, or with `console person`, an administrator lets a login in, and whoever signs in with that account is a person from then on; `GOOGLE_WORKSPACE_DOMAIN` lets everyone of a Workspace in, as Google vouches for them at sign-in; `GITHUB_ORG` lets everyone of the organization in, as GitHub says at sign-in and every ten minutes after, so that those who left are out and those who returned are in, and an administrator changes neither (to keep one who left, an administrator lists their login). An administrator takes a person out on the same page: they are refused on every request from the next one, their agents' tokens with them, and kept with everything they did; and takes them back in. A domain or an organization taken out of the configuration takes its people with it on the next request. The worker reads the organization; a single-container install with `WORKER_IN_PROCESS` reads it from the `api` role.

What the browser holds is a session cookie that scripts cannot read, bound to the host over TLS (`__Host-`); the database holds its hash. A request that changes something must come from the console's own pages: the browser names its origin, and the console compares it with `PUBLIC_URL`.

An agent, a script or a console of a person's own holds a token instead, made by that person on the console's Agents page and presented as `Authorization: Bearer`: it is that person for the board's purposes, needs no origin, expires after at most a year or never, as the person chooses within what `TOKEN_DAYS_AT_MOST` allows, and is removed on the same page, by the person or by an administrator. An agent gets its token without anyone copying one: its command shows a short code and an address, and the person approves on the console's own pages ([ADR-0011](../docs/adr/0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md)). The database holds its hash; a token cannot make tokens; a person holds a bounded number of them. Nothing here needs configuring.

An agent works the board through the `console` command of `@skillcdn/console`, signed in with that token ([docs/specs/cli.md](../docs/specs/cli.md)); nothing of it is configured here. A read of a decision that waits for its answer (`GET /api/v1/decisions/<id>?wait=`) holds its request for up to 50 seconds, so a proxy's read timeout must allow it.

## The bucket

The files runs hand in and people attach to documents go to a bucket with the S3 API when one is configured, and to rows of PostgreSQL otherwise ([ADR-0016](../docs/adr/0016-the-bucket-is-reached-through-the-s3-api-with-the-consoles-own-signing-and-reads-what-the-rows-kept-before-it.md)). Any store that speaks the API serves: a cloud's object storage, or a self-hosted one. Make the bucket, private, with no versioning, lifecycle rules or public access needed; make a pair of keys that may read and write objects in it and nothing else, or, on a platform that hands the container credentials of its own, give the container a role that may; and set `S3_ENDPOINT` (the store's origin), `S3_BUCKET`, and either `S3_ACCESS_KEY_ID` with `S3_SECRET_ACCESS_KEY` or `S3_CREDENTIALS=platform`. `S3_REGION` where the store has regions and the bucket is not in `us-east-1`; `S3_KEY_PREFIX` when the bucket is shared with something else; `S3_PATH_STYLE=false` where the store wants the bucket in the host name. The console signs every request itself, with no SDK: with keys, they come from the environment as the database's password does and are rotated the same way; with `S3_CREDENTIALS=platform`, it reads the credentials the platform hands the container at the endpoint the platform names, asks again before they expire, and holds nothing long-lived ([ADR-0018](../docs/adr/0018-the-bucket-may-be-reached-with-the-credentials-the-platform-hands-the-container.md)). No credentials file of a platform is read.

Every file is one object under the SHA-256 of its bytes, below the prefix: the console keeps nothing it did not receive whole, and reads back nothing that is not the bytes of its hash. At start the `api` role asks the bucket whether it is there: a bucket that does not exist, or is served from another endpoint or region, stops the process with exit code `78` and the variable at fault; one that does not answer, or refuses to say whether it exists (keys that may not list it), is logged and tried with the first file. While the bucket is away, handing in a file and reading one back answer `503 file.store_unavailable` with `retry-after`, and the board goes on without them.

A console that kept files in PostgreSQL before it was given a bucket loses none of them: what the bucket has nothing under is read from the rows, which are never written again, and nothing is copied. Locally, `deploy/compose.dev.yaml` runs a store with the S3 API on `127.0.0.1:7070`, where the integration tests make the bucket `console`; [`.env.example`](../.env.example) shows how to point the api at it.

## Behind a reverse proxy

A proxy in front reuses idle connections to the console. `HTTP_KEEP_ALIVE_SECONDS` must be longer than the proxy's own idle timeout, or the proxy now and then sends a request into a connection the console has just closed. `HTTP_REQUEST_TIMEOUT_SECONDS` bounds how long one request may take to arrive in full.

A file handed in (`POST /api/v1/runs/<id>/files`) arrives in one request of up to 10 MiB and a little more, so the proxy's limit on a request body must allow it.

The client address and the request id are read from the proxy's headers only when the proxy's address is in `TRUSTED_PROXIES`; from anyone else, the headers are ignored and the client is the peer. With `x-forwarded-for`, the chain is walked from the nearest proxy and the first address that is not a trusted proxy is the client. A proxy on the same host, such as a tunnel's connector beside the container, is the loopback, which has two addresses: `TRUSTED_PROXIES=127.0.0.1,::1`, so that the header is believed whichever the proxy connects over.

## Process contract

- Exit codes: `64` for a usage error (no role, or an unknown one), `78` for invalid configuration, `70` for a failure the process could not recover from.
- `GET /healthz` is liveness. `GET /readyz` is readiness: the database reachable, the schema at least at the version this build ships, the workspace found, and not shutting down.
- `SIGTERM` or `SIGINT`: readiness fails, the listener stops accepting, requests in flight finish, idle connections close, and the process exits within `SHUTDOWN_GRACE_SECONDS`; what is still open then is cut off.
- The lines the roles log at start are stable, so that a deployment's check may look for them: `migrate` ends with `migrations applied`; `api` logs `serving the UI` (with a UI), `files go to the bucket` (with a bucket) and `api listening`, whose `signIn` lists the providers set.

## Building a release

CI builds the image on every change and exercises it, but publishes nothing. A release is built from a commit of `main` with `docker build -f deploy/Dockerfile`, tagged with that commit, and pushed to whatever registry the deployment uses, by whoever operates it; none of that lives here.

## Rollout contract

1. Build the image from the commit, and run its `migrate` role once against the database, before anything else of the new version starts. Migrations only add (expand); what the previous version reads is removed in a later release (contract), so the old `api` and `worker` keep working while the new ones roll out.
2. Start the new `api` replicas; the platform sends traffic once `GET /readyz` answers `200`, which it does only with the schema of this build applied and the workspace found.
3. Stop the old replicas with `SIGTERM` and a stop timeout above `SHUTDOWN_GRACE_SECONDS`: readiness fails at once, requests in flight finish, the feed's streams end (browsers reconnect to the new replicas on their own, from where they were), and the process exits `0`.
4. Replace the `worker` the same way; a sweep it was in the middle of is the next one's work.

The definitions of a particular deployment (accounts, networks, hostnames, sizes) are not in this repository and must not be added to it.

## Repository settings checklist

Set once in GitHub and on the registry; none of it can be expressed in files here.

- Branch protection on `main` is intentionally off for now: maintainers push directly ([AGENTS.md](../AGENTS.md)). When the team moves to pull requests, require them together with the `CI` checks and a linear history.
- Enable secret scanning with push protection, Dependabot alerts and private vulnerability reporting.
- Actions: default `GITHUB_TOKEN` permission read-only; require approval before running workflows from first-time contributors. Allow GitHub Actions to create and approve pull requests (`Actions > General`): the release workflow opens its version pull request with that, and fails at that step without it.
- On npm, `@skillcdn/console` has this repository registered as its trusted publisher, and then requires two-factor authentication with tokens disallowed. The publisher is GitHub Actions with organization `skillcdn`, repository `console`, workflow filename `release.yml` (the file name alone, not its path) and no environment name, and its allowed actions include `publish`. The four fields must match the run exactly: otherwise the registry answers the publish with `404 Not Found`. Without the `publish` action it answers `403 OIDC permission denied for this action`, since only staged publishes are allowed by default. Either way the Publish job fails within a second and nothing is published, so the run can be repeated once the publisher is right. A registration is pending until the workflow publishes through it once, and expires after two days unused: a package that saw no release in that time needs it registered again before its next one.
- A new package's first version is published by a maintainer by hand, before its publisher can be registered; `@skillcdn/console` is past that since 0.1.0 ([ADR-0007](../docs/adr/0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md)): from a clean checkout of the commit on `main` that the version pull request made, `pnpm install --frozen-lockfile`, `pnpm turbo run build --filter=@skillcdn/console`, then `pnpm --filter @skillcdn/console publish --access public` with the registry's one-time password. The Publish job of that commit fails, as expected, with `404`; register the publisher right after, and make the next release within two days so that the registration is used.
- No cloud credentials, environments or deployment secrets belong to this repository. If a workflow here ever asks for one, that is a mistake.

## Gotchas

- The image build keeps the pnpm store in a BuildKit cache mount, and the `pnpm fetch` layer copies packages out of it. A build that dies halfway (the daemon stopped, the machine went down) can leave a truncated file in the store, and every later build then fails in `pnpm install --offline` with `ERR_PNPM_CMD_SHIM_PARSE_MANIFEST` on some package's `package.json`. Clear the mount and rebuild without the layer cache: `docker builder prune -f --filter type=exec.cachemount`, then `docker build --no-cache ...`.
- `docker stop` sends `SIGTERM`, which the roles handle; `kill` from a Windows shell does not deliver signals to a Node.js process, so a shutdown is only seen in a container or on Linux.
- `.dockerignore` keeps `docs/` and every Markdown file out of the build context, so a `COPY` of them in the Dockerfile fails, or, for a directory, arrives without them. What the image must carry of the repository's Markdown is let in by an exception at the end of `.dockerignore` (`!SKILLCDN.md`, `!skills/**`, `!docs/**`), and CI checks the built image for the manifest, a skill and a doc, as it checks for the license. Build the image locally before pushing a change to what it carries.
