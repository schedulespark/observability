import type { StorageHandle } from "./pool.js";
import type { EventLevel } from "../core/index.js";

/**
 * Counts events at a given level captured within the last `windowMinutes`. Used by
 * the spike alert monitor; not exposed in the dashboard yet.
 */
export async function countEventsSince(
  handle: StorageHandle,
  level: EventLevel,
  windowMinutes: number
): Promise<number> {
  await handle.ready;
  const { rows } = await handle.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${handle.quotedSchema}.events
     WHERE level = $1 AND captured_at > now() - ($2 || ' minutes')::interval`,
    [level, windowMinutes]
  );
  return Number(rows[0]?.count ?? "0");
}
