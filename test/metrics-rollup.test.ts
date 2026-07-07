import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  closeStorage,
  initStorage,
  listMetricRollups,
  recordMetricPoint,
  rollupMetrics
} from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("rollupMetrics / listMetricRollups", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("aggregates raw points into hour/day buckets", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await recordMetricPoint(handle, { name: "latency", kind: "histogram", value: 100, tags: { route: "shift" } });
    await recordMetricPoint(handle, { name: "latency", kind: "histogram", value: 200, tags: { route: "shift" } });
    await recordMetricPoint(handle, { name: "latency", kind: "histogram", value: 50, tags: { route: "worker" } });

    const result = await rollupMetrics(handle, { rawRetentionDays: 30 });
    expect(result.rolledUpBuckets).toBeGreaterThan(0);
    expect(result.prunedRawPoints).toBe(0);

    const hourly = await listMetricRollups(handle, { bucketSize: "hour" });
    const shiftBucket = hourly.find((rollup) => rollup.tags.route === "shift");
    expect(shiftBucket).toMatchObject({ name: "latency", kind: "histogram", sum: 300, count: 2, min: 100, max: 200 });
    expect(shiftBucket?.avg).toBe(150);

    const workerBucket = hourly.find((rollup) => rollup.tags.route === "worker");
    expect(workerBucket).toMatchObject({ sum: 50, count: 1, min: 50, max: 50, avg: 50 });
  });

  it("replaces (not adds to) a bucket when rerun, so reruns are idempotent", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await recordMetricPoint(handle, { name: "requests", kind: "counter", value: 1 });
    await rollupMetrics(handle, { rawRetentionDays: 30 });
    await recordMetricPoint(handle, { name: "requests", kind: "counter", value: 1 });
    await rollupMetrics(handle, { rawRetentionDays: 30 });

    const hourly = await listMetricRollups(handle, { bucketSize: "hour" });
    const bucket = hourly.find((rollup) => rollup.name === "requests");
    expect(bucket).toMatchObject({ sum: 2, count: 2 });
  });

  it("prunes raw points older than the retention window", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const point = await recordMetricPoint(handle, { name: "old", kind: "gauge", value: 1 });
    await handle.pool.query(
      `UPDATE ${handle.quotedSchema}.metric_points_raw SET recorded_at = now() - interval '10 days' WHERE id = $1`,
      [point.id]
    );
    await recordMetricPoint(handle, { name: "old", kind: "gauge", value: 2 });

    const result = await rollupMetrics(handle, { rawRetentionDays: 3 });
    expect(result.prunedRawPoints).toBe(1);

    const { rows } = await handle.pool.query(`SELECT * FROM ${handle.quotedSchema}.metric_points_raw`);
    expect(rows).toHaveLength(1);
  });

  it("rejects a non-positive retention window", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    await expect(rollupMetrics(handle, { rawRetentionDays: 0 })).rejects.toThrow(
      "rawRetentionDays must be a positive integer"
    );
  });

  it("filters listMetricRollups by projectId", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await recordMetricPoint(handle, { name: "requests", kind: "counter", value: 1 });
    await rollupMetrics(handle, { rawRetentionDays: 30 });

    const scoped = await listMetricRollups(handle, { projectId: "other" });
    expect(scoped).toHaveLength(0);

    const defaultScoped = await listMetricRollups(handle, { projectId: "default" });
    expect(defaultScoped).toHaveLength(1);
  });
});
