import { Writable } from "node:stream";

import { recordLog } from "../storage/index.js";

import { createCaptureQueue } from "./queue.js";

import type { LogLevel } from "../core/index.js";
import type { StorageHandle } from "../storage/index.js";

const DEFAULT_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_MIN_LEVEL: LogLevel = "warn";

const PINO_LEVEL_LABELS: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal"
};

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
};

interface PendingLogEntry {
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
}

/**
 * Options for `createPinoLogStream`.
 */
export interface PinoLogStreamOptions {
  /** Only lines at/above this level are forwarded (default `"warn"`). */
  minLevel?: LogLevel;
  projectId?: string;
  flushIntervalMs?: number;
  maxQueueSize?: number;
}

/**
 * Creates a `Writable` usable as pino's destination (`pino(opts, stream)`) that
 * forwards log lines at/above `minLevel` into observability storage, batched and
 * flushed the same non-blocking way every other capture path in this package is.
 * Deliberately a plain stream rather than a worker-thread `pino.transport()` — the
 * queue itself is already async/non-blocking, so a synchronous destination is
 * simpler to build, test, and reason about without losing the "never block the host"
 * guarantee.
 */
export function createPinoLogStream(handle: StorageHandle, options: PinoLogStreamOptions = {}): Writable {
  const minRank = LOG_LEVEL_RANK[options.minLevel ?? DEFAULT_MIN_LEVEL];
  const queue = createCaptureQueue<PendingLogEntry>({
    flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxQueueSize: options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
    onFlush: (batch) => flushLogBatch(handle, batch, options.projectId)
  });

  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      for (const line of chunk.toString("utf8").split("\n")) {
        const entry = line.trim().length > 0 ? parsePinoLine(line, minRank) : undefined;
        if (entry) {
          queue.enqueue(entry);
        }
      }
      callback();
    },
    // Flushes any buffered log lines when the stream is ended (e.g. at process
    // shutdown) rather than waiting for the next interval tick — mirrors
    // `ObservabilityClient.close()`'s flush-on-close behavior for the same reason.
    final(callback) {
      queue.close().then(
        () => {
          callback();
        },
        (error: unknown) => {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      );
    }
  });
}

/**
 * Persists a batch of parsed log lines.
 */
async function flushLogBatch(
  handle: StorageHandle,
  batch: PendingLogEntry[],
  projectId: string | undefined
): Promise<void> {
  for (const entry of batch) {
    await recordLog(handle, entry, projectId);
  }
}

/**
 * Parses one pino NDJSON line into a `PendingLogEntry`, or `undefined` if it's below
 * `minRank`, malformed, or otherwise unusable.
 */
function parsePinoLine(line: string, minRank: number): PendingLogEntry | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const rank = typeof parsed.level === "number" ? parsed.level : undefined;
    if (rank === undefined || rank < minRank) {
      return undefined;
    }
    const { level: _level, msg: _msg, time: _time, pid: _pid, hostname: _hostname, ...context } = parsed;
    return {
      level: PINO_LEVEL_LABELS[rank] ?? "info",
      message: typeof parsed.msg === "string" ? parsed.msg : line,
      context
    };
  } catch {
    return undefined;
  }
}
