import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { init } from "../src/node/index.js";
import { closeStorage, listTransactions } from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("tracing", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("records a transaction and its span, with the span's parentId set", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const client = init({ connectionString: TEST_DATABASE_URL, schema, flushIntervalMs: 100_000 });

    const tx = client.startTransaction("shift.create", { route: "shift.create" });
    const span = tx.startSpan("db.query");
    await new Promise((resolve) => setTimeout(resolve, 10));
    span.finish("ok");
    tx.finish("ok");

    await client.flush();
    await client.close();

    const { initStorage } = await import("../src/storage/index.js");
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const transactions = await listTransactions(handle);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ name: "shift.create", status: "ok", parentId: null });
    expect(transactions[0].durationMs).toBeGreaterThanOrEqual(0);

    const { rows } = await handle.pool.query<{ name: string; parent_id: string }>(
      `SELECT name, parent_id FROM ${handle.quotedSchema}.spans WHERE parent_id IS NOT NULL`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "db.query", parent_id: transactions[0].id });
  });

  it("defaults a transaction's status to ok when finish() is called with no argument", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const client = init({ connectionString: TEST_DATABASE_URL, schema, flushIntervalMs: 100_000 });

    client.startTransaction("worker.list").finish();
    await client.flush();
    await client.close();

    const { initStorage } = await import("../src/storage/index.js");
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const transactions = await listTransactions(handle);
    expect(transactions[0].status).toBe("ok");
  });
});
