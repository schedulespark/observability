import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { closeStorage, createProject, initStorage, listLogs, pruneLogs, recordLog } from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("logs", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("records and lists log lines, most recent first", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await recordLog(handle, { level: "warn", message: "queue depth high", context: { depth: 42 } });
    await recordLog(handle, { level: "error", message: "worker crashed" });

    const logs = await listLogs(handle);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ level: "error", message: "worker crashed" });
    expect(logs[1]).toMatchObject({ level: "warn", message: "queue depth high", context: { depth: 42 } });
  });

  it("defaults to the 'default' project and filters by level and projectId", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const project = await createProject(handle, "Mobile app");

    await recordLog(handle, { level: "info", message: "default project log" });
    await recordLog(handle, { level: "error", message: "mobile project log" }, project.id);

    const errorsOnly = await listLogs(handle, { level: "error" });
    expect(errorsOnly).toHaveLength(1);
    expect(errorsOnly[0].message).toBe("mobile project log");

    const mobileLogs = await listLogs(handle, { projectId: project.id });
    expect(mobileLogs).toHaveLength(1);
    expect(mobileLogs[0].message).toBe("mobile project log");
  });

  it("prunes log lines older than the retention window", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await recordLog(handle, { level: "info", message: "recent log" });
    await handle.pool.query(
      `UPDATE ${handle.quotedSchema}.logs SET logged_at = now() - interval '30 days'`
    );
    await recordLog(handle, { level: "info", message: "another recent log" });

    const result = await pruneLogs(handle, 7);
    expect(result.deletedLogs).toBe(1);

    const remaining = await listLogs(handle);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe("another recent log");
  });

  it("rejects a non-positive-integer retention window", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await expect(pruneLogs(handle, 0)).rejects.toThrow();
    await expect(pruneLogs(handle, -1)).rejects.toThrow();
  });
});
