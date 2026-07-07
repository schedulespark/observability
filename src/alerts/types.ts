import type { CapturedEvent, Issue } from "../core/index.js";

/**
 * Fired the first time a fingerprint is ever seen.
 */
export interface NewIssueAlert {
  kind: "new_issue";
  issue: Issue;
  event: CapturedEvent;
}

/**
 * Fired when a previously-resolved issue receives a new event (auto-reopened).
 */
export interface RegressionAlert {
  kind: "regression";
  issue: Issue;
  event: CapturedEvent;
}

/**
 * Fired when the error rate over a rolling window crosses a configured threshold.
 */
export interface SpikeAlert {
  kind: "spike";
  count: number;
  windowMinutes: number;
}

/**
 * Payload delivered to a notification channel.
 */
export type Alert = NewIssueAlert | RegressionAlert | SpikeAlert;

/**
 * A destination for alert notifications (webhook, Slack, email, ...). Implementations
 * must never throw past the notifier — failures are caught and logged so a broken
 * channel can't block event capture.
 */
export interface NotificationChannel {
  name: string;
  notify: (alert: Alert) => Promise<void>;
}
