import { Pool } from "pg";

import { migrate } from "./migrations.js";
import { quoteSchemaIdentifier } from "./schema-ident.js";

/**
 * Options for connecting the observability storage layer to a Postgres database.
 */
export interface StorageOptions {
  connectionString: string;
  schema?: string;
}

/**
 * A connected storage handle: the underlying pool, the quoted schema identifier every
 * query is scoped to, and a `ready` promise that resolves once migrations have been
 * applied (or rejects if they failed). Every query function awaits `ready` first, so
 * it's always safe to query a handle immediately after `createStorage()` returns.
 */
export interface StorageHandle {
  pool: Pool;
  schema: string;
  quotedSchema: string;
  ready: Promise<void>;
}

const DEFAULT_SCHEMA = "observability";

/**
 * Opens a connection pool for the observability database, scoped to its own schema so
 * it can coexist safely inside a host application's existing database, and starts
 * migrating that schema in the background (never blocking the caller).
 */
export function createStorage(options: StorageOptions): StorageHandle {
  const schema = options.schema ?? DEFAULT_SCHEMA;
  const quotedSchema = quoteSchemaIdentifier(schema);
  const pool = new Pool({ connectionString: options.connectionString });

  pool.on("error", (error: unknown) => {
    console.error("[observability] idle Postgres client error", error);
  });

  const ready = migrate(pool, quotedSchema);
  // Mark the rejection as handled so Node doesn't warn/crash if a caller never
  // awaits `ready` themselves; the real rejection is still observable through it.
  ready.catch(() => undefined);

  return { pool, schema, quotedSchema, ready };
}

/**
 * Closes the underlying connection pool. Safe to call during graceful shutdown.
 */
export async function closeStorage(handle: StorageHandle): Promise<void> {
  await handle.pool.end();
}
