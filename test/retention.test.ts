import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeStorage, getIssueWithEvents, initStorage, pruneEvents, recordEvent } from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("pruneEvents", () => {
  let handle: StorageHandle;
  const schema = `test_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(async () => {
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
  });

  afterAll(async () => {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
    await closeStorage(handle);
  });

  it("rejects a non-positive retention window", async () => {
    await expect(pruneEvents(handle, 0)).rejects.toThrow("olderThanDays must be a positive integer");
    await expect(pruneEvents(handle, -5)).rejects.toThrow("olderThanDays must be a positive integer");
  });

  it("deletes only events older than the retention window, keeping the issue", async () => {
    const { event: oldEvent, issue } = await recordEvent(handle, {
      level: "error",
      message: "stale event",
      errorType: "StaleError"
    });
    await handle.pool.query(
      `UPDATE ${handle.quotedSchema}.events SET captured_at = now() - interval '100 days' WHERE id = $1`,
      [oldEvent.id]
    );
    await recordEvent(handle, { level: "error", message: "stale event", errorType: "StaleError" });

    const result = await pruneEvents(handle, 30);
    expect(result.deletedEvents).toBe(1);

    const detail = await getIssueWithEvents(handle, issue.id);
    expect(detail?.events).toHaveLength(1);
    expect(detail?.issue.eventCount).toBe(2);
  });
});
