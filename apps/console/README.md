# apps/console

The single deployable of the console: the API people and agents talk to, the worker, the migrations, and the default UI, in one image whose container command selects the role, `api`, `worker` or `migrate` ([ADR-0002](../../docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)). What it does and how its parts fit together is in [docs/architecture.md](../../docs/architecture.md); what to build next is in [docs/roadmap.md](../../docs/roadmap.md).

**Nothing runs yet.** `src/main.ts` selects the role and says that it is not implemented; the first milestone fills it in. Until then:

```sh
pnpm turbo run build --filter=@skillcdn/console-app
node apps/console/dist/main.js api      # says so, exits 70; without a role or with an unknown one, exits 64
```

## Layout, as it will be

```
src/
  main.ts        the entry point: role selection, then the role module
  roles/         one module per role, loaded only when selected
  config/        the only reader of process.env: schema, defaults, validation
  http/          the REST API for the UI, the MCP endpoint for agents, sign-in, the UI's files
  db/            schema, migrations, queries; the data model documented here when it exists
  jobs/          what the worker runs
  adapters/      the git host, the blob store, the clock, notifications
```

## Rules

Read the root [`AGENTS.md`](../../AGENTS.md) first. This workspace is the composition root: it wires ports to adapters and exposes the console over HTTP and the job queue.

- **`src/config/` is the only reader of `process.env`** (lint enforces it). A new variable means: schema in the config module, an entry in `.env.example`, and a row in the table in `deploy/README.md`, all in the same change. Every tunable has a safe generic default; production values are never committed.
- **`api` is stateless.** No in-memory state that affects correctness; everything several replicas must agree on is in the database.
- **Every handler runs in this order:** validate input with a schema, check who is asking and what they may do, then do the work. Unknown and forbidden answer the same.
- **What an agent sends is data.** Bounded, stored, shown as text; never executed, never HTML.
- **Tokens stop at the edge.** A session or an agent token becomes a person at the route that received it; nothing further in sees the credential. Nothing is ever logged that could be one.
- **Jobs are idempotent and interruptible.** A job never assumes it runs exactly once; payloads stay readable by the previous release.
- **Shutdown is part of the feature.** Anything long-running registers with the shutdown path, and tests cover it.
- **The schemas of the API live in `packages/console`**, so that the default UI, a custom console and this server share one contract. This workspace imports them; it never defines a second copy.
