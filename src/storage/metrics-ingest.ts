import { randomUUID } from "node:crypto";

import { DEFAULT_PROJECT_ID } from "../core/index.js";

import { mapMetricPointRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { MetricPointRow } from "./rows.js";
import type { MetricKind, MetricPoint } from "../core/index.js";

/**
 * Records a single raw metric data point. Defaults to the `"default"` project like
 * every other capture path. Named `metrics-ingest.ts` (not `metrics.ts`, which already
 * exists for `countEventsSince`/spike alerting) to avoid colliding in both filename
 * and intent with that unrelated module.
 */
export async function recordMetricPoint(
  handle: StorageHandle,
  point: { name: string; kind: MetricKind; value: number; tags?: Record<string, string> },
  projectId: string = DEFAULT_PROJECT_ID
): Promise<MetricPoint> {
  await handle.ready;
  const { rows } = await handle.pool.query<MetricPointRow>(
    `INSERT INTO ${handle.quotedSchema}.metric_points_raw (id, project_id, name, kind, value, tags, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     RETURNING *`,
    [randomUUID(), projectId, point.name, point.kind, point.value, point.tags ?? {}]
  );
  return mapMetricPointRow(rows[0]);
}
