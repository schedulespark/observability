import type { Pool, PoolClient } from "pg";

/**
 * A single versioned, forward-only schema migration.
 */
export interface Migration {
  id: string;
  sql: (quotedSchema: string) => string;
}

export /**
        * All versioned migrations, applied in order.
        */
const migrations: Migration[] = [
  {
    id: "0001_init",
    sql: (schema) => `
      CREATE TABLE IF NOT EXISTS ${schema}.issues (
        id text PRIMARY KEY,
        fingerprint text NOT NULL UNIQUE,
        title text NOT NULL,
        level text NOT NULL,
        status text NOT NULL DEFAULT 'unresolved',
        event_count integer NOT NULL DEFAULT 0,
        first_seen timestamptz NOT NULL,
        last_seen timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${schema}.events (
        id text PRIMARY KEY,
        issue_id text NOT NULL REFERENCES ${schema}.issues(id) ON DELETE CASCADE,
        fingerprint text NOT NULL,
        level text NOT NULL,
        message text NOT NULL,
        error_type text,
        stack_trace text,
        context jsonb NOT NULL DEFAULT '{}'::jsonb,
        captured_at timestamptz NOT NULL
      );

      CREATE INDEX IF NOT EXISTS events_issue_id_idx ON ${schema}.events (issue_id);
      CREATE INDEX IF NOT EXISTS events_captured_at_idx ON ${schema}.events (captured_at DESC);
      CREATE INDEX IF NOT EXISTS issues_last_seen_idx ON ${schema}.issues (last_seen DESC);
    `
  },
  {
    id: "0002_assignee_comments",
    sql: (schema) => `
      ALTER TABLE ${schema}.issues ADD COLUMN IF NOT EXISTS assignee text;

      CREATE TABLE IF NOT EXISTS ${schema}.comments (
        id text PRIMARY KEY,
        issue_id text NOT NULL REFERENCES ${schema}.issues(id) ON DELETE CASCADE,
        author text NOT NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL
      );

      CREATE INDEX IF NOT EXISTS comments_issue_id_idx ON ${schema}.comments (issue_id);
    `
  },
  {
    id: "0003_spans",
    sql: (schema) => `
      CREATE TABLE IF NOT EXISTS ${schema}.spans (
        id text PRIMARY KEY,
        trace_id text NOT NULL,
        parent_id text,
        name text NOT NULL,
        status text NOT NULL,
        started_at timestamptz NOT NULL,
        duration_ms integer NOT NULL,
        tags jsonb NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE INDEX IF NOT EXISTS spans_trace_id_idx ON ${schema}.spans (trace_id);
      CREATE INDEX IF NOT EXISTS spans_transactions_idx ON ${schema}.spans (started_at DESC)
        WHERE parent_id IS NULL;
    `
  },
  {
    id: "0004_projects",
    sql: (schema) => `
      CREATE TABLE IF NOT EXISTS ${schema}.projects (
        id text PRIMARY KEY,
        name text NOT NULL,
        api_key text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      INSERT INTO ${schema}.projects (id, name, api_key, created_at)
      VALUES ('default', 'Default', NULL, now())
      ON CONFLICT (id) DO NOTHING;

      ALTER TABLE ${schema}.issues
        ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default' REFERENCES ${schema}.projects(id);
      ALTER TABLE ${schema}.events
        ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default' REFERENCES ${schema}.projects(id);

      -- Fingerprints are now unique per-project, not globally.
      ALTER TABLE ${schema}.issues DROP CONSTRAINT IF EXISTS issues_fingerprint_key;
      CREATE UNIQUE INDEX IF NOT EXISTS issues_project_fingerprint_idx
        ON ${schema}.issues (project_id, fingerprint);

      CREATE INDEX IF NOT EXISTS issues_project_id_idx ON ${schema}.issues (project_id);
      CREATE INDEX IF NOT EXISTS events_project_id_idx ON ${schema}.events (project_id);
    `
  },
  {
    id: "0005_breadcrumbs",
    sql: (schema) => `
      ALTER TABLE ${schema}.events
        ADD COLUMN IF NOT EXISTS breadcrumbs jsonb NOT NULL DEFAULT '[]'::jsonb;
    `
  },
  {
    id: "0006_saved_views",
    sql: (schema) => `
      CREATE TABLE IF NOT EXISTS ${schema}.saved_views (
        id text PRIMARY KEY,
        name text NOT NULL,
        filters jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `
  },
  {
    id: "0007_logs",
    sql: (schema) => `
      CREATE TABLE IF NOT EXISTS ${schema}.logs (
        id text PRIMARY KEY,
        project_id text NOT NULL DEFAULT 'default' REFERENCES ${schema}.projects(id),
        level text NOT NULL,
        message text NOT NULL,
        context jsonb NOT NULL DEFAULT '{}'::jsonb,
        logged_at timestamptz NOT NULL
      );

      CREATE INDEX IF NOT EXISTS logs_logged_at_idx ON ${schema}.logs (logged_at DESC);
      CREATE INDEX IF NOT EXISTS logs_project_id_idx ON ${schema}.logs (project_id);
    `
  },
  {
    id: "0008_metric_points_raw",
    sql: (schema) => `
      CREATE TABLE IF NOT EXISTS ${schema}.metric_points_raw (
        id text PRIMARY KEY,
        project_id text NOT NULL DEFAULT 'default' REFERENCES ${schema}.projects(id),
        name text NOT NULL,
        kind text NOT NULL,
        value double precision NOT NULL,
        tags jsonb NOT NULL DEFAULT '{}'::jsonb,
        recorded_at timestamptz NOT NULL
      );

      CREATE INDEX IF NOT EXISTS metric_points_raw_recorded_at_idx ON ${schema}.metric_points_raw (recorded_at DESC);
      CREATE INDEX IF NOT EXISTS metric_points_raw_name_idx ON ${schema}.metric_points_raw (project_id, name);
    `
  },
  {
    id: "0009_metric_rollups",
    sql: (schema) => `
      CREATE TABLE IF NOT EXISTS ${schema}.metric_rollups (
        id text PRIMARY KEY,
        project_id text NOT NULL DEFAULT 'default' REFERENCES ${schema}.projects(id),
        name text NOT NULL,
        kind text NOT NULL,
        bucket_start timestamptz NOT NULL,
        bucket_size text NOT NULL,
        tags jsonb NOT NULL DEFAULT '{}'::jsonb,
        sum double precision NOT NULL,
        count integer NOT NULL,
        min double precision NOT NULL,
        max double precision NOT NULL
      );

      -- jsonb equality identifies "this metric/tag-combination/bucket" for the rollup upsert.
      CREATE UNIQUE INDEX IF NOT EXISTS metric_rollups_unique_bucket_idx
        ON ${schema}.metric_rollups (project_id, name, tags, bucket_start, bucket_size);
      CREATE INDEX IF NOT EXISTS metric_rollups_name_idx ON ${schema}.metric_rollups (project_id, name);
    `
  }
];

