const VALID_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Validates and double-quotes a Postgres schema name for safe interpolation into SQL.
 * Schema names cannot be bind parameters in `pg`, so this is the only place a
 * caller-supplied string is concatenated into a query — restricting the character set
 * here rules out SQL injection via a malicious/misconfigured schema option.
 */
export function quoteSchemaIdentifier(schema: string): string {
  if (!VALID_IDENTIFIER.test(schema)) {
    throw new Error(
      `Invalid observability schema name "${schema}": must match ${VALID_IDENTIFIER.source}`
    );
  }
  return `"${schema}"`;
}
