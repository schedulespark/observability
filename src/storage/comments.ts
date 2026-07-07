import { randomUUID } from "node:crypto";

import { mapCommentRow } from "./rows.js";

import type { StorageHandle } from "./pool.js";
import type { CommentRow } from "./rows.js";
import type { Comment } from "../core/index.js";

/**
 * Adds a free-text comment to an issue.
 */
export async function addComment(
  handle: StorageHandle,
  issueId: string,
  input: { author: string; body: string }
): Promise<Comment> {
  await handle.ready;
  const { rows } = await handle.pool.query<CommentRow>(
    `INSERT INTO ${handle.quotedSchema}.comments (id, issue_id, author, body, created_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING *`,
    [randomUUID(), issueId, input.author, input.body]
  );
  return mapCommentRow(rows[0]);
}

/**
 * Lists an issue's comments, oldest first.
 */
export async function listComments(handle: StorageHandle, issueId: string): Promise<Comment[]> {
  await handle.ready;
  const { rows } = await handle.pool.query<CommentRow>(
    `SELECT * FROM ${handle.quotedSchema}.comments WHERE issue_id = $1 ORDER BY created_at ASC`,
    [issueId]
  );
  return rows.map(mapCommentRow);
}
