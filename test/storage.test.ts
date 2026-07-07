import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addComment,
  assignIssue,
  closeStorage,
  createProject,
  getIssueWithEvents,
  initStorage,
  listIssues,
  recordEvent,
  updateIssueStatus
} from "../src/storage/index.js";

import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("storage", () => {
  let handle: StorageHandle;
  const schema = `test_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(async () => {
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
  });

  afterAll(async () => {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
    await closeStorage(handle);
  });

  it("groups repeated events into a single issue", async () => {
    const first = await recordEvent(handle, {
      level: "error",
      message: "boom",
      errorType: "TypeError",
      stackTrace: "TypeError: boom\n    at handler (/app/src/handler.ts:10:5)"
    });
    const second = await recordEvent(handle, {
      level: "error",
      message: "boom",
      errorType: "TypeError",
      stackTrace: "TypeError: boom\n    at handler (/app/src/handler.ts:12:9)"
    });

    expect(second.issue.id).toBe(first.issue.id);
    expect(second.issue.eventCount).toBe(2);
    expect(first.isNewIssue).toBe(true);
    expect(second.isNewIssue).toBe(false);
    expect(second.isRegression).toBe(false);
  });

  it("reopens a resolved issue on a new event and reports it as a regression", async () => {
    const first = await recordEvent(handle, { level: "error", message: "flaky", errorType: "FlakyError" });
    await updateIssueStatus(handle, first.issue.id, "resolved");

    const second = await recordEvent(handle, { level: "error", message: "flaky", errorType: "FlakyError" });

    expect(second.isRegression).toBe(true);
    expect(second.isNewIssue).toBe(false);
    expect(second.issue.status).toBe("unresolved");
  });

  it("leaves an ignored issue ignored on a new event", async () => {
    const first = await recordEvent(handle, { level: "error", message: "noisy", errorType: "NoisyError" });
    await updateIssueStatus(handle, first.issue.id, "ignored");

    const second = await recordEvent(handle, { level: "error", message: "noisy", errorType: "NoisyError" });

    expect(second.isRegression).toBe(false);
    expect(second.issue.status).toBe("ignored");
  });

  it("lists and fetches issues with their events", async () => {
    await recordEvent(handle, { level: "warning", message: "disk almost full" });

    const issues = await listIssues(handle);
    expect(issues.length).toBeGreaterThan(0);

    const detail = await getIssueWithEvents(handle, issues[0].id);
    expect(detail?.issue.id).toBe(issues[0].id);
    expect(detail?.events.length).toBeGreaterThan(0);
  });

  it("updates issue status", async () => {
    const { issue } = await recordEvent(handle, { level: "info", message: "heads up" });
    const updated = await updateIssueStatus(handle, issue.id, "resolved");
    expect(updated?.status).toBe("resolved");
  });

  it("returns null for a missing issue", async () => {
    const missing = await getIssueWithEvents(handle, "does-not-exist");
    expect(missing).toBeNull();
  });

  it("assigns and unassigns an issue", async () => {
    const { issue } = await recordEvent(handle, { level: "error", message: "needs an owner" });

    const assigned = await assignIssue(handle, issue.id, "ada@example.com");
    expect(assigned?.assignee).toBe("ada@example.com");

    const unassigned = await assignIssue(handle, issue.id, null);
    expect(unassigned?.assignee).toBeNull();
  });

  it("adds and lists comments on an issue, included in getIssueWithEvents", async () => {
    const { issue } = await recordEvent(handle, { level: "error", message: "worth discussing" });

    await addComment(handle, issue.id, { author: "Ada", body: "Looking into this." });
    await addComment(handle, issue.id, { author: "Grace", body: "Found the cause." });

    const detail = await getIssueWithEvents(handle, issue.id);
    expect(detail?.comments).toHaveLength(2);
    expect(detail?.comments[0]).toMatchObject({ author: "Ada", body: "Looking into this." });
    expect(detail?.comments[1]).toMatchObject({ author: "Grace", body: "Found the cause." });
  });

  it("filters issues by a case-insensitive title search", async () => {
    await recordEvent(handle, { level: "error", message: "database connection lost" });
    await recordEvent(handle, { level: "error", message: "totally unrelated" });

    const matches = await listIssues(handle, { q: "CONNECTION" });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((issue) => issue.title.toLowerCase().includes("connection"))).toBe(true);
  });

  it("defaults events to the 'default' project and scopes listIssues by projectId", async () => {
    const mobileProject = await createProject(handle, "Mobile app");

    const { issue: defaultIssue } = await recordEvent(handle, { level: "error", message: "shared error message" });
    expect(defaultIssue.projectId).toBe("default");

    const { issue: otherIssue } = await recordEvent(
      handle,
      { level: "error", message: "shared error message" },
      mobileProject.id
    );
    expect(otherIssue.projectId).toBe(mobileProject.id);
    expect(otherIssue.id).not.toBe(defaultIssue.id);

    const defaultProjectIssues = await listIssues(handle, { projectId: "default" });
    expect(defaultProjectIssues.some((issue) => issue.id === defaultIssue.id)).toBe(true);
    expect(defaultProjectIssues.some((issue) => issue.id === otherIssue.id)).toBe(false);

    const mobileProjectIssues = await listIssues(handle, { projectId: mobileProject.id });
    expect(mobileProjectIssues.some((issue) => issue.id === otherIssue.id)).toBe(true);
    expect(mobileProjectIssues.some((issue) => issue.id === defaultIssue.id)).toBe(false);
  });
});
