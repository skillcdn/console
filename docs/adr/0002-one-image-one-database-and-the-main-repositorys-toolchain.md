# ADR-0002: One image, one database, and the main repository's toolchain and conventions

- Status: Accepted
- Date: 2026-10-09

## Context

The console will run in two places from the start: on a developer's machine, and on a cloud for the organization that uses it. Later it will run for other organizations, from their own installations. Its builders are mostly AI agents across many sessions, who already know the main repository's conventions, and the console must be ready for a cloud deployment without its code knowing which cloud.

## Decision

1. **One deployable, `apps/console`, one container image.** The container command selects the role: `api` serves HTTP (REST for the UI, MCP for agents, sign-in), `worker` runs the long-running and scheduled parts, `migrate` applies pending migrations and exits. A flag lets `api` run the worker loop in-process for a single-container install. Roles load their heavy dependencies lazily.
2. **PostgreSQL is the only stateful dependency:** the board, the people, the tokens, the events, the job queue. Everything else that must persist is a file in S3-compatible storage, behind a port; the first implementation keeps those bytes in PostgreSQL, so that the smallest install has one dependency.
3. **Nothing in the code names a cloud.** Configuration comes from environment variables, parsed once at boot; every secret may be given as `NAME_FILE`; logs go to stdout as JSON; `GET /healthz` and `GET /readyz` report liveness and readiness; `SIGTERM` drains and exits within a grace period. A cloud deployment is the image as containers, a managed PostgreSQL and a bucket, defined outside this repository.
4. **The main repository's toolchain and conventions, unchanged:** Node.js 24, pnpm pinned with the runtime, TypeScript 7 strict and erasable, compiled packages with project references, Turborepo, Biome, Vitest, changesets, Conventional Commits, the same supply-chain guards, and `AGENTS.md` as the working agreement. The stack it chose for the same problems is the default here (Hono, Zod, Drizzle on PostgreSQL, pg-boss, pino, Vite and React), revisited only when a need appears that the main repository does not have.

## Consequences

- One artifact to build, scan and reason about; a developer's compose and an organization's cloud run the same image.
- Migrations are a separately runnable step, which a safe rollout needs; the expand-then-contract rule applies from the first schema.
- Whoever knows the main repository can work here on the first day, and the two repositories can share fixes to tooling.
- Infrastructure definitions have no home here while the repository is public (`AGENTS.md`, rule 8); `deploy/README.md` says what a platform must provide instead.
- Rejected: separate `api` and `worker` apps (two artifacts, and the in-process mode would need the worker's code in a shared package from day one); a serverless shape (ties the code to one cloud's model; a container runs anywhere); a different stack chosen afresh (a second set of conventions for the same people and agents to keep in their heads).
