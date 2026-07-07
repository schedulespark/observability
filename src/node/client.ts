import { createNotifier, startSpikeMonitor } from "../alerts/index.js";
import { captureInputSchema, createBreadcrumbBuffer, DEFAULT_PROJECT_ID } from "../core/index.js";
import { closeStorage, initStorage, recordMetricPoint, recordSpan } from "../storage/index.js";

import { exceptionToInput, messageToInput } from "./exception.js";
import { createMetricsApi } from "./metrics.js";
import { createCaptureQueue } from "./queue.js";
import { redactSecrets } from "./redact.js";
import { createTracer } from "./tracing.js";

import type { MetricsApi, PendingMetricPoint } from "./metrics.js";
import type { CaptureQueue } from "./queue.js";
import type { Transaction } from "./tracing.js";
import type { NotificationChannel, SpikeMonitor, SpikeMonitorOptions } from "../alerts/index.js";
import type { BreadcrumbInput, CaptureInput, EventContext, EventLevel, RecordedSpan } from "../core/index.js";
import type { StorageHandle } from "../storage/index.js";

const DEFAULT_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_MAX_QUEUE_SIZE = 1000;

/**
 * Options for initializing the Node observability client.
 */
export interface ObservabilityClientOptions {
  connectionString: string;
  schema?: string;
  environment?: string;
  release?: string;
  project?: string;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  beforeCapture?: (input: CaptureInput) => CaptureInput | null;
  channels?: NotificationChannel[];
  captureUncaughtExceptions?: boolean;
  spikeMonitor?: Omit<SpikeMonitorOptions, "channels">;
}

/**
 * The Node SDK's public capture API.
 */