/**
 * Ensures the observability schema, migration-tracking table, and all pending
 * migrations exist. Safe to call concurrently from multiple pools/processes against
 * the same database (e.g. a Node SDK client and a dashboard server booting at the same
 * time): a Postgres advisory lock, scoped to the schema name, serializes migration
 * runs so `CREATE SCHEMA IF NOT EXISTS` races can never produce a duplicate-key error.
 */
export async function migrate(pool: Pool, quotedSchema: string): Promise<void> {
  const client = await pool.connect();
  try {
    await withAdvisoryLock(client, quotedSchema, () => runMigrations(client, quotedSchema));
  } finally {
    client.release();
  }
}

/**
 * Runs a function while holding a session-scoped Postgres advisory lock keyed by the
 * schema name, releasing it afterward even if the function throws.
 */
async function withAdvisoryLock(
  client: PoolClient,
  quotedSchema: string,
  run: () => Promise<void>
): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [quotedSchema]);
  try {
    await run();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [quotedSchema]);
  }
}

/**
 * Creates the schema and migration-tracking table if needed, then applies any
 * migrations that haven't been recorded yet.
 */
async function runMigrations(client: PoolClient, quotedSchema: string): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${quotedSchema}._migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    await applyIfPending(client, quotedSchema, migration);
  }
}

/**
 * Applies a single migration inside a transaction if it hasn't been recorded yet.
 */
async function applyIfPending(
  client: PoolClient,
  quotedSchema: string,
  migration: Migration
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM ${quotedSchema}._migrations WHERE id = $1`,
    [migration.id]
  );
  if (rows.length > 0) {
    return;
  }

  try {
    await client.query("BEGIN");
    await client.query(migration.sql(quotedSchema));
    await client.query(`INSERT INTO ${quotedSchema}._migrations (id) VALUES ($1)`, [
      migration.id
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
