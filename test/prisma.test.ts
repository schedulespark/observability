import { describe, expect, it } from "vitest";

import { instrumentPrismaClient } from "../src/node/prisma.js";
import { createTracer } from "../src/node/tracing.js";

import type { Transaction } from "../src/node/tracing.js";
import type { RecordedSpan } from "../src/core/index.js";
import type { CaptureQueue } from "../src/node/queue.js";

/**
 * A minimal fake Prisma client implementing just enough of `$extends`' `query`
 * extension shape to exercise `instrumentPrismaClient` without a real database.
 */
function createFakeClient(handlers: { user: { findMany: () => Promise<unknown> } }): {
  $extends: (extension: {
    query: {
      $allModels: {
        $allOperations: (params: {
          model?: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) => Promise<unknown>;
      };
    };
  }) => { user: { findMany: () => Promise<unknown> } };
} {
  return {
    $extends(extension) {
      return {
        user: {
          findMany: () =>
            extension.query.$allModels.$allOperations({
              model: "user",
              operation: "findMany",
              args: {},
              query: () => handlers.user.findMany()
            })
        }
      };
    }
  };
}

/**
 * A fake `CaptureQueue` that records every enqueued span synchronously, for
 * inspecting what `Transaction.startSpan(...).finish(...)` produced without going
 * through the real batching/flush machinery.
 */
function createRecordingQueue(): { queue: CaptureQueue<RecordedSpan>; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  return {
    spans,
    queue: {
      enqueue: (span) => spans.push(span),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve()
    }
  };
}

describe("instrumentPrismaClient", () => {
  it("records a breadcrumb for every query, regardless of an active transaction", async () => {
    const breadcrumbs: { category: string; message: string }[] = [];
    const client = instrumentPrismaClient(createFakeClient({ user: { findMany: () => Promise.resolve([]) } }), {
      addBreadcrumb: (breadcrumb) => breadcrumbs.push(breadcrumb)
    });

    await client.user.findMany();

    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatchObject({ category: "db", message: "prisma.user.findMany" });
  });

  it("records a span for a failed query even when it's faster than the slow-query threshold", async () => {
    const { queue, spans } = createRecordingQueue();
    const tracer = createTracer(queue);
    const transaction: Transaction = tracer.startTransaction("test.transaction");

    const client = instrumentPrismaClient(
      createFakeClient({ user: { findMany: () => Promise.reject(new Error("boom")) } }),
      { getActiveTransaction: () => transaction }
    );

    await expect(client.user.findMany()).rejects.toThrow("boom");

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ name: "prisma.user.findMany", status: "error" });
  });

  it("does not record a span for a fast, successful query below the slow-query threshold", async () => {
    const { queue, spans } = createRecordingQueue();
    const tracer = createTracer(queue);
    const transaction: Transaction = tracer.startTransaction("test.transaction");

    const client = instrumentPrismaClient(createFakeClient({ user: { findMany: () => Promise.resolve([]) } }), {
      getActiveTransaction: () => transaction,
      slowQueryThresholdMs: 100_000
    });

    await client.user.findMany();

    expect(spans).toHaveLength(0);
  });

  it("records a span for a slow, successful query at or above the threshold", async () => {
    const { queue, spans } = createRecordingQueue();
    const tracer = createTracer(queue);
    const transaction: Transaction = tracer.startTransaction("test.transaction");

    const client = instrumentPrismaClient(createFakeClient({ user: { findMany: () => Promise.resolve([]) } }), {
      getActiveTransaction: () => transaction,
      slowQueryThresholdMs: 0
    });

    await client.user.findMany();

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ name: "prisma.user.findMany", status: "ok" });
  });

  it("does not record a span when no transaction is active", async () => {
    const client = instrumentPrismaClient(createFakeClient({ user: { findMany: () => Promise.resolve([]) } }), {
      slowQueryThresholdMs: 0
    });

    await expect(client.user.findMany()).resolves.toEqual([]);
  });
});
