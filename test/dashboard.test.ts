import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDashboard, registerDashboard } from "../src/dashboard/index.js";
import {
  closeStorage,
  createProject,
  initStorage,
  recordLog,
  recordMetricPoint,
  recordSpan,
  rollupMetrics
} from "../src/storage/index.js";

import type { FastifyInstance } from "fastify";
import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("dashboard", () => {
  let handle: StorageHandle;
  let app: FastifyInstance;
  const schema = `test_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(async () => {
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    app = Fastify();
    registerDashboard(app, createDashboard(handle), {
      prefix: "/observability",
      authorize: (request) => request.headers["x-admin"] === "yes"
    });
  });

  afterAll(async () => {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
    await closeStorage(handle);
  });

  it("rejects unauthorized dashboard access", async () => {
    const response = await app.inject({ method: "GET", url: "/observability" });
    expect(response.statusCode).toBe(401);
  });

  it("ingests an event over HTTP and shows it in the dashboard", async () => {
    const ingest = await app.inject({
      method: "POST",
      url: "/observability/ingest",
      payload: { level: "error", message: "browser boom", errorType: "TypeError" }
    });
    expect(ingest.statusCode).toBe(202);

    const list = await app.inject({
      method: "GET",
      url: "/observability",
      headers: { "x-admin": "yes" }
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain("browser boom");
  });

  it("rejects a malformed ingest payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/observability/ingest",
      payload: { message: "" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("shows issue detail and updates status", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/observability/api/issues",
      headers: { "x-admin": "yes" }
    });
    const issues = list.json() as { id: string }[];
    const issueId = issues[0].id;

    const detail = await app.inject({
      method: "GET",
      url: `/observability/issues/${issueId}`,
      headers: { "x-admin": "yes" }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("TypeError");

    const update = await app.inject({
      method: "POST",
      url: `/observability/issues/${issueId}/status`,
      headers: { "x-admin": "yes" },
      payload: { status: "resolved" }
    });
    expect(update.statusCode).toBe(302);
  });

  it("assigns an issue and shows the assignee on the detail page", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/observability/api/issues",
      headers: { "x-admin": "yes" }
    });
    const issueId = (list.json() as { id: string }[])[0].id;

    const assign = await app.inject({
      method: "POST",
      url: `/observability/issues/${issueId}/assign`,
      headers: { "x-admin": "yes" },
      payload: { assignee: "ada@example.com" }
    });
    expect(assign.statusCode).toBe(302);

    const detail = await app.inject({
      method: "GET",
      url: `/observability/issues/${issueId}`,
      headers: { "x-admin": "yes" }
    });
    expect(detail.body).toContain("ada@example.com");
  });

  it("adds a comment and shows it on the detail page", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/observability/api/issues",
      headers: { "x-admin": "yes" }
    });
    const issueId = (list.json() as { id: string }[])[0].id;

    const comment = await app.inject({
      method: "POST",
      url: `/observability/issues/${issueId}/comments`,
      headers: { "x-admin": "yes" },
      payload: { author: "Ada", body: "Investigating now." }
    });
    expect(comment.statusCode).toBe(302);

    const detail = await app.inject({
      method: "GET",
      url: `/observability/issues/${issueId}`,
      headers: { "x-admin": "yes" }
    });
    expect(detail.body).toContain("Investigating now.");
  });

  it("filters the issues list by the ?q= search param", async () => {
    await app.inject({
      method: "POST",
      url: "/observability/ingest",
      payload: { level: "error", message: "database timeout" }
    });

    const response = await app.inject({
      method: "GET",
      url: "/observability?q=timeout",
      headers: { "x-admin": "yes" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("database timeout");
    expect(response.body).not.toContain("browser boom");
  });

  it("saves the current search as a named view, applies it, and deletes it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/observability/views",
      headers: { "x-admin": "yes" },
      payload: { name: "Timeout errors", q: "timeout", project: "", status: "" }
    });
    expect(create.statusCode).toBe(302);

    const list = await app.inject({
      method: "GET",
      url: "/observability",
      headers: { "x-admin": "yes" }
    });
    expect(list.body).toContain("Timeout errors");
    expect(list.body).toContain("?q=timeout");

    const viewId = /\/observability\/views\/([^/]+)\/delete/.exec(list.body)?.[1];
    expect(viewId).toBeDefined();

    const remove = await app.inject({
      method: "POST",
      url: `/observability/views/${String(viewId)}/delete`,
      headers: { "x-admin": "yes" }
    });
    expect(remove.statusCode).toBe(302);

    const afterDelete = await app.inject({
      method: "GET",
      url: "/observability",
      headers: { "x-admin": "yes" }
    });
    expect(afterDelete.body).not.toContain("Timeout errors");
  });

  it("shows recorded log lines on the /logs page, filterable by ?level=", async () => {
    await recordLog(handle, { level: "warn", message: "queue depth high" });
    await recordLog(handle, { level: "info", message: "routine startup log" });

    const all = await app.inject({
      method: "GET",
      url: "/observability/logs",
      headers: { "x-admin": "yes" }
    });
    expect(all.statusCode).toBe(200);
    expect(all.body).toContain("queue depth high");
    expect(all.body).toContain("routine startup log");

    const warnOnly = await app.inject({
      method: "GET",
      url: "/observability/logs?level=warn",
      headers: { "x-admin": "yes" }
    });
    expect(warnOnly.body).toContain("queue depth high");
    expect(warnOnly.body).not.toContain("routine startup log");
  });

  it("shows recorded transactions on the /transactions page", async () => {
    await recordSpan(handle, {
      id: randomUUID(),
      traceId: randomUUID(),
      parentId: null,
      name: "shift.create",
      status: "ok",
      startedAt: new Date().toISOString(),
      durationMs: 42,
      tags: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/observability/transactions",
      headers: { "x-admin": "yes" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("shift.create");
  });

  it("shows rolled-up metrics on the /metrics page, filterable by ?bucket=", async () => {
    await recordMetricPoint(handle, { name: "shift.create.count", kind: "counter", value: 1 });
    await rollupMetrics(handle, { rawRetentionDays: 30 });

    const response = await app.inject({
      method: "GET",
      url: "/observability/metrics",
      headers: { "x-admin": "yes" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("shift.create.count");

    const dayOnly = await app.inject({
      method: "GET",
      url: "/observability/metrics?bucket=day",
      headers: { "x-admin": "yes" }
    });
    expect(dayOnly.body).toContain("shift.create.count");
  });
});

describe("dashboard ingestKey", () => {
  let handle: StorageHandle;
  let app: FastifyInstance;
  const schema = `test_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(async () => {
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    app = Fastify();
    registerDashboard(app, createDashboard(handle), { ingestKey: "secret-key" });
  });

  afterAll(async () => {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
    await closeStorage(handle);
  });

  it("rejects ingestion without the configured key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: { level: "error", message: "no key" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects ingestion with the wrong key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer wrong-key" },
      payload: { level: "error", message: "wrong key" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("accepts ingestion with the correct key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      headers: { authorization: "Bearer secret-key" },
      payload: { level: "error", message: "right key" }
    });
    expect(response.statusCode).toBe(202);
  });
});

