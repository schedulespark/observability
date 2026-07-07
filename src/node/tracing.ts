import { randomUUID } from "node:crypto";

import type { CaptureQueue } from "./queue.js";
import type { RecordedSpan, SpanStatus } from "../core/index.js";

const DEFAULT_STATUS: SpanStatus = "ok";

/**
 * A child operation within a transaction. Basic tracing only supports one level of
 * nesting — a span can't start further spans of its own.
 */
export interface Span {
  finish: (status?: SpanStatus) => void;
}

/**
 * A root timed operation (e.g. one tRPC procedure call, one HTTP request).
 */
export interface Transaction {
  startSpan: (name: string, tags?: Record<string, string>) => Span;
  finish: (status?: SpanStatus) => void;
}

/**
 * Starts new transactions, all sharing one underlying span queue.
 */
export interface Tracer {
  startTransaction: (name: string, tags?: Record<string, string>) => Transaction;
}

/**
 * Creates a tracer bound to a queue: `startTransaction` builds transactions/spans
 * that enqueue themselves on `finish()`, batched and flushed the same non-blocking
 * way captured events are.
 */
export function createTracer(queue: CaptureQueue<RecordedSpan>): Tracer {
  return {
    startTransaction(name, tags) {
      const traceId = randomUUID();
      return buildTimedOperation(queue, { traceId, parentId: null, name, tags });
    }
  };
}

interface TimedOperationInput {
  traceId: string;
  parentId: string | null;
  name: string;
  tags?: Record<string, string>;
}

/**
 * Builds a span-like object (used for both transactions and their child spans):
 * tracks its own start time and enqueues a `RecordedSpan` on `finish()`.
 */
function buildTimedOperation(queue: CaptureQueue<RecordedSpan>, input: TimedOperationInput): Transaction {
  const id = randomUUID();
  const startedAt = new Date();
  const start = Date.now();

  return {
    startSpan(name, tags) {
      return buildChildSpan(queue, { traceId: input.traceId, parentId: id, name, tags });
    },
    finish(status = DEFAULT_STATUS) {
      queue.enqueue({
        id,
        traceId: input.traceId,
        parentId: input.parentId,
        name: input.name,
        status,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - start,
        tags: input.tags ?? {}
      });
    }
  };
}

/**
 * Builds a leaf span — like `buildTimedOperation`, but without its own `startSpan`,
 * since basic tracing caps nesting at one level.
 */
function buildChildSpan(queue: CaptureQueue<RecordedSpan>, input: TimedOperationInput): Span {
  const { finish } = buildTimedOperation(queue, input);
  return { finish };
}
