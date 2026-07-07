import { parseArgs } from "node:util";

import { closeStorage, initStorage, rollupMetrics } from "../storage/index.js";

import { parseCommonOptions, valueAsString } from "./options.js";

const DEFAULT_RAW_RETENTION_DAYS = 3;

/**
 * Runs the `rollup` CLI subcommand: aggregates raw metric points into hourly/daily
 * buckets, then prunes raw points older than the retention window. Intended to be
 * invoked on a schedule (e.g. a cron job), the same way `prune` is.
 */
export async function runRollup(argv: string[]): Promise<void> {
  const common = parseCommonOptions(argv);
  const { values } = parseArgs({
    args: argv,
    options: { "raw-older-than-days": { type: "string" } },
    allowPositionals: true,
    strict: false
  });
  const rawRetentionDays = Number(valueAsString(values["raw-older-than-days"]) ?? DEFAULT_RAW_RETENTION_DAYS);

  const handle = await initStorage(common);
  const result = await rollupMetrics(handle, { rawRetentionDays });
  console.error(`[observability] rolled up ${String(result.rolledUpBuckets)} metric buckets`);
  console.error(`[observability] pruned ${String(result.prunedRawPoints)} raw metric points older than ${String(rawRetentionDays)} days`);
  await closeStorage(handle);
}
