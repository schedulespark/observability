import { countEventsSince } from "../storage/index.js";

import { dispatchAlert } from "./dispatch.js";

import type { NotificationChannel } from "./types.js";
import type { StorageHandle } from "../storage/index.js";

/**
 * Options for the spike monitor.
 */
export interface SpikeMonitorOptions {
  channels: NotificationChannel[];
  thresholdCount?: number;
  windowMinutes?: number;
  checkIntervalMs?: number;
}

/**
 * A running spike monitor.
 */
export interface SpikeMonitor {
  stop: () => void;
}

const DEFAULT_THRESHOLD_COUNT = 20;
const DEFAULT_WINDOW_MINUTES = 5;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

/**
 * Periodically checks the error rate over a rolling window and notifies channels
 * once it crosses a threshold, with a cooldown (one window's length) between
 * repeated alerts so a sustained spike doesn't re-notify on every check. State is
 * kept in memory only, so each process/instance monitors independently — fine for a
 * single-instance self-hosted setup, an undercount risk with multiple instances.
 */
export function startSpikeMonitor(handle: StorageHandle, options: SpikeMonitorOptions): SpikeMonitor {
  const thresholdCount = options.thresholdCount ?? DEFAULT_THRESHOLD_COUNT;
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  let lastAlertedAt = 0;

  const timer = setInterval(() => {
    void checkForSpike({ handle, options, thresholdCount, windowMinutes, lastAlertedAt }).then((alertedAt) => {
      lastAlertedAt = alertedAt;
    });
  }, options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS);
  timer.unref();

  return { stop: () => { clearInterval(timer); } };
}

interface CheckContext {
  handle: StorageHandle;
  options: SpikeMonitorOptions;
  thresholdCount: number;
  windowMinutes: number;
  lastAlertedAt: number;
}

/**
 * Runs one spike check, returning the (possibly updated) `lastAlertedAt` timestamp.
 */
async function checkForSpike(ctx: CheckContext): Promise<number> {
  try {
    const count = await countEventsSince(ctx.handle, "error", ctx.windowMinutes);
    const cooledDown = Date.now() - ctx.lastAlertedAt > ctx.windowMinutes * 60_000;
    if (count >= ctx.thresholdCount && cooledDown) {
      dispatchAlert(ctx.options.channels, { kind: "spike", count, windowMinutes: ctx.windowMinutes });
      return Date.now();
    }
  } catch (error) {
    console.error("[observability] spike monitor check failed", error);
  }
  return ctx.lastAlertedAt;
}