describe("dashboard multi-project", () => {
  let handle: StorageHandle;
  let app: FastifyInstance;
  const schema = `test_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(async () => {
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
    app = Fastify();
    registerDashboard(app, createDashboard(handle), {
      prefix: "/observability",
      authorize: (request) => request.headers["x-admin"] === "yes"
    });
  });

  afterAll(async () => {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
    await closeStorage(handle);
  });

  it("routes an ingested event to the project matching its bearer API key", async () => {
    const project = await createProject(handle, "Mobile app");
    const apiKey = project.apiKey;
    if (!apiKey) {
      throw new Error("expected createProject to generate an apiKey");
    }

    const ingest = await app.inject({
      method: "POST",
      url: "/observability/ingest",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { level: "error", message: "mobile crash" }
    });
    expect(ingest.statusCode).toBe(202);

    const scoped = await app.inject({
      method: "GET",
      url: `/observability/api/issues?project=${project.id}`,
      headers: { "x-admin": "yes" }
    });
    expect((scoped.json() as { title: string }[]).some((issue) => issue.title.includes("mobile crash"))).toBe(true);

    const defaultScoped = await app.inject({
      method: "GET",
      url: "/observability/api/issues?project=default",
      headers: { "x-admin": "yes" }
    });
    expect((defaultScoped.json() as { title: string }[]).some((issue) => issue.title.includes("mobile crash"))).toBe(
      false
    );
  });

  it("falls back to the 'default' project when no bearer token is presented", async () => {
    const ingest = await app.inject({
      method: "POST",
      url: "/observability/ingest",
      payload: { level: "error", message: "unauthenticated ingest" }
    });
    expect(ingest.statusCode).toBe(202);

    const defaultScoped = await app.inject({
      method: "GET",
      url: "/observability/api/issues?project=default",
      headers: { "x-admin": "yes" }
    });
    expect(
      (defaultScoped.json() as { title: string }[]).some((issue) => issue.title.includes("unauthenticated ingest"))
    ).toBe(true);
  });
});
