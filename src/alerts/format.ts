import type { Alert } from "./types.js";

export /**
        * Human-readable label for each alert kind, shared across every channel's own
        * formatting so the wording doesn't drift between Slack, email, and webhook
        * payloads.
        */
const ALERT_LABEL: Record<Alert["kind"], string> = {
  new_issue: "New issue",
  regression: "Issue reopened",
  spike: "Error spike"
};

/**
 * A one-line, markup-free summary of an alert — the shared "what happened" wording
 * every channel builds its own presentation on top of.
 */
export function summarizeAlert(alert: Alert): string {
  const label = ALERT_LABEL[alert.kind];
  if (alert.kind === "spike") {
    return `${label}: ${String(alert.count)} errors in the last ${String(alert.windowMinutes)} minutes`;
  }
  return `${label} (${alert.issue.level}): ${alert.issue.title}`;
}

/**
 * The dashboard issue-detail link for an alert, or `undefined` for alert kinds with
 * no single issue to link to (a spike) or when no dashboard URL is configured.
 */
export function alertIssueLink(alert: Alert, dashboardUrl?: string): string | undefined {
  if (alert.kind === "spike" || !dashboardUrl) {
    return undefined;
  }
  return `${dashboardUrl}/issues/${alert.issue.id}`;
}
