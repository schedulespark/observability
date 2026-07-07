import { mapMetricRollupRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { MetricRollupRow } from "./rows.js";
import type { MetricBucketSize, MetricRollup } from "../core/index.js";

const DEFAULT_BUCKET_SIZES: MetricBucketSize[] = ["hour", "day"];
const DEFAULT_RAW_RETENTION_DAYS = 3;
const DEFAULT_ROLLUP_LIST_LIMIT = 200;

/**
 * Options controlling a single rollup run.
 */
export interface RollupMetricsOptions {
  bucketSizes?: MetricBucketSize[];
  rawRetentionDays?: number;
}

/**
 * Outcome of a single rollup run.
 */
export interface RollupMetricsResult {
  rolledUpBuckets: number;
  prunedRawPoints: number;
}

/**
 * Re-aggregates every raw metric point into `metric_rollups`, one bucket size at a
 * time, then prunes raw points older than the retention window. Each bucket is a
 * full replace (not an addition) of `sum`/`count`/`min`/`max` from the current raw
 * data, so rerunning this job is always safe — it never double-counts a point that
 * was already rolled up in a previous run.
 */
export async function rollupMetrics(
  handle: StorageHandle,
  options: RollupMetricsOptions = {}
): Promise<RollupMetricsResult> {
  await handle.ready;
  const bucketSizes = options.bucketSizes ?? DEFAULT_BUCKET_SIZES;
  const rawRetentionDays = options.rawRetentionDays ?? DEFAULT_RAW_RETENTION_DAYS;
  if (!Number.isInteger(rawRetentionDays) || rawRetentionDays <= 0) {
    throw new Error(`rawRetentionDays must be a positive integer, got ${String(rawRetentionDays)}`);
  }

  let rolledUpBuckets = 0;
  for (const bucketSize of bucketSizes) {
    rolledUpBuckets += await rollupBucketSize(handle, bucketSize);
  }

  const { rowCount } = await handle.pool.query(
    `DELETE FROM ${handle.quotedSchema}.metric_points_raw WHERE recorded_at < now() - ($1 || ' days')::interval`,
    [rawRetentionDays]
  );

  return { rolledUpBuckets, prunedRawPoints: rowCount ?? 0 };
}

/**
 * Rolls up every raw point into one bucket size, upserting each `(project, name,
 * kind, tags, bucket)` combination.
 */
async function rollupBucketSize(handle: StorageHandle, bucketSize: MetricBucketSize): Promise<number> {
  const { rowCount } = await handle.pool.query(
    `INSERT INTO ${handle.quotedSchema}.metric_rollups
       (id, project_id, name, kind, bucket_start, bucket_size, tags, sum, count, min, max)
     SELECT
       gen_random_uuid()::text,
       project_id,
       name,
       kind,
       date_trunc($1, recorded_at),
       $1,
       tags,
       sum(value),
       count(*),
       min(value),
       max(value)
     FROM ${handle.quotedSchema}.metric_points_raw
     GROUP BY project_id, name, kind, date_trunc($1, recorded_at), tags
     ON CONFLICT (project_id, name, tags, bucket_start, bucket_size)
     DO UPDATE SET
       sum = EXCLUDED.sum,
       count = EXCLUDED.count,
       min = EXCLUDED.min,
       max = EXCLUDED.max`,
    [bucketSize]
  );
  return rowCount ?? 0;
}

/**
 * Options for listing metric rollups.
 */
export interface ListMetricRollupsOptions {
  bucketSize?: MetricBucketSize;
  projectId?: string;
  limit?: number;
}

/**
 * Lists the most recent rollup bucket per `(name, tags)` combination, optionally
 * filtered by bucket size/project. Only the latest bucket per metric is returned —
 * this backs a simple "current state" table view, not a time-series chart.
 */
export async function listMetricRollups(
  handle: StorageHandle,
  options: ListMetricRollupsOptions = {}
): Promise<MetricRollup[]> {
  await handle.ready;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.bucketSize) {
    params.push(options.bucketSize);
    conditions.push(`bucket_size = $${String(params.length)}`);
  }
  if (options.projectId) {
    params.push(options.projectId);
    conditions.push(`project_id = $${String(params.length)}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(options.limit ?? DEFAULT_ROLLUP_LIST_LIMIT);

  const { rows } = await handle.pool.query<MetricRollupRow>(
    `SELECT DISTINCT ON (name, tags) *
     FROM ${handle.quotedSchema}.metric_rollups
     ${where}
     ORDER BY name, tags, bucket_start DESC
     LIMIT $${String(params.length)}`,
    params
  );
  return rows.map(mapMetricRollupRow);
}
