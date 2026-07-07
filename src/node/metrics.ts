import type { CaptureQueue } from "./queue.js";
import type { MetricKind } from "../core/index.js";

const DEFAULT_INCREMENT_VALUE = 1;

/**
 * A metric point queued for storage — the same shape `storage/metrics-ingest.ts`'s
 * `recordMetricPoint` accepts, before it generates an `id`/`recordedAt`.
 */
export interface PendingMetricPoint {
  name: string;
  kind: MetricKind;
  value: number;
  tags?: Record<string, string>;
}

/**
 * StatsD-shaped metrics API, exposed as `client.metrics` on the Node SDK. Tags
 * directly multiply row count — keep them to bounded-cardinality dimensions (e.g.
 * `route`, `statusCode`), not free-form values like a user ID.
 */
export interface MetricsApi {
  increment: (name: string, value?: number, tags?: Record<string, string>) => void;
  gauge: (name: string, value: number, tags?: Record<string, string>) => void;
  histogram: (name: string, value: number, tags?: Record<string, string>) => void;
}

/**
 * Builds the `client.metrics` API bound to a capture queue, batched and flushed the
 * same non-blocking way every other capture path in this package is.
 */
export function createMetricsApi(queue: CaptureQueue<PendingMetricPoint>): MetricsApi {
  return {
    increment(name, value = DEFAULT_INCREMENT_VALUE, tags) {
      queue.enqueue({ name, kind: "counter", value, tags });
    },
    gauge(name, value, tags) {
      queue.enqueue({ name, kind: "gauge", value, tags });
    },
    histogram(name, value, tags) {
      queue.enqueue({ name, kind: "histogram", value, tags });
    }
  };
}
