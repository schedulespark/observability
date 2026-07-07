import { alertIssueLink, summarizeAlert } from "./format.js";

import type { Alert, NotificationChannel } from "./types.js";

/**
 * Creates a channel that POSTs a generic JSON payload describing the alert to any
 * webhook URL.
 */
export function webhookChannel(url: string, options: { name?: string } = {}): NotificationChannel {
  return {
    name: options.name ?? "webhook",
    notify: (alert) => postJson(url, toWebhookPayload(alert))
  };
}

/**
 * Creates a channel formatted for Slack (or Slack-compatible) incoming webhooks.
 */
export function slackWebhookChannel(
  url: string,
  options: { dashboardUrl?: string } = {}
): NotificationChannel {
  return {
    name: "slack",
    notify: (alert) => postJson(url, { text: toSlackText(alert, options.dashboardUrl) })
  };
}

/**
 * Builds the generic JSON body sent to a webhook channel.
 */
function toWebhookPayload(alert: Alert): Record<string, unknown> {
  if (alert.kind === "spike") {
    return { kind: alert.kind, count: alert.count, windowMinutes: alert.windowMinutes };
  }
  return {
    kind: alert.kind,
    issueId: alert.issue.id,
    title: alert.issue.title,
    level: alert.issue.level,
    message: alert.event.message,
    firstSeen: alert.issue.firstSeen
  };
}

/**
 * Formats a Slack message for an alert, linking to the dashboard when a base URL is
 * configured (issue-scoped alerts only — a spike has no single issue to link to).
 */
function toSlackText(alert: Alert, dashboardUrl?: string): string {
  const emoji = alert.kind === "spike" ? ":chart_with_upwards_trend:" : ":rotating_light:";
  const link = alertIssueLink(alert, dashboardUrl);
  return `${emoji} ${summarizeAlert(alert)}${link ? ` <${link}|View>` : ""}`;
}

/**
 * POSTs a JSON body to a webhook URL, throwing on a non-2xx response so the caller's
 * error handling (never propagated back to event capture) can log it.
 */
async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`webhook responded with status ${String(response.status)}`);
  }
}
