import { randomBytes, randomUUID } from "node:crypto";

import { mapProjectRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { ProjectRow } from "./rows.js";
import type { Project } from "../core/index.js";

const API_KEY_BYTES = 24;

/**
 * Creates a new project with a freshly generated API key, used by ingestion clients
 * to identify which project an event belongs to.
 */
export async function createProject(handle: StorageHandle, name: string): Promise<Project> {
  await handle.ready;
  const { rows } = await handle.pool.query<ProjectRow>(
    `INSERT INTO ${handle.quotedSchema}.projects (id, name, api_key, created_at)
     VALUES ($1, $2, $3, now()) RETURNING *`,
    [randomUUID(), name, randomBytes(API_KEY_BYTES).toString("hex")]
  );
  return mapProjectRow(rows[0]);
}

/**
 * Lists all projects, oldest first (so the auto-created `default` project sorts
 * first).
 */
export async function listProjects(handle: StorageHandle): Promise<Project[]> {
  await handle.ready;
  const { rows } = await handle.pool.query<ProjectRow>(
    `SELECT * FROM ${handle.quotedSchema}.projects ORDER BY created_at ASC`
  );
  return rows.map(mapProjectRow);
}

/**
 * Looks up the project an ingestion API key belongs to, or `null` if it doesn't match
 * any configured project.
 */
export async function findProjectByApiKey(handle: StorageHandle, apiKey: string): Promise<Project | null> {
  await handle.ready;
  const { rows } = await handle.pool.query<ProjectRow>(
    `SELECT * FROM ${handle.quotedSchema}.projects WHERE api_key = $1`,
    [apiKey]
  );
  return rows.length > 0 ? mapProjectRow(rows[0]) : null;
}
