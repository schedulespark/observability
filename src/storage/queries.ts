import { randomUUID } from "node:crypto";

import { computeFingerprint } from "../core/fingerprint.js";
import { DEFAULT_PROJECT_ID } from "../core/index.js";

import { listComments } from "./comments.js";
import { deriveTitle, mapEventRow, mapIssueRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { EventRow, IssueRow } from "./rows.js";
import type { CapturedEvent, CaptureInput, Comment, Issue, IssueStatus } from "../core/index.js";

const DEFAULT_ISSUE_LIST_LIMIT = 100;
const DEFAULT_EVENT_LIST_LIMIT = 50;

type QueryClient = Pick<StorageHandle["pool"], "query">;

interface RecordEventData {
  input: CaptureInput;
  fingerprint: string;
  now: Date;
  projectId: string;
}

/**
 * Result of recording a single captured event.
 */
export interface RecordEventResult {
  event: CapturedEvent;
  issue: Issue;
  isNewIssue: boolean;
  isRegression: boolean;
}

/**
 * Records a captured event: upserts the owning issue (creating it on first
 * occurrence, bumping its counters otherwise) and inserts the event row, all inside a
 * single transaction so the two stay consistent. Events default to the `"default"`
 * project when the caller doesn't configure multi-project support, so this is a
 * purely additive parameter.
 */
export async function recordEvent(
  handle: StorageHandle,
  input: CaptureInput,
  projectId: string = DEFAULT_PROJECT_ID
): Promise<RecordEventResult> {
  await handle.ready;
  const data: RecordEventData = { input, fingerprint: computeFingerprint(input), now: new Date(), projectId };
  const client = await handle.pool.connect();

  try {
    await client.query("BEGIN");
    const issueRow = await upsertIssue(client, handle.quotedSchema, data);
    const eventRow = await insertEvent(client, handle.quotedSchema, data);
    await client.query("COMMIT");
    return {
      event: mapEventRow(eventRow),
      issue: mapIssueRow(issueRow),
      isNewIssue: issueRow.event_count === 1,
      isRegression: issueRow.event_count > 1 && issueRow.previous_status === "resolved"
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface UpsertedIssueRow extends IssueRow {
  previous_status: IssueStatus | null;
}

/**
 * Inserts a new issue row for a fingerprint or, if one already exists, bumps its
 * event count and last-seen timestamp. A fresh event on a previously `resolved`
 * issue automatically reopens it (back to `unresolved`) — `ignored` issues are left
 * alone, since that status is a deliberate "don't tell me about this" choice rather
 * than "this is fixed." The pre-update status is returned as `previous_status` so the
 * caller can detect that reopen and fire a distinct regression alert.
 */
async function upsertIssue(
  client: QueryClient,
  quotedSchema: string,
  data: RecordEventData
): Promise<UpsertedIssueRow> {
  const { rows } = await client.query<UpsertedIssueRow>(
    `WITH previous AS (
       SELECT status FROM ${quotedSchema}.issues WHERE project_id = $2 AND fingerprint = $3
     )
     INSERT INTO ${quotedSchema}.issues
       (id, project_id, fingerprint, title, level, status, event_count, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $5, 'unresolved', 1, $6, $6)
     ON CONFLICT (project_id, fingerprint) DO UPDATE SET
       event_count = ${quotedSchema}.issues.event_count + 1,
       last_seen = $6,
       status = CASE
         WHEN ${quotedSchema}.issues.status = 'resolved' THEN 'unresolved'
         ELSE ${quotedSchema}.issues.status
       END
     RETURNING ${quotedSchema}.issues.*, (SELECT status FROM previous) AS previous_status`,
    [randomUUID(), data.projectId, data.fingerprint, deriveTitle(data.input), data.input.level, data.now]
  );
  return rows[0];
}

/**
 * Inserts a single event row, linked to its issue by fingerprint.
 */
async function insertEvent(
  client: QueryClient,
  quotedSchema: string,
  data: RecordEventData
): Promise<EventRow> {
  const { rows } = await client.query<EventRow>(
    `INSERT INTO ${quotedSchema}.events
       (id, issue_id, project_id, fingerprint, level, message, error_type, stack_trace, context, breadcrumbs, captured_at)
     VALUES (
       $1,
       (SELECT id FROM ${quotedSchema}.issues WHERE project_id = $2 AND fingerprint = $3),
       $2, $3, $4, $5, $6, $7, $8, $9, $10
     )
     RETURNING *`,
    [
      randomUUID(),
      data.projectId,
      data.fingerprint,
      data.input.level,
      data.input.message,
      data.input.errorType ?? null,
      data.input.stackTrace ?? null,
      data.input.context ?? {},
      JSON.stringify(data.input.breadcrumbs ?? []),
      data.now
    ]
  );
  return rows[0];
}

/**
 * Lists issues ordered by most recently seen, optionally filtered by status and/or a
 * case-insensitive substring match on the title.
 */
export async function listIssues(
  handle: StorageHandle,
  options: { status?: IssueStatus; q?: string; limit?: number; projectId?: string } = {}
): Promise<Issue[]> {
  await handle.ready;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options.projectId) {
    params.push(options.projectId);
    conditions.push(`project_id = $${String(params.length)}`);
  }
  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${String(params.length)}`);
  }
  if (options.q) {
    params.push(`%${options.q}%`);
    conditions.push(`title ILIKE $${String(params.length)}`);
  }
  params.push(options.limit ?? DEFAULT_ISSUE_LIST_LIMIT);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await handle.pool.query<IssueRow>(
    `SELECT * FROM ${handle.quotedSchema}.issues ${where} ORDER BY last_seen DESC LIMIT $${String(params.length)}`,
    params
  );
  return rows.map(mapIssueRow);
}

/**
 * Fetches a single issue, its most recent events, and its comments, or `null` if it
 * doesn't exist (or belongs to a different project than `projectId`, when given).
 */
export async function getIssueWithEvents(
  handle: StorageHandle,
  issueId: string,
  projectId?: string
): Promise<{ issue: Issue; events: CapturedEvent[]; comments: Comment[] } | null> {
  await handle.ready;
  const params = projectId ? [issueId, projectId] : [issueId];
  const { rows: issueRows } = await handle.pool.query<IssueRow>(
    `SELECT * FROM ${handle.quotedSchema}.issues WHERE id = $1 ${projectId ? "AND project_id = $2" : ""}`,
    params
  );
  if (issueRows.length === 0) {
    return null;
  }

  const { rows: eventRows } = await handle.pool.query<EventRow>(
    `SELECT * FROM ${handle.quotedSchema}.events WHERE issue_id = $1 ORDER BY captured_at DESC LIMIT $2`,
    [issueId, DEFAULT_EVENT_LIST_LIMIT]
  );
  const comments = await listComments(handle, issueId);

  return { issue: mapIssueRow(issueRows[0]), events: eventRows.map(mapEventRow), comments };
}

/**
 * Updates an issue's workflow status, returning the updated issue or `null` if it
 * doesn't exist.
 */
export async function updateIssueStatus(
  handle: StorageHandle,
  issueId: string,
  status: IssueStatus
): Promise<Issue | null> {
  await handle.ready;
  const { rows } = await handle.pool.query<IssueRow>(
    `UPDATE ${handle.quotedSchema}.issues SET status = $2 WHERE id = $1 RETURNING *`,
    [issueId, status]
  );
  return rows.length > 0 ? mapIssueRow(rows[0]) : null;
}

/**
 * Assigns (or unassigns, with `null`) an issue, returning the updated issue or `null`
 * if it doesn't exist.
 */
export async function assignIssue(
  handle: StorageHandle,
  issueId: string,
  assignee: string | null
): Promise<Issue | null> {
  await handle.ready;
  const { rows } = await handle.pool.query<IssueRow>(
    `UPDATE ${handle.quotedSchema}.issues SET assignee = $2 WHERE id = $1 RETURNING *`,
    [issueId, assignee]
  );
  return rows.length > 0 ? mapIssueRow(rows[0]) : null;
}
