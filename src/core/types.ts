import { z } from "zod";

/**
 * Severity of a captured event.
 */
export type EventLevel = "error" | "warning" | "info";

const eventLevelSchema = z.enum(["error", "warning", "info"]);

const eventContextSchema = z.object({
  method: z.string().max(16).optional(),
  route: z.string().max(500).optional(),
  statusCode: z.number().int().optional(),
  environment: z.string().max(100).optional(),
  release: z.string().max(200).optional(),
  userId: z.string().max(200).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  extra: z.record(z.string(), z.unknown()).optional()
});

/**
 * Contextual metadata attached to a captured event.
 */
export type EventContext = z.infer<typeof eventContextSchema>;

const MAX_BREADCRUMBS_PER_EVENT = 100;

const breadcrumbSchema = z.object({
  timestamp: z.string(),
  category: z.string().max(50),
  message: z.string().max(500),
  level: eventLevelSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional()
});

/**
 * A single recorded action ("clicked X", "GET /api/foo → 200") leading up to a
 * captured error.
 */
export type Breadcrumb = z.infer<typeof breadcrumbSchema>;

export /**
        * Validated payload accepted from an SDK or the HTTP ingestion endpoint.
        */
const captureInputSchema = z.object({
  level: eventLevelSchema.default("error"),
  message: z.string().min(1).max(2000),
  errorType: z.string().max(200).optional(),
  stackTrace: z.string().max(20000).optional(),
  context: eventContextSchema.optional(),
  breadcrumbs: z.array(breadcrumbSchema).max(MAX_BREADCRUMBS_PER_EVENT).optional()
});

/**
 * Shape of a validated payload accepted from an SDK or the HTTP ingestion endpoint.
 */
export type CaptureInput = z.infer<typeof captureInputSchema>;

/**
 * A single event as persisted in storage, after fingerprinting.
 */
export interface CapturedEvent {
  id: string;
  fingerprint: string;
  level: EventLevel;
  message: string;
  errorType: string | null;
  stackTrace: string | null;
  context: EventContext;
  breadcrumbs: Breadcrumb[];
  capturedAt: string;
}

/**
 * Workflow status of a grouped issue.
 */
export type IssueStatus = "unresolved" | "resolved" | "ignored";

/**
 * A group of one or more events sharing the same fingerprint.
 */
export interface Issue {
  id: string;
  projectId: string;
  fingerprint: string;
  title: string;
  level: EventLevel;
  status: IssueStatus;
  assignee: string | null;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * A free-text note left on an issue.
 */
export interface Comment {
  id: string;
  issueId: string;
  author: string;
  body: string;
  createdAt: string;
}

export /**
        * The `projectId` every issue/event belongs to when no multi-project setup
        * has been configured — a fresh single-project install behaves identically to
        * before multi-project support existed.
        */
const DEFAULT_PROJECT_ID = "default";

/**
 * A named grouping of issues/events, identified to ingestion clients by its own API
 * key. Every install has at least the auto-created `"default"` project.
 */
export interface Project {
  id: string;
  name: string;
  apiKey: string | null;
  createdAt: string;
}

/**
 * Outcome of a finished transaction or span.
 */
export type SpanStatus = "ok" | "error";

/**
 * A single timed operation: either a root transaction (`parentId: null`) or a span
 * nested directly under one. Basic tracing only supports one level of nesting.
 */
export interface RecordedSpan {
  id: string;
  traceId: string;
  parentId: string | null;
  name: string;
  status: SpanStatus;
  startedAt: string;
  durationMs: number;
  tags: Record<string, string>;
}

/**
 * The filter combination a saved view persists — the same shape as the issues list's
 * own filters, so "apply a view" is just a link built from these fields.
 */
export interface SavedViewFilters {
  status?: IssueStatus;
  q?: string;
  projectId?: string;
}

/**
 * A named, persisted filter combination on the issues list (e.g. "Unresolved mobile
 * errors"), shared across everyone with dashboard access — there's no per-user
 * scoping, matching the rest of the dashboard's no-user-directory design.
 */
export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  createdAt: string;
}

/**
 * A structured log line's severity — pino's own level names, since that's what this
 * feature forwards from.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * A single structured log line, stored separately from `events`/`issues` — log lines
 * don't share the "same bug, many occurrences" fingerprint-grouping semantics errors
 * do, so they get their own table rather than a bolted-on second grouping scheme.
 */
export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  loggedAt: string;
}

/**
 * The kind of a single metric point — StatsD-shaped, matching the Node SDK's
 * `client.metrics.increment/gauge/histogram()` API.
 */
export type MetricKind = "counter" | "gauge" | "histogram";

/**
 * A single raw metric data point. Tags directly multiply row count (one row per
 * unique tag combination per point) — keep them to bounded-cardinality dimensions
 * (e.g. `route`, `statusCode`), not free-form values like a user ID or request ID.
 */
export interface MetricPoint {
  id: string;
  name: string;
  kind: MetricKind;
  value: number;
  tags: Record<string, string>;
  recordedAt: string;
}

/**
 * The rollup granularity a `MetricRollup` bucket was aggregated at.
 */
export type MetricBucketSize = "hour" | "day";

/**
 * A single aggregated bucket of raw metric points, sharing a name/tags combination
 * and time window. `avg` is derived (`sum / count`), not stored.
 */
export interface MetricRollup {
  id: string;
  name: string;
  kind: MetricKind;
  bucketStart: string;
  bucketSize: MetricBucketSize;
  tags: Record<string, string>;
  sum: number;
  count: number;
  min: number;
  max: number;
  avg: number;
}
