import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { init } from "../src/node/index.js";
import { closeStorage, getIssueWithEvents, listIssues } from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("node client", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("buffers and flushes captures into storage", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const client = init({
      connectionString: TEST_DATABASE_URL,
      schema,
      environment: "test",
      flushIntervalMs: 100_000
    });

    client.captureException(new Error("kaboom"));
    await client.flush();
    await client.close();

    const { initStorage } = await import("../src/storage/index.js");
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const issues = await listIssues(handle);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toContain("kaboom");
  });

  it("buffers and flushes counter/gauge/histogram metric points into storage", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const client = init({ connectionString: TEST_DATABASE_URL, schema, flushIntervalMs: 100_000 });

    client.metrics.increment("shift.create.count", 1, { route: "shift.create" });
    client.metrics.gauge("queue.depth", 42);
    client.metrics.histogram("request.duration_ms", 120);
    await client.flush();
    await client.close();

    const { initStorage } = await import("../src/storage/index.js");
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const { rows } = await handle.pool.query<{ name: string; kind: string; value: string; tags: Record<string, string> }>(
      `SELECT name, kind, value, tags FROM ${handle.quotedSchema}.metric_points_raw ORDER BY name`
    );

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.name === "shift.create.count")).toMatchObject({
      kind: "counter",
      tags: { route: "shift.create" }
    });
    expect(rows.find((row) => row.name === "queue.depth")).toMatchObject({ kind: "gauge" });
    expect(rows.find((row) => row.name === "request.duration_ms")).toMatchObject({ kind: "histogram" });
  });

  it("attaches recent breadcrumbs, redacting secret-looking keys, to the next captured error", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const client = init({ connectionString: TEST_DATABASE_URL, schema, flushIntervalMs: 100_000 });

    client.addBreadcrumb({ category: "nav", message: "loaded /dashboard" });
    client.addBreadcrumb({
      category: "http",
      message: "POST /login",
      data: { statusCode: 401, password: "super-secret" }
    });
    client.captureException(new Error("breadcrumb test"));
    await client.flush();
    await client.close();

    const { initStorage } = await import("../src/storage/index.js");
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const issues = await listIssues(handle);
    const detail = await getIssueWithEvents(handle, issues[0].id);

    expect(detail?.events[0].breadcrumbs).toHaveLength(2);
    expect(detail?.events[0].breadcrumbs[0]).toMatchObject({ category: "nav", message: "loaded /dashboard" });
    expect(detail?.events[0].breadcrumbs[1]).toMatchObject({
      category: "http",
      message: "POST /login",
      data: { statusCode: 401, password: "[redacted]" }
    });
  });

  it("drops captures that fail schema validation instead of throwing", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = init({ connectionString: TEST_DATABASE_URL, schema });

    expect(() => client.captureMessage("")).not.toThrow();
    await client.close();
    errorSpy.mockRestore();

    const { initStorage } = await import("../src/storage/index.js");
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
  });

  it("captures crashes via the optional process-level hooks, then exits", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    init({ connectionString: TEST_DATABASE_URL, schema, captureUncaughtExceptions: true });
    // Distinct wrapping functions give each error a different stack frame, so they
    // fingerprint into separate issues instead of colliding on "thrown at this file".
    function triggerRejection(): Error {
      return new Error("rejected");
    }
    function triggerCrash(): Error {
      return new Error("process crash");
    }
    process.emit("unhandledRejection", triggerRejection(), Promise.resolve());
    process.emit("uncaughtException", triggerCrash());

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    exitSpy.mockRestore();

    const { initStorage } = await import("../src/storage/index.js");
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    const issues = await listIssues(handle);
    const titles = issues.map((issue) => issue.title);
    expect(titles.some((title) => title.includes("process crash"))).toBe(true);
    expect(titles.some((title) => title.includes("rejected"))).toBe(true);
  });
});
