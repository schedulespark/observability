import { randomUUID } from "node:crypto";

import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { createPinoLogStream } from "../src/node/logs.js";
import { closeStorage, initStorage, listLogs } from "../src/storage/index.js";

import type { Writable } from "node:stream";
import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

/**
 * Ends a log stream and waits for its buffered lines to flush, so tests don't need to
 * wait out the real flush interval.
 */
function endAndFlush(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end();
  });
}

describe("createPinoLogStream", () => {
  let handle: StorageHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
      await closeStorage(handle);
      handle = undefined;
    }
  });

  it("forwards warn/error lines from a real pino logger into storage, skipping info by default", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const stream = createPinoLogStream(handle, { flushIntervalMs: 100_000 });
    const logger = pino(stream);

    logger.info("just informational, should be dropped");
    logger.warn({ depth: 42 }, "queue depth high");
    logger.error("worker crashed");
    await endAndFlush(stream);

    const logs = await listLogs(handle);
    expect(logs).toHaveLength(2);
    expect(logs.some((entry) => entry.level === "info")).toBe(false);
    expect(logs.some((entry) => entry.level === "warn" && entry.message === "queue depth high")).toBe(true);
    expect(logs.some((entry) => entry.level === "error" && entry.message === "worker crashed")).toBe(true);

    const warnEntry = logs.find((entry) => entry.level === "warn");
    expect(warnEntry?.context).toMatchObject({ depth: 42 });
  });

  it("forwards info lines when minLevel is set to 'info'", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const stream = createPinoLogStream(handle, { minLevel: "info", flushIntervalMs: 100_000 });
    const logger = pino(stream);

    logger.info("now this should show up");
    await endAndFlush(stream);

    const logs = await listLogs(handle);
    expect(logs).toHaveLength(1);
  });

  it("tags forwarded logs with the configured projectId", async () => {
    const schema = `test_${randomUUID().replace(/-/g, "_")}`;
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });

    const { createProject } = await import("../src/storage/index.js");
    const project = await createProject(handle, "Mobile app");

    const stream = createPinoLogStream(handle, { projectId: project.id, flushIntervalMs: 100_000 });
    const logger = pino(stream);
    logger.error("mobile crash");
    await endAndFlush(stream);

    const logs = await listLogs(handle, { projectId: project.id });
    expect(logs).toHaveLength(1);
  });

  it("never throws on a malformed log line", () => {
    const stream = createPinoLogStream(
      { ready: Promise.resolve(), pool: {} as StorageHandle["pool"], schema: "x", quotedSchema: '"x"' },
      { flushIntervalMs: 100_000 }
    );
    expect(() => stream.write("not valid json\n")).not.toThrow();
  });
});
