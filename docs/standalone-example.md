# Standalone example: using this package outside the ScheduleSpark monorepo

Install `@schedulespark/observability` from npm, then mount the SDK and dashboard inside your own service. The application code below is the same whether you use it in a standalone service or inside a larger workspace.

## The scenario

A separate Node/Fastify service, outside this monorepo entirely, that wants:

- Error capture with no extra service to run.
- A dashboard mounted at `/observability` inside that same service.
- Its own Postgres database (or a spare schema in an existing one) as the only new
  piece of infrastructure.

## Install

```sh
npm install @schedulespark/observability pg fastify
```

`pg` and `fastify` are peer dependencies — this package never bundles its own copy of
either, so it always talks to the same Postgres/Fastify version your app already runs.

`server.ts`:

```ts
import Fastify from "fastify";
import { init, captureFastifyErrors } from "@schedulespark/observability/node";
import { createDashboard, registerDashboard } from "@schedulespark/observability/dashboard";
import { initStorage } from "@schedulespark/observability/storage";

const app = Fastify();

const client = init({ connectionString: process.env.OBSERVABILITY_DATABASE_URL! });
captureFastifyErrors(app, client);

const storage = await initStorage({ connectionString: process.env.OBSERVABILITY_DATABASE_URL! });
registerDashboard(app, createDashboard(storage), {
  prefix: "/observability",
  // Replace with your own auth check before exposing this beyond localhost — an
  // unconfigured `authorize` allows every request through by default.
  authorize: (request) => request.headers["x-admin-token"] === process.env.ADMIN_TOKEN
});

app.get("/", (_request, reply) => reply.send({ ok: true }));

await app.listen({ port: 3000 });
```

```sh
export OBSERVABILITY_DATABASE_URL="postgresql://user:pass@localhost:5432/myapp"
export ADMIN_TOKEN="pick-a-real-secret"
npx tsx server.ts
```

Migrations run automatically on first `init()`/`initStorage()` call — no separate
migration step needed for local dev. Then:

- `curl localhost:3000/nonexistent-route-that-throws` to generate a test error.
- Open `http://localhost:3000/observability` (with the `x-admin-token` header, or swap
  `authorize` for a browser-friendly session check) to see it show up.

For production, run migrations explicitly during deploy instead of relying on the
implicit on-`init()` migration:

```sh
npx @schedulespark/observability migrate --db "$OBSERVABILITY_DATABASE_URL"
```

## Right now, from inside this monorepo: a workspace link

Until this package is published, the same `server.ts` above works unmodified from a
throwaway directory inside this monorepo by linking to the local package instead of
installing from npm:

```sh
mkdir -p /tmp/observability-example && cd /tmp/observability-example
npm init -y
npm install fastify tsx
npm link /path/to/schedulespark/packages/observability
```

Everything else — the `server.ts` content, the env vars, the `migrate`/`serve` CLI
commands — is identical to the published-package version above. This is exactly what
`apps/api`'s own dogfood integration does (via a `workspace:*` dependency instead of
`npm link`), just outside the monorepo's build tooling.

## Running fully standalone (no host app at all)

If you don't want to write any server code, the CLI runs the same dashboard on its own
port:

```sh
npx @schedulespark/observability serve --db "$OBSERVABILITY_DATABASE_URL" --port 4318 \
  --token "$OBSERVABILITY_TOKEN" --ingest-key "$OBSERVABILITY_INGEST_KEY"
```

Point the Node SDK's `client.captureException(...)` calls (or the browser SDK's
`init({ ingestUrl: "http://localhost:4318/ingest", apiKey: ... })`) at that same host
and port — no code from this walkthrough's `server.ts` is needed in that mode.

## What this walkthrough intentionally doesn't cover

- A full example *application* (e.g. a sample Express/Next.js app committed to this
  repo) — deferred; see the plan's Phase 5 notes. This doc is a copy-pasteable
  quickstart, not a maintained sample app.
- Non-Node ingestion (Python/Go/etc.) — out of scope for this package entirely.
