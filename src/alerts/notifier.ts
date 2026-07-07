import { recordEvent } from "../storage/index.js";

import { dispatchAlert } from "./dispatch.js";

import type { Alert, NotificationChannel } from "./types.js";
import type { CaptureInput } from "../core/index.js";
import type { RecordEventResult, StorageHandle } from "../storage/index.js";

/**
 * Wraps storage's `recordEvent` so newly created issues and reopened
 * ("regression") issues are announced to every configured notification channel.
 */
export interface Notifier {
  recordEvent: (handle: StorageHandle, input: CaptureInput, projectId?: string) => Promise<RecordEventResult>;
}

/**
 * Creates a notifier bound to a set of channels. With no channels configured, this
 * behaves exactly like calling storage's `recordEvent` directly.
 */
export function createNotifier(channels: NotificationChannel[]): Notifier {
  return {
    async recordEvent(handle, input, projectId) {
      const result = await recordEvent(handle, input, projectId);
      const alert = toAlert(result);
      if (alert) {
        dispatchAlert(channels, alert);
      }
      return result;
    }
  };
}

/**
 * Maps a record-event result to the alert it should raise, if any. Repeat
 * occurrences of an already-unresolved issue raise nothing.
 */
function toAlert(result: RecordEventResult): Alert | undefined {
  if (result.isNewIssue) {
    return { kind: "new_issue", issue: result.issue, event: result.event };
  }
  if (result.isRegression) {
    return { kind: "regression", issue: result.issue, event: result.event };
  }
  return undefined;
}
