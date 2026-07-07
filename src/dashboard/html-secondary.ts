import { escapeHtml, page } from "./html-shared.js";

import type { LogEntry, MetricRollup, RecordedSpan } from "../core/index.js";

/**
 * Renders the transactions list page (root spans only, no drill-down into child
 * spans yet).
 */
export function renderTransactionsPage(transactions: RecordedSpan[], basePath: string): string {
  const rows = transactions.map((tx) => renderTransactionRow(tx)).join("");
  return page(
    "Transactions",
    `<p><a href="${basePath}">&larr; issues</a></p><h1>Transactions</h1><table><thead><tr><th>Name</th><th>Status</th><th>Duration (ms)</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

/**
 * Renders a single row of the transactions list table.
 */
function renderTransactionRow(tx: RecordedSpan): string {
  const statusClass = tx.status === "error" ? "badge-error" : "badge-info";
  return `<tr>
    <td>${escapeHtml(tx.name)}</td>
    <td><span class="badge ${statusClass}">${escapeHtml(tx.status)}</span></td>
    <td>${String(tx.durationMs)}</td>
    <td>${escapeHtml(tx.startedAt)}</td>
  </tr>`;
}

const LOG_LEVEL_OPTIONS = ["trace", "debug", "info", "warn", "error", "fatal"];
const LOG_LEVEL_BADGE_CLASS: Record<string, string> = {
  trace: "badge-info",
  debug: "badge-info",
  info: "badge-info",
  warn: "badge-warning",
  error: "badge-error",
  fatal: "badge-error"
};

/**
 * Renders the structured log list, optionally filtered by `?level=`.
 */
export function renderLogsPage(logs: LogEntry[], basePath: string, selectedLevel?: string): string {
  const rows = logs.map((entry) => renderLogRow(entry)).join("");
  const levelFilter = `<form method="get" action="${basePath}/logs">
    <select name="level" onchange="this.form.submit()">
      <option value="">Any level</option>
      ${LOG_LEVEL_OPTIONS.map(
        (level) => `<option value="${level}"${level === selectedLevel ? " selected" : ""}>${level}</option>`
      ).join("")}
    </select>
  </form>`;
  return page(
    "Logs",
    `<p><a href="${basePath}">&larr; issues</a></p><h1>Logs</h1>${levelFilter}<table><thead><tr><th>Level</th><th>Message</th><th>Logged at</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

/**
 * Renders a single row of the logs table.
 */
function renderLogRow(entry: LogEntry): string {
  const badgeClass = LOG_LEVEL_BADGE_CLASS[entry.level] ?? "badge-info";
  const context = Object.keys(entry.context).length > 0 ? `<pre>${escapeHtml(JSON.stringify(entry.context))}</pre>` : "";
  return `<tr>
    <td><span class="badge ${badgeClass}">${escapeHtml(entry.level)}</span></td>
    <td>${escapeHtml(entry.message)}${context}</td>
    <td>${escapeHtml(entry.loggedAt)}</td>
  </tr>`;
}

/**
 * Renders the metric rollups list: the latest bucket per name/tags combination,
 * optionally filtered by `?bucket=`.
 */
export function renderMetricsPage(rollups: MetricRollup[], basePath: string, selectedBucket?: string): string {
  const rows = rollups.map((rollup) => renderMetricRollupRow(rollup)).join("");
  const bucketFilter = `<form method="get" action="${basePath}/metrics">
    <select name="bucket" onchange="this.form.submit()">
      <option value="">Any bucket size</option>
      <option value="hour"${selectedBucket === "hour" ? " selected" : ""}>hour</option>
      <option value="day"${selectedBucket === "day" ? " selected" : ""}>day</option>
    </select>
  </form>`;
  return page(
    "Metrics",
    `<p><a href="${basePath}">&larr; issues</a></p><h1>Metrics</h1>${bucketFilter}<table><thead><tr><th>Name</th><th>Kind</th><th>Bucket</th><th>Sum</th><th>Count</th><th>Min</th><th>Max</th><th>Avg</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

/**
 * Renders a single row of the metric rollups table.
 */
function renderMetricRollupRow(rollup: MetricRollup): string {
  return `<tr>
    <td>${escapeHtml(rollup.name)}</td>
    <td>${escapeHtml(rollup.kind)}</td>
    <td>${escapeHtml(rollup.bucketStart)} (${escapeHtml(rollup.bucketSize)})</td>
    <td>${String(rollup.sum)}</td>
    <td>${String(rollup.count)}</td>
    <td>${String(rollup.min)}</td>
    <td>${String(rollup.max)}</td>
    <td>${rollup.avg.toFixed(2)}</td>
  </tr>`;
}
