import { randomUUID } from "node:crypto";

import { mapSavedViewRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { SavedViewRow } from "./rows.js";
import type { SavedView, SavedViewFilters } from "../core/index.js";

/**
 * Persists a named filter combination so it can be revisited later from the issues
 * list.
 */
export async function createSavedView(
  handle: StorageHandle,
  name: string,
  filters: SavedViewFilters
): Promise<SavedView> {
  await handle.ready;
  const { rows } = await handle.pool.query<SavedViewRow>(
    `INSERT INTO ${handle.quotedSchema}.saved_views (id, name, filters, created_at)
     VALUES ($1, $2, $3, now())
     RETURNING *`,
    [randomUUID(), name, filters]
  );
  return mapSavedViewRow(rows[0]);
}

/**
 * Lists every saved view, oldest first.
 */
export async function listSavedViews(handle: StorageHandle): Promise<SavedView[]> {
  await handle.ready;
  const { rows } = await handle.pool.query<SavedViewRow>(
    `SELECT * FROM ${handle.quotedSchema}.saved_views ORDER BY created_at ASC`
  );
  return rows.map(mapSavedViewRow);
}

/**
 * Deletes a saved view by id. A no-op if it doesn't exist.
 */
export async function deleteSavedView(handle: StorageHandle, id: string): Promise<void> {
  await handle.ready;
  await handle.pool.query(`DELETE FROM ${handle.quotedSchema}.saved_views WHERE id = $1`, [id]);
}
