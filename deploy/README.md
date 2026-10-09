# deploy/

Everything needed to build the image and hand it to whatever runs it. This repository stops at an image that builds: publishing images, registries, deployment pipelines, infrastructure definitions, DNS, TLS and rollout live outside it ([ADR-0002](../docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md), [AGENTS.md](../AGENTS.md) rule 8).

| File | Purpose |
|---|---|
| [`compose.dev.yaml`](compose.dev.yaml) | Local development dependencies (PostgreSQL 18 on `127.0.0.1:5433`, next to a SkillCDN development database on 5432). Not a production topology. |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, build, typecheck, tests (integration tests run against a PostgreSQL service container) and a secret scan. It needs no secrets. |

A `Dockerfile` and an image job in CI arrive with the first milestone ([roadmap](../docs/roadmap.md)); a release workflow for the package arrives with its first publish.

## The image, as it will be

One multi-stage image, non-root, production dependencies only, no secrets and no configuration baked in. The container command selects the role:

```sh
docker build -f deploy/Dockerfile -t skillcdn-console .    # from the repository root
docker run --rm --env-file .env skillcdn-console migrate    # one-off role, before a new version rolls out
docker run --rm -p 11190:11190 --env-file .env skillcdn-console api
docker run --rm --env-file .env skillcdn-console worker
```

## Environment contract

The console is configured only through environment variables. [`.env.example`](../.env.example) is the source of truth; this table adds what operators need to know. Both are updated in the same change as the config module. Nothing reads these yet.

| Variable | Roles | Required | Secret | Notes |
|---|---|---|---|---|
| `NODE_ENV` | all | no | no | The image sets `production`. |
| `LOG_LEVEL` | all | no | no | Default `info`. |
| `HOST`, `PORT` | `api` | no | no | Defaults `0.0.0.0` and `11190`. |
| `DATABASE_URL` | all | yes | **yes** | PostgreSQL connection string. |

Every secret `NAME` may also be supplied as `NAME_FILE`, so container secret mounts work.

## What a platform must provide

Written so that a cloud deployment is the image as containers, a managed PostgreSQL and a bucket, and nothing else:

- **Secrets at runtime**, as environment variables or mounted files; never as build arguments.
- **A managed PostgreSQL** reachable from the containers; `migrate` runs once per rollout, before the new `api` and `worker` start, and migrations follow expand, then contract, across separate releases.
- **Object storage with the S3 API** for what runs hand in, once the S3 implementation of the blob-store port lands; until then the bytes live in PostgreSQL.
- **Health probes** on `GET /healthz` (liveness) and `GET /readyz` (readiness), and a stop timeout above the shutdown grace period, so that `SIGTERM` lets requests in flight finish.
- **Logs from stdout**, JSON, one line per event; they never contain tokens or what an agent handed in.
- **A reverse proxy or load balancer** that terminates TLS and limits requests per client; the image does neither.

The definitions of a particular deployment (accounts, networks, hostnames, sizes) are not in this repository and must not be added to it.
