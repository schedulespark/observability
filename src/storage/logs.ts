import { randomUUID } from "node:crypto";

import { DEFAULT_PROJECT_ID } from "../core/index.js";

import { mapLogRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { LogRow } from "./rows.js";
import type { LogEntry, LogLevel } from "../core/index.js";

const DEFAULT_LOG_LIST_LIMIT = 100;

/**
 * Records a single structured log line. Defaults to the `"default"` project like
 * every other capture path when the caller doesn't configure multi-project support.
 */
export async function recordLog(
  handle: StorageHandle,
  input: { level: LogLevel; message: string; context?: Record<string, unknown> },
  projectId: string = DEFAULT_PROJECT_ID
): Promise<LogEntry> {
  await handle.ready;
  const { rows } = await handle.pool.query<LogRow>(
    `INSERT INTO ${handle.quotedSchema}.logs (id, project_id, level, message, context, logged_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING *`,
    [randomUUID(), projectId, input.level, input.message, input.context ?? {}]
  );
  return mapLogRow(rows[0]);
}

/**
 * Lists the most recently logged lines, optionally filtered by level and/or project.
 */
export async function listLogs(
  handle: StorageHandle,
  options: { level?: LogLevel; projectId?: string; limit?: number } = {}
): Promise<LogEntry[]> {
  await handle.ready;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options.projectId) {
    params.push(options.projectId);
    conditions.push(`project_id = $${String(params.length)}`);
  }
  if (options.level) {
    params.push(options.level);
    conditions.push(`level = $${String(params.length)}`);
  }
  params.push(options.limit ?? DEFAULT_LOG_LIST_LIMIT);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await handle.pool.query<LogRow>(
    `SELECT * FROM ${handle.quotedSchema}.logs ${where} ORDER BY logged_at DESC LIMIT $${String(params.length)}`,
    params
  );
  return rows.map(mapLogRow);
}
