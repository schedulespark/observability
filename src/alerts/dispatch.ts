import type { Alert, NotificationChannel } from "./types.js";

/**
 * Fires every channel independently; a channel that rejects is logged and otherwise
 * ignored so one broken destination can't block the others or event capture itself.
 */
export function dispatchAlert(channels: NotificationChannel[], alert: Alert): void {
  for (const channel of channels) {
    channel.notify(alert).catch((error: unknown) => {
      console.error(`[observability] notification channel "${channel.name}" failed`, error);
    });
  }
}
