/**
 * Configuration for a bounded, batched queue.
 */
export interface CaptureQueueOptions<T> {
  flushIntervalMs: number;
  maxQueueSize: number;
  onFlush: (batch: T[]) => Promise<void>;
}

/**
 * A fire-and-forget queue: `enqueue` never blocks or throws, batches are flushed on a
 * timer, and a storage failure is logged rather than propagated into the host app.
 * Generic over item type so both event captures and finished spans can share one
 * implementation.
 */
export interface CaptureQueue<T> {
  enqueue: (item: T) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Creates a queue that buffers items in memory and flushes them in batches, dropping
 * the oldest buffered item when full so a slow or unreachable database can never
 * cause unbounded memory growth in the host process.
 */
export function createCaptureQueue<T>(options: CaptureQueueOptions<T>): CaptureQueue<T> {
  const buffer: T[] = [];
  let flushing = false;

  const flush = async (): Promise<void> => {
    if (flushing || buffer.length === 0) {
      return;
    }
    flushing = true;
    const batch = buffer.splice(0, buffer.length);
    try {
      await options.onFlush(batch);
    } catch (error) {
      console.error("[observability] failed to flush queued items", error);
    } finally {
      flushing = false;
    }
  };

  const timer = setInterval(() => {
    void flush();
  }, options.flushIntervalMs);
  timer.unref();

  return {
    enqueue(item) {
      if (buffer.length >= options.maxQueueSize) {
        buffer.shift();
      }
      buffer.push(item);
    },
    flush,
    async close() {
      clearInterval(timer);
      await flush();
    }
  };
}
