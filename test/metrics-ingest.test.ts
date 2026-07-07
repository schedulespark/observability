import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { closeStorage, createProject, initStorage, recordMetricPoint } from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("recordMetricPoint", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("records a raw metric point, defaulting to the 'default' project", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const point = await recordMetricPoint(handle, {
      name: "shift.create.count",
      kind: "counter",
      value: 1,
      tags: { route: "shift.create" }
    });

    expect(point).toMatchObject({
      name: "shift.create.count",
      kind: "counter",
      value: 1,
      tags: { route: "shift.create" }
    });
    expect(typeof point.id).toBe("string");
    expect(typeof point.recordedAt).toBe("string");

    const { rows } = await handle.pool.query<{ project_id: string }>(
      `SELECT project_id FROM ${handle.quotedSchema}.metric_points_raw WHERE id = $1`,
      [point.id]
    );
    expect(rows[0].project_id).toBe("default");
  });

  it("tags a point with an explicit projectId", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const project = await createProject(handle, "Mobile app");

    await recordMetricPoint(handle, { name: "requests", kind: "gauge", value: 42 }, project.id);

    const { rows } = await handle.pool.query<{ project_id: string; value: string }>(
      `SELECT project_id, value FROM ${handle.quotedSchema}.metric_points_raw WHERE name = 'requests'`
    );
    expect(rows[0].project_id).toBe(project.id);
    expect(Number(rows[0].value)).toBe(42);
  });

  it("defaults tags to an empty object when omitted", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const point = await recordMetricPoint(handle, { name: "latency", kind: "histogram", value: 120 });
    expect(point.tags).toEqual({});
  });
});
