import { parseArgs } from "node:util";

import { closeStorage, initStorage, pruneEvents, pruneLogs } from "../storage/index.js";

import { parseCommonOptions, valueAsString } from "./options.js";

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_LOG_RETENTION_DAYS = 14;

/**
 * `prune` subcommand: deletes events older than the retention window (default 90
 * days), keeping their issues intact, and separately prunes log lines (default 14
 * days — logs are typically much higher-volume than events). A stopgap against
 * unbounded table growth — intended to be run on a schedule (cron, Render cron job,
 * etc.) since nothing prunes automatically.
 */
export async function runPrune(argv: string[]): Promise<void> {
  const common = parseCommonOptions(argv);
  const { values } = parseArgs({
    args: argv,
    options: {
      "older-than-days": { type: "string" },
      "logs-older-than-days": { type: "string" }
    },
    allowPositionals: true,
    strict: false
  });
  const olderThanDays = Number(valueAsString(values["older-than-days"]) ?? DEFAULT_RETENTION_DAYS);
  const logsOlderThanDays = Number(
    valueAsString(values["logs-older-than-days"]) ?? DEFAULT_LOG_RETENTION_DAYS
  );

  const handle = await initStorage(common);
  const eventsResult = await pruneEvents(handle, olderThanDays);
  console.error(`[observability] deleted ${String(eventsResult.deletedEvents)} events older than ${String(olderThanDays)} days`);
  const logsResult = await pruneLogs(handle, logsOlderThanDays);
  console.error(`[observability] deleted ${String(logsResult.deletedLogs)} logs older than ${String(logsOlderThanDays)} days`);
  await closeStorage(handle);
}
