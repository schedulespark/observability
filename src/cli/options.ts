import { parseArgs } from "node:util";

/**
 * Common `--db`/`--schema` flags shared by every CLI subcommand.
 */
export interface CommonOptions {
  connectionString: string;
  schema?: string;
}

/**
 * Resolves the database connection string from a `--db` flag or the
 * `OBSERVABILITY_DATABASE_URL` environment variable, throwing a clear error if
 * neither is set.
 */
export function parseCommonOptions(argv: string[]): CommonOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      schema: { type: "string" }
    },
    allowPositionals: true,
    strict: false
  });

  const connectionString = valueAsString(values.db) ?? process.env.OBSERVABILITY_DATABASE_URL;
  if (!connectionString) {
    throw new Error("A database connection string is required: pass --db or set OBSERVABILITY_DATABASE_URL.");
  }

  return { connectionString, schema: valueAsString(values.schema) };
}

/**
 * Narrows a parsed argument value to a string, ignoring booleans/arrays.
 */
export function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