export interface ObservabilityClient {
  captureException: (error: unknown, context?: EventContext) => void;
  captureMessage: (message: string, level?: EventLevel, context?: EventContext) => void;
  addBreadcrumb: (breadcrumb: BreadcrumbInput) => void;
  startTransaction: (name: string, tags?: Record<string, string>) => Transaction;
  metrics: MetricsApi;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Initializes the observability client. Returns immediately (storage connects and
 * migrates in the background) so a slow or briefly unreachable database never delays
 * host application startup; captures made before storage is ready are buffered.
 */
export function init(options: ObservabilityClientOptions): ObservabilityClient {
  let handle: StorageHandle | undefined;
  let spikeMonitor: SpikeMonitor | undefined;
  const notifier = createNotifier(options.channels ?? []);
  const ready = initStorage({ connectionString: options.connectionString, schema: options.schema })
    .then((initialized) => {
      handle = initialized;
      if (options.spikeMonitor) {
        spikeMonitor = startSpikeMonitor(initialized, { ...options.spikeMonitor, channels: options.channels ?? [] });
      }
    })
    .catch((error: unknown) => {
      console.error("[observability] failed to initialize storage", error);
    });

  const flushDeps: FlushDeps = { notifier, projectId: options.project ?? DEFAULT_PROJECT_ID };
  const { queue, spanQueue, metricQueue } = createQueues(options, ready, () => handle, flushDeps);
  const tracer = createTracer(spanQueue);
  const breadcrumbs = createBreadcrumbBuffer();

  const capture = (input: CaptureInput): void => {
    enqueueValidated(queue, applyDefaults({ ...input, breadcrumbs: breadcrumbs.snapshot() }, options), options.beforeCapture);
  };

  const client: ObservabilityClient = {
    captureException(error, context) {
      capture(exceptionToInput(error, mergeContext(context, options)));
    },
    captureMessage(message, level = "info", context) {
      capture(messageToInput(message, level, mergeContext(context, options)));
    },
    addBreadcrumb(breadcrumb) {
      breadcrumbs.add({ ...breadcrumb, data: breadcrumb.data ? redactSecrets(breadcrumb.data) : undefined });
    },
    startTransaction: tracer.startTransaction,
    metrics: createMetricsApi(metricQueue),
    async flush() {
      await Promise.all([queue.flush(), spanQueue.flush(), metricQueue.flush()]);
    },
    async close() {
      spikeMonitor?.stop();
      await Promise.all([queue.close(), spanQueue.close(), metricQueue.close()]);
      await ready;
      if (handle) {
        await closeStorage(handle);
      }
    }
  };

  if (options.captureUncaughtExceptions) {
    registerProcessCrashHandlers(client);
  }

  return client;
}

const CRASH_FLUSH_TIMEOUT_MS = 2000;

/**
 * Reports crashes that would otherwise never reach the SDK: an uncaught exception or
 * unhandled rejection anywhere in the process, not just inside an instrumented
 * request. Node stops terminating the process on its own once a listener is attached,
 * so an uncaught exception is captured, given a bounded window to flush, and then the
 * process is exited — preserving Node's normal crash-on-uncaught-exception behavior
 * instead of leaving the process running in a possibly-corrupted state.
 */
function registerProcessCrashHandlers(client: ObservabilityClient): void {
  process.on("uncaughtException", (error: unknown) => {
    client.captureException(error);
    void Promise.race([client.close(), delay(CRASH_FLUSH_TIMEOUT_MS)]).finally(() => {
      process.exit(1);
    });
  });
  process.on("unhandledRejection", (reason: unknown) => {
    client.captureException(reason);
  });
}

/**
 * Resolves after `ms` milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The notifier and target project shared by every batch a capture queue flushes —
 * bundled into one object so `flushBatch` stays under the linter's max-params limit.
 */
interface FlushDeps {
  notifier: ReturnType<typeof createNotifier>;
  projectId: string;
}

/**
 * Creates the three capture queues `init()` needs (events, spans, metrics), each
 * flushed on the same interval/size limits — extracted out of `init()` itself to
 * keep that function's complexity down.
 */
function createQueues(
  options: ObservabilityClientOptions,
  ready: Promise<void>,
  getHandle: () => StorageHandle | undefined,
  flushDeps: FlushDeps
): { queue: CaptureQueue<CaptureInput>; spanQueue: CaptureQueue<RecordedSpan>; metricQueue: CaptureQueue<PendingMetricPoint> } {
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  return {
    queue: createCaptureQueue<CaptureInput>({
      flushIntervalMs,
      maxQueueSize,
      onFlush: (batch) => flushBatch(batch, ready, getHandle, flushDeps)
    }),
    spanQueue: createCaptureQueue<RecordedSpan>({
      flushIntervalMs,
      maxQueueSize,
      onFlush: (batch) => flushSpanBatch(batch, ready, getHandle)
    }),
    metricQueue: createCaptureQueue<PendingMetricPoint>({
      flushIntervalMs,
      maxQueueSize,
      onFlush: (batch) => flushMetricBatch(batch, ready, getHandle, flushDeps.projectId)
    })
  };
}

/**
 * Waits for storage to be ready, then persists a batch of buffered captures, notifying
 * any configured alert channels about newly created issues along the way.
 */
async function flushBatch(
  batch: CaptureInput[],
  ready: Promise<void>,
  getHandle: () => StorageHandle | undefined,
  deps: FlushDeps
): Promise<void> {
  await ready;
  const handle = getHandle();
  if (!handle) {
    return;
  }
  for (const input of batch) {
    await deps.notifier.recordEvent(handle, input, deps.projectId);
  }
}

/**
 * Waits for storage to be ready, then persists a batch of finished transactions/spans.
 */
async function flushSpanBatch(
  batch: RecordedSpan[],
  ready: Promise<void>,
  getHandle: () => StorageHandle | undefined
): Promise<void> {
  await ready;
  const handle = getHandle();
  if (!handle) {
    return;
  }
  for (const span of batch) {
    await recordSpan(handle, span);
  }
}

/**
 * Waits for storage to be ready, then persists a batch of queued metric points.
 */
async function flushMetricBatch(
  batch: PendingMetricPoint[],
  ready: Promise<void>,
  getHandle: () => StorageHandle | undefined,
  projectId: string
): Promise<void> {
  await ready;
  const handle = getHandle();
  if (!handle) {
    return;
  }
  for (const point of batch) {
    await recordMetricPoint(handle, point, projectId);
  }
}

/**
 * Fills in `environment`/`release` on a context object from client defaults when the
 * caller didn't set them explicitly.
 */
function mergeContext(
  context: EventContext | undefined,
  options: ObservabilityClientOptions
): EventContext {
  return {
    ...context,
    environment: context?.environment ?? options.environment,
    release: context?.release ?? options.release
  };
}

/**
 * Applies client-level defaults to a capture input's context.
 */
function applyDefaults(input: CaptureInput, options: ObservabilityClientOptions): CaptureInput {
  return { ...input, context: mergeContext(input.context, options) };
}

/**
 * Validates a capture input against the wire schema, runs it through the caller's
 * `beforeCapture` hook if provided, and enqueues it unless either step drops it.
 */
function enqueueValidated(
  queue: CaptureQueue<CaptureInput>,
  input: CaptureInput,
  beforeCapture: ObservabilityClientOptions["beforeCapture"]
): void {
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success) {
    console.error("[observability] dropped invalid capture", parsed.error.message);
    return;
  }
  const filtered = beforeCapture ? beforeCapture(parsed.data) : parsed.data;
  if (filtered) {
    queue.enqueue(filtered);
  }
}
