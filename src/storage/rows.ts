import type {
  Breadcrumb,
  CapturedEvent,
  Comment,
  EventContext,
  EventLevel,
  Issue,
  IssueStatus,
  LogEntry,
  LogLevel,
  MetricBucketSize,
  MetricKind,
  MetricPoint,
  MetricRollup,
  Project,
  RecordedSpan,
  SavedView,
  SavedViewFilters,
  SpanStatus
} from "../core/index.js";

/**
 * Raw shape of a row in the `issues` table.
 */
export interface IssueRow {
  id: string;
  project_id: string;
  fingerprint: string;
  title: string;
  level: string;
  status: string;
  assignee: string | null;
  event_count: number;
  first_seen: Date;
  last_seen: Date;
}

/**
 * Raw shape of a row in the `projects` table.
 */
export interface ProjectRow {
  id: string;
  name: string;
  api_key: string | null;
  created_at: Date;
}

/**
 * Raw shape of a row in the `comments` table.
 */
export interface CommentRow {
  id: string;
  issue_id: string;
  author: string;
  body: string;
  created_at: Date;
}

/**
 * Raw shape of a row in the `events` table.
 */
export interface EventRow {
  id: string;
  fingerprint: string;
  level: string;
  message: string;
  error_type: string | null;
  stack_trace: string | null;
  context: EventContext;
  breadcrumbs: Breadcrumb[];
  captured_at: Date;
}

/**
 * Converts a raw `issues` row into the public `Issue` shape.
 */
export function mapIssueRow(row: IssueRow): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    fingerprint: row.fingerprint,
    title: row.title,
    level: row.level as EventLevel,
    status: row.status as IssueStatus,
    assignee: row.assignee,
    eventCount: row.event_count,
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString()
  };
}

/**
 * Converts a raw `comments` row into the public `Comment` shape.
 */
export function mapCommentRow(row: CommentRow): Comment {
  return {
    id: row.id,
    issueId: row.issue_id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at.toISOString()
  };
}

/**
 * Converts a raw `events` row into the public `CapturedEvent` shape.
 */
export function mapEventRow(row: EventRow): CapturedEvent {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    level: row.level as EventLevel,
    message: row.message,
    errorType: row.error_type,
    stackTrace: row.stack_trace,
    context: row.context,
    breadcrumbs: row.breadcrumbs,
    capturedAt: row.captured_at.toISOString()
  };
}

/**
 * Raw shape of a row in the `spans` table.
 */
export interface SpanRow {
  id: string;
  trace_id: string;
  parent_id: string | null;
  name: string;
  status: string;
  started_at: Date;
  duration_ms: number;
  tags: Record<string, string>;
}

/**
 * Converts a raw `spans` row into the public `RecordedSpan` shape.
 */
export function mapSpanRow(row: SpanRow): RecordedSpan {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentId: row.parent_id,
    name: row.name,
    status: row.status as SpanStatus,
    startedAt: row.started_at.toISOString(),
    durationMs: row.duration_ms,
    tags: row.tags
  };
}

/**
 * Converts a raw `projects` row into the public `Project` shape.
 */
export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    createdAt: row.created_at.toISOString()
  };
}

/**
 * Raw shape of a row in the `saved_views` table.
 */
export interface SavedViewRow {
  id: string;
  name: string;
  filters: SavedViewFilters;
  created_at: Date;
}

/**
 * Converts a raw `saved_views` row into the public `SavedView` shape.
 */
export function mapSavedViewRow(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    name: row.name,
    filters: row.filters,
    createdAt: row.created_at.toISOString()
  };
}

/**
 * Raw shape of a row in the `logs` table.
 */
export interface LogRow {
  id: string;
  level: string;
  message: string;
  context: Record<string, unknown>;
  logged_at: Date;
}

/**
 * Converts a raw `logs` row into the public `LogEntry` shape.
 */
export function mapLogRow(row: LogRow): LogEntry {
  return {
    id: row.id,
    level: row.level as LogLevel,
    message: row.message,
    context: row.context,
    loggedAt: row.logged_at.toISOString()
  };
}

/**
 * Raw shape of a row in the `metric_points_raw` table.
 */
export interface MetricPointRow {
  id: string;
  name: string;
  kind: string;
  value: number;
  tags: Record<string, string>;
  recorded_at: Date;
}

/**
 * Converts a raw `metric_points_raw` row into the public `MetricPoint` shape.
 */
export function mapMetricPointRow(row: MetricPointRow): MetricPoint {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as MetricKind,
    value: row.value,
    tags: row.tags,
    recordedAt: row.recorded_at.toISOString()
  };
}

/**
 * Raw shape of a row in the `metric_rollups` table.
 */
export interface MetricRollupRow {
  id: string;
  name: string;
  kind: string;
  bucket_start: Date;
  bucket_size: string;
  tags: Record<string, string>;
  sum: number;
  count: number;
  min: number;
  max: number;
}

/**
 * Converts a raw `metric_rollups` row into the public `MetricRollup` shape,
 * deriving `avg` (not stored) from `sum`/`count`.
 */
export function mapMetricRollupRow(row: MetricRollupRow): MetricRollup {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as MetricKind,
    bucketStart: row.bucket_start.toISOString(),
    bucketSize: row.bucket_size as MetricBucketSize,
    tags: row.tags,
    sum: row.sum,
    count: row.count,
    min: row.min,
    max: row.max,
    avg: row.count > 0 ? row.sum / row.count : 0
  };
}

const MAX_TITLE_LENGTH = 200;

/**
 * Derives a short human-readable issue title from a capture input.
 */
export function deriveTitle(input: { errorType?: string; message: string }): string {
  const title = input.errorType ? `${input.errorType}: ${input.message}` : input.message;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}…` : title;
}
