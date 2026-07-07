import { mapSpanRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { SpanRow } from "./rows.js";
import type { RecordedSpan } from "../core/index.js";

const DEFAULT_TRANSACTION_LIST_LIMIT = 100;

/**
 * Persists a finished transaction or span.
 */
export async function recordSpan(handle: StorageHandle, span: RecordedSpan): Promise<void> {
  await handle.ready;
  await handle.pool.query(
    `INSERT INTO ${handle.quotedSchema}.spans
       (id, trace_id, parent_id, name, status, started_at, duration_ms, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [span.id, span.traceId, span.parentId, span.name, span.status, span.startedAt, span.durationMs, span.tags]
  );
}

/**
 * Lists root transactions (spans with no parent) ordered by most recent first. Basic
 * tracing only supports one level of nesting, so child spans aren't listed
 * separately — they exist in storage but have no dashboard view yet.
 */
export async function listTransactions(
  handle: StorageHandle,
  options: { limit?: number } = {}
): Promise<RecordedSpan[]> {
  await handle.ready;
  const { rows } = await handle.pool.query<SpanRow>(
    `SELECT * FROM ${handle.quotedSchema}.spans WHERE parent_id IS NULL ORDER BY started_at DESC LIMIT $1`,
    [options.limit ?? DEFAULT_TRANSACTION_LIST_LIMIT]
  );
  return rows.map(mapSpanRow);
}
