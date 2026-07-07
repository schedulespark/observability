import type { StorageHandle } from "./pool.js";

/**
 * Result of a prune operation.
 */
export interface PruneResult {
  deletedEvents: number;
}

/**
 * Deletes events older than the given retention window, keeping their owning issues
 * (and aggregate counts) intact — only the individual event detail rows (stack
 * traces, context) are dropped. A stopgap against unbounded table growth ahead of
 * proper rollup tables: since this writes into the caller's own database, nothing
 * prunes it automatically unless the deployer schedules this themselves (CLI `prune`
 * or a direct call).
 */
export async function pruneEvents(handle: StorageHandle, olderThanDays: number): Promise<PruneResult> {
  if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
    throw new Error(`olderThanDays must be a positive integer, got ${String(olderThanDays)}`);
  }
  await handle.ready;

  const { rowCount } = await handle.pool.query(
    `DELETE FROM ${handle.quotedSchema}.events WHERE captured_at < now() - ($1 || ' days')::interval`,
    [olderThanDays]
  );
  return { deletedEvents: rowCount ?? 0 };
}

/**
 * Result of pruning old log lines.
 */
export interface PruneLogsResult {
  deletedLogs: number;
}

/**
 * Deletes log lines older than the given retention window. Logs are typically much
 * higher-volume than events, so this is a separate operation with its own (usually
 * shorter) retention window rather than folding into `pruneEvents`.
 */
export async function pruneLogs(handle: StorageHandle, olderThanDays: number): Promise<PruneLogsResult> {
  if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
    throw new Error(`olderThanDays must be a positive integer, got ${String(olderThanDays)}`);
  }
  await handle.ready;

  const { rowCount } = await handle.pool.query(
    `DELETE FROM ${handle.quotedSchema}.logs WHERE logged_at < now() - ($1 || ' days')::interval`,
    [olderThanDays]
  );
  return { deletedLogs: rowCount ?? 0 };
}
