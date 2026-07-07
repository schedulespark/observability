import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createNotifier, emailChannel, startSpikeMonitor, webhookChannel } from "../src/alerts/index.js";
import { closeStorage, initStorage, recordEvent, updateIssueStatus } from "../src/storage/index.js";

import type { AddressInfo } from "node:net";
import type { Transport } from "nodemailer";
import type { StorageHandle } from "../src/storage/index.js";

const TEST_DATABASE_URL =
  process.env.OBSERVABILITY_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/observability_test";

describe("alerts", () => {
  let handle: StorageHandle;
  const schema = `test_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(async () => {
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
  });

  afterAll(async () => {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
    await closeStorage(handle);
  });

  it("notifies once for a new issue but not for repeat occurrences", async () => {
    const channel = { name: "spy", notify: vi.fn().mockResolvedValue(undefined) };
    const notifier = createNotifier([channel]);

    await notifier.recordEvent(handle, { level: "error", message: "recurring", errorType: "Recurring" });
    await notifier.recordEvent(handle, { level: "error", message: "recurring", errorType: "Recurring" });

    expect(channel.notify).toHaveBeenCalledTimes(1);
    expect(channel.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "new_issue" }));
  });

  it("notifies with kind \"regression\" when a resolved issue reopens", async () => {
    const channel = { name: "spy", notify: vi.fn().mockResolvedValue(undefined) };
    const notifier = createNotifier([channel]);

    const { issue } = await notifier.recordEvent(handle, {
      level: "error",
      message: "reopens",
      errorType: "ReopensError"
    });
    await updateIssueStatus(handle, issue.id, "resolved");
    channel.notify.mockClear();

    await notifier.recordEvent(handle, { level: "error", message: "reopens", errorType: "ReopensError" });

    expect(channel.notify).toHaveBeenCalledTimes(1);
    expect(channel.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "regression" }));
  });

  it("logs and continues when a channel rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = { name: "broken", notify: vi.fn().mockRejectedValue(new Error("nope")) };
    const notifier = createNotifier([failing]);

    await notifier.recordEvent(handle, { level: "error", message: "unique failure case" });
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalled();
    });
    errorSpy.mockRestore();
  });

  it("posts the expected JSON payload to a webhook", async () => {
    const received: unknown[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const notifier = createNotifier([webhookChannel(`http://127.0.0.1:${String(port)}/hook`)]);
    await notifier.recordEvent(handle, { level: "error", message: "webhook payload test" });
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({ message: "webhook payload test", level: "error" });

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends an alert email with a link to the dashboard issue", async () => {
    const sent: { to: unknown; subject: unknown; text: unknown }[] = [];
    const fakeTransport: Transport = {
      name: "fake",
      version: "1.0.0",
      send(mail, callback) {
        sent.push({ to: mail.data.to, subject: mail.data.subject, text: mail.data.text });
        callback(null, {});
      }
    };
    const channel = emailChannel({
      to: "team@example.com",
      from: "observability@example.com",
      transport: fakeTransport,
      dashboardUrl: "https://example.com/observability"
    });
    const notifier = createNotifier([channel]);

    await notifier.recordEvent(handle, { level: "error", message: "email alert test" });
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });

    expect(sent[0].to).toBe("team@example.com");
    expect(sent[0].subject).toContain("email alert test");
    expect(sent[0].text).toContain("https://example.com/observability/issues/");
  });
});

describe("startSpikeMonitor", () => {
  let handle: StorageHandle;
  const schema = `test_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(async () => {
    handle = await initStorage({ connectionString: TEST_DATABASE_URL, schema });
  });

  afterAll(async () => {
    await handle.pool.query(`DROP SCHEMA IF EXISTS ${handle.quotedSchema} CASCADE`);
    await closeStorage(handle);
  });

  it("notifies once the error count over the window crosses the threshold", async () => {
    for (let i = 0; i < 3; i += 1) {
      await recordEvent(handle, { level: "error", message: `spike ${String(i)}`, errorType: `SpikeError${String(i)}` });
    }

    const channel = { name: "spy", notify: vi.fn().mockResolvedValue(undefined) };
    const monitor = startSpikeMonitor(handle, {
      channels: [channel],
      thresholdCount: 3,
      windowMinutes: 5,
      checkIntervalMs: 20
    });

    await vi.waitFor(() => {
      expect(channel.notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "spike", count: expect.any(Number) })
      );
    });

    monitor.stop();
  });

  it("does not notify below the threshold", async () => {
    const channel = { name: "spy", notify: vi.fn().mockResolvedValue(undefined) };
    const monitor = startSpikeMonitor(handle, {
      channels: [channel],
      thresholdCount: 1000,
      windowMinutes: 5,
      checkIntervalMs: 20
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(channel.notify).not.toHaveBeenCalled();

    monitor.stop();
  });
});
