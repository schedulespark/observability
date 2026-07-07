import { createStorage } from "./pool.js";

import type { StorageHandle, StorageOptions } from "./pool.js";

export { closeStorage, createStorage } from "./pool.js";
export { migrate } from "./migrations.js";
export { addComment, listComments } from "./comments.js";
export { recordLog, listLogs } from "./logs.js";
export { countEventsSince } from "./metrics.js";
export { recordMetricPoint } from "./metrics-ingest.js";
export { listMetricRollups, rollupMetrics } from "./metrics-rollup.js";
export { createProject, findProjectByApiKey, listProjects } from "./projects.js";
export {
  assignIssue,
  getIssueWithEvents,
  listIssues,
  recordEvent,
  updateIssueStatus
} from "./queries.js";
export { pruneEvents, pruneLogs } from "./retention.js";
export { createSavedView, deleteSavedView, listSavedViews } from "./saved-views.js";
export { listTransactions, recordSpan } from "./spans.js";
export type { StorageHandle, StorageOptions } from "./pool.js";
export type { ListMetricRollupsOptions, RollupMetricsOptions, RollupMetricsResult } from "./metrics-rollup.js";
export type { RecordEventResult } from "./queries.js";
export type { PruneLogsResult, PruneResult } from "./retention.js";

/**
 * Opens a storage handle and waits for its migrations to finish before returning it.
 * Prefer this over `createStorage` when you'd rather surface a migration failure
 * immediately (e.g. the standalone CLI) instead of letting it happen in the
 * background — `createStorage` already migrates in the background either way, so
 * this is just `createStorage` plus an explicit `await handle.ready`.
 */
export async function initStorage(options: StorageOptions): Promise<StorageHandle> {
  const handle = createStorage(options);
  await handle.ready;
  return handle;
}

/**
 * Waits for an already-open storage handle's migrations to finish. Useful when a
 * host application wants to log a migration failure without blocking route
 * registration on it.
 */
export function migrateHandle(handle: StorageHandle): Promise<void> {
  return handle.ready;
}
