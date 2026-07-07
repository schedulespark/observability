import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { closeStorage, createProject, findProjectByApiKey, initStorage, listProjects } from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("projects", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("auto-creates a 'default' project with no API key on a fresh schema", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const projects = await listProjects(handle);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: "default", name: "Default", apiKey: null });
  });

  it("creates a project with a generated API key and looks it back up by that key", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const project = await createProject(handle, "Mobile app");
    const apiKey = project.apiKey;
    if (!apiKey) {
      throw new Error("expected createProject to generate an apiKey");
    }

    const found = await findProjectByApiKey(handle, apiKey);
    expect(found).toMatchObject({ id: project.id, name: "Mobile app" });

    const missing = await findProjectByApiKey(handle, "not-a-real-key");
    expect(missing).toBeNull();

    const projects = await listProjects(handle);
    expect(projects.map((p) => p.id)).toEqual(["default", project.id]);
  });
});
