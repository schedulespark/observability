import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { migrate, migrations } from "../src/storage/migrations.js";
import { quoteSchemaIdentifier } from "../src/storage/schema-ident.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("migrate", () => {
  let pool: Pool | undefined;

  afterEach(async () => {
    if (pool) {
      await pool.end();
      pool = undefined;
    }
  });

  it("is safe when two independent pools migrate the same new schema concurrently", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const quoted = quoteSchemaIdentifier(schema);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const otherPool = new Pool({ connectionString: TEST_DATABASE_URL });

    try {
      await Promise.all([migrate(pool, quoted), migrate(otherPool, quoted)]);
      const { rows } = await pool.query<{ id: string }>(`SELECT id FROM ${quoted}._migrations`);
      expect(rows).toHaveLength(migrations.length);
    } finally {
      await otherPool.end();
      await pool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
    }
  });

  it("backfills pre-existing issues/events into the 'default' project", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const quoted = quoteSchemaIdentifier(schema);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });

    try {
      await pool.query(`CREATE SCHEMA ${quoted}`);
      await pool.query(migrations[0].sql(quoted));
      await pool.query(
        `INSERT INTO ${quoted}.issues (id, fingerprint, title, level, status, event_count, first_seen, last_seen)
         VALUES ('issue-1', 'fp-1', 'Boom', 'error', 'unresolved', 1, now(), now())`
      );
      await pool.query(
        `INSERT INTO ${quoted}.events (id, issue_id, fingerprint, level, message, context, captured_at)
         VALUES ('event-1', 'issue-1', 'fp-1', 'error', 'Boom', '{}'::jsonb, now())`
      );

      await migrate(pool, quoted);

      const { rows: issueRows } = await pool.query<{ project_id: string }>(
        `SELECT project_id FROM ${quoted}.issues WHERE id = 'issue-1'`
      );
      expect(issueRows[0].project_id).toBe("default");

      const { rows: eventRows } = await pool.query<{ project_id: string }>(
        `SELECT project_id FROM ${quoted}.events WHERE id = 'event-1'`
      );
      expect(eventRows[0].project_id).toBe("default");
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
    }
  });
});
