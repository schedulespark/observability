import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { closeStorage, createSavedView, deleteSavedView, initStorage, listSavedViews } from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("saved views", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("creates and lists saved views, oldest first", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await createSavedView(handle, "Unresolved mobile errors", { status: "unresolved", projectId: "mobile-app" });
    await createSavedView(handle, "Database errors", { q: "database" });

    const views = await listSavedViews(handle);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      name: "Unresolved mobile errors",
      filters: { status: "unresolved", projectId: "mobile-app" }
    });
    expect(views[1]).toMatchObject({ name: "Database errors", filters: { q: "database" } });
  });

  it("deletes a saved view", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const view = await createSavedView(handle, "Temporary view", {});
    await deleteSavedView(handle, view.id);

    const views = await listSavedViews(handle);
    expect(views).toHaveLength(0);
  });

  it("is a no-op deleting a view that doesn't exist", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    await expect(deleteSavedView(handle, "does-not-exist")).resolves.toBeUndefined();
  });
});
