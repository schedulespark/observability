import { describe, expect, it } from "vitest";

import { createMetricsApi } from "../src/node/metrics.js";

import type { PendingMetricPoint } from "../src/node/metrics.js";
import type { CaptureQueue } from "../src/node/queue.js";

/**
 * A fake queue that records everything enqueued, for asserting on `MetricsApi`'s
 * behavior without the real batching/flush machinery.
 */
function createRecordingQueue(): { queue: CaptureQueue<PendingMetricPoint>; points: PendingMetricPoint[] } {
  const points: PendingMetricPoint[] = [];
  return {
    points,
    queue: {
      enqueue: (point) => points.push(point),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve()
    }
  };
}

describe("createMetricsApi", () => {
  it("increment() defaults to a value of 1", () => {
    const { queue, points } = createRecordingQueue();
    const metrics = createMetricsApi(queue);

    metrics.increment("shift.create.count");

    expect(points).toEqual([{ name: "shift.create.count", kind: "counter", value: 1, tags: undefined }]);
  });

  it("increment() accepts an explicit value and tags", () => {
    const { queue, points } = createRecordingQueue();
    const metrics = createMetricsApi(queue);

    metrics.increment("widgets.sold", 5, { region: "us-east" });

    expect(points).toEqual([{ name: "widgets.sold", kind: "counter", value: 5, tags: { region: "us-east" } }]);
  });

  it("gauge() and histogram() enqueue their respective kinds", () => {
    const { queue, points } = createRecordingQueue();
    const metrics = createMetricsApi(queue);

    metrics.gauge("queue.depth", 42);
    metrics.histogram("request.duration_ms", 120, { route: "shift.create" });

    expect(points).toEqual([
      { name: "queue.depth", kind: "gauge", value: 42, tags: undefined },
      { name: "request.duration_ms", kind: "histogram", value: 120, tags: { route: "shift.create" } }
    ]);
  });
});
