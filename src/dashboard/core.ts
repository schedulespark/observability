import { createNotifier } from "../alerts/index.js";
import { captureInputSchema, DEFAULT_PROJECT_ID } from "../core/index.js";
import {
  addComment,
  assignIssue,
  createSavedView,
  deleteSavedView,
  findProjectByApiKey,
  getIssueWithEvents,
  listIssues,
  listLogs,
  listMetricRollups,
  listProjects,
  listSavedViews,
  listTransactions,
  updateIssueStatus
} from "../storage/index.js";

import type { NotificationChannel } from "../alerts/index.js";
import type {
  CapturedEvent,
  Comment,
  Issue,
  IssueStatus,
  LogEntry,
  LogLevel,
  MetricBucketSize,
  MetricRollup,
  Project,
  RecordedSpan,
  SavedView,
  SavedViewFilters
} from "../core/index.js";
import type { StorageHandle } from "../storage/index.js";

/**
 * Result of attempting to ingest a single capture payload.
 */
export type IngestResult = { ok: true } | { ok: false; error: string };

/**
 * Filters accepted by `Dashboard.listIssues`.
 */
export interface ListIssuesOptions {
  status?: IssueStatus;
  q?: string;
  projectId?: string;
}

/**
 * Framework-agnostic dashboard operations: ingestion plus the read/update queries
 * the UI needs. Kept independent of any HTTP framework so a new server adapter
 * (Fastify, Express, a future Next.js route) only has to translate requests/responses,
 * never reimplement this logic.
 */
export interface Dashboard {
  ingest: (payload: unknown, projectId?: string) => Promise<IngestResult>;
  listIssues: (options?: ListIssuesOptions) => Promise<Issue[]>;
  getIssue: (id: string) => Promise<{ issue: Issue; events: CapturedEvent[]; comments: Comment[] } | null>;
  updateIssueStatus: (id: string, status: IssueStatus) => Promise<Issue | null>;
  assignIssue: (id: string, assignee: string | null) => Promise<Issue | null>;
  addComment: (id: string, input: { author: string; body: string }) => Promise<Comment>;
  listTransactions: () => Promise<RecordedSpan[]>;
  listProjects: () => Promise<Project[]>;
  resolveProjectId: (apiKey: string | undefined) => Promise<string>;
  listSavedViews: () => Promise<SavedView[]>;
  createSavedView: (name: string, filters: SavedViewFilters) => Promise<SavedView>;
  deleteSavedView: (id: string) => Promise<void>;
  listLogs: (options?: { level?: LogLevel; projectId?: string }) => Promise<LogEntry[]>;
  listMetricRollups: (options?: { bucketSize?: MetricBucketSize; projectId?: string }) => Promise<MetricRollup[]>;
}

/**
 * Options for building the dashboard operations.
 */
export interface DashboardOptions {
  channels?: NotificationChannel[];
}

/**
 * Builds the dashboard operations bound to a storage handle. Ingested events notify
 * any configured alert channels the same way the Node SDK does, so alerts fire
 * regardless of whether an event arrived in-process or over HTTP.
 */
export function createDashboard(storage: StorageHandle, options: DashboardOptions = {}): Dashboard {
  const notifier = createNotifier(options.channels ?? []);
  return {
    async ingest(payload, projectId) {
      const parsed = captureInputSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }
      await notifier.recordEvent(storage, parsed.data, projectId);
      return { ok: true };
    },
    listIssues: (filters) => listIssues(storage, filters),
    getIssue: (id) => getIssueWithEvents(storage, id),
    updateIssueStatus: (id, status) => updateIssueStatus(storage, id, status),
    assignIssue: (id, assignee) => assignIssue(storage, id, assignee),
    addComment: (id, input) => addComment(storage, id, input),
    listTransactions: () => listTransactions(storage),
    listProjects: () => listProjects(storage),
    async resolveProjectId(apiKey) {
      if (!apiKey) {
        return DEFAULT_PROJECT_ID;
      }
      const project = await findProjectByApiKey(storage, apiKey);
      return project?.id ?? DEFAULT_PROJECT_ID;
    },
    listSavedViews: () => listSavedViews(storage),
    createSavedView: (name, filters) => createSavedView(storage, name, filters),
    deleteSavedView: (id) => deleteSavedView(storage, id),
    listLogs: (filters) => listLogs(storage, filters),
    listMetricRollups: (filters) => listMetricRollups(storage, filters)
  };
}
