import { escapeHtml, levelBadge, page } from "./html-shared.js";

import type { CapturedEvent, Comment, Issue, Project, SavedView, SavedViewFilters } from "../core/index.js";

export { escapeHtml } from "./html-shared.js";

const ISSUE_STATUS_OPTIONS = ["unresolved", "resolved", "ignored"];

/**
 * Renders the issues list page, with a search box (and, once more than one project
 * exists, a project filter) that preserves the current query on submit.
 */
export function renderIssuesPage(
  issues: Issue[],
  basePath: string,
  filters: {
    q?: string;
    projects?: Project[];
    selectedProjectId?: string;
    savedViews?: SavedView[];
    currentFilters?: SavedViewFilters;
  } = {}
): string {
  const { q, projects = [], selectedProjectId, savedViews = [], currentFilters } = filters;
  const rows = issues.map((issue) => renderIssueRow(issue, basePath)).join("");
  const projectFilter = projects.length > 1 ? renderProjectFilter(projects, selectedProjectId) : "";
  const searchBox = `<form method="get" action="${basePath}">
    <input type="search" name="q" placeholder="Search titles…" value="${escapeHtml(q ?? "")}">
    ${renderStatusFilter(currentFilters?.status)}
    ${projectFilter}
    <button type="submit">Search</button>
  </form>`;
  const savedViewsBlock = renderSavedViewsBlock(savedViews, basePath, currentFilters);

  return page(
    "Issues",
    `<h1>Issues</h1><p><a href="${basePath}/transactions">Transactions &rarr;</a> · <a href="${basePath}/logs">Logs &rarr;</a> · <a href="${basePath}/metrics">Metrics &rarr;</a></p>${savedViewsBlock}${searchBox}<table><thead><tr><th>Level</th><th>Title</th><th>Status</th><th>Assignee</th><th>Events</th><th>Last seen</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

/**
 * Renders the `?status=` dropdown on the issues list search form.
 */
function renderStatusFilter(selectedStatus?: string): string {
  const options = ISSUE_STATUS_OPTIONS.map(
    (status) => `<option value="${status}"${status === selectedStatus ? " selected" : ""}>${status}</option>`
  ).join("");
  return `<select name="status"><option value="">Any status</option>${options}</select>`;
}

/**
 * Renders the saved-views list (each entry a link that applies its filters, plus a
 * delete button) and the "save this search" form, which carries the currently active
 * filters as hidden fields.
 */
function renderSavedViewsBlock(savedViews: SavedView[], basePath: string, currentFilters?: SavedViewFilters): string {
  const list =
    savedViews.length > 0
      ? `<ul>${savedViews.map((view) => renderSavedViewItem(view, basePath)).join("")}</ul>`
      : "";
  return `<div><strong>Saved views</strong>${list}${renderSaveViewForm(basePath, currentFilters)}</div>`;
}

/**
 * Renders a single saved view: a link applying its filters, and a delete button.
 */
function renderSavedViewItem(view: SavedView, basePath: string): string {
  const params = new URLSearchParams();
  if (view.filters.q) {
    params.set("q", view.filters.q);
  }
  if (view.filters.projectId) {
    params.set("project", view.filters.projectId);
  }
  if (view.filters.status) {
    params.set("status", view.filters.status);
  }
  const query = params.toString();
  return `<li><a href="${basePath}${query ? `?${query}` : ""}">${escapeHtml(view.name)}</a>
    <form method="post" action="${basePath}/views/${escapeHtml(view.id)}/delete" style="display:inline">
      <button type="submit">delete</button>
    </form>
  </li>`;
}

/**
 * Renders the "save this search" form, carrying the current `q`/`project`/`status`
 * filters as hidden fields so saving doesn't require re-entering them.
 */
function renderSaveViewForm(basePath: string, currentFilters?: SavedViewFilters): string {
  return `<form method="post" action="${basePath}/views">
    <input type="text" name="name" placeholder="Save this search as…" required>
    <input type="hidden" name="q" value="${escapeHtml(currentFilters?.q ?? "")}">
    <input type="hidden" name="project" value="${escapeHtml(currentFilters?.projectId ?? "")}">
    <input type="hidden" name="status" value="${escapeHtml(currentFilters?.status ?? "")}">
    <button type="submit">Save view</button>
  </form>`;
}

/**
 * Renders the `?project=` dropdown, populated from every configured project.
 */
function renderProjectFilter(projects: Project[], selectedProjectId?: string): string {
  const options = projects
    .map(
      (project) =>
        `<option value="${escapeHtml(project.id)}"${
          project.id === selectedProjectId ? " selected" : ""
        }>${escapeHtml(project.name)}</option>`
    )
    .join("");
  return `<select name="project"><option value="">All projects</option>${options}</select>`;
}

/**
 * Renders a single row of the issues list table.
 */
function renderIssueRow(issue: Issue, basePath: string): string {
  return `<tr>
    <td>${levelBadge(issue.level)}</td>
    <td><a href="${basePath}/issues/${escapeHtml(issue.id)}">${escapeHtml(issue.title)}</a></td>
    <td>${escapeHtml(issue.status)}</td>
    <td>${escapeHtml(issue.assignee ?? "—")}</td>
    <td>${String(issue.eventCount)}</td>
    <td>${escapeHtml(issue.lastSeen)}</td>
  </tr>`;
}

/**
 * Renders a single issue's detail page: status/assignee controls, recent events, and
 * its comment thread.
 */
export function renderIssuePage(
  issue: Issue,
  events: CapturedEvent[],
  comments: Comment[],
  basePath: string
): string {
  const eventsHtml = events.map((event) => renderEvent(event)).join("");
  const body = `<p><a href="${basePath}">&larr; back</a></p>
    <h1>${levelBadge(issue.level)} ${escapeHtml(issue.title)}</h1>
    <p>${renderStatusForm(issue, basePath)}</p>
    <p>${renderAssignForm(issue, basePath)}</p>
    <h2>Events (${String(events.length)})</h2>${eventsHtml}
    <h2>Comments (${String(comments.length)})</h2>${renderComments(comments)}${renderCommentForm(issue, basePath)}`;

  return page(issue.title, body);
}

/**
 * Renders the resolve/ignore/unresolve status buttons.
 */
function renderStatusForm(issue: Issue, basePath: string): string {
  return ["unresolved", "resolved", "ignored"]
    .map(
      (status) => `<form method="post" action="${basePath}/issues/${escapeHtml(issue.id)}/status" style="display:inline">
        <input type="hidden" name="status" value="${status}">
        <button type="submit"${status === issue.status ? " disabled" : ""}>${status}</button>
      </form>`
    )
    .join(" ");
}

/**
 * Renders the assignee text field and submit button.
 */
function renderAssignForm(issue: Issue, basePath: string): string {
  return `<form method="post" action="${basePath}/issues/${escapeHtml(issue.id)}/assign" style="display:inline">
    <input type="text" name="assignee" placeholder="Assignee" value="${escapeHtml(issue.assignee ?? "")}">
    <button type="submit">Assign</button>
  </form>`;
}

/**
 * Renders the comment thread, or a placeholder when there are no comments yet.
 */
function renderComments(comments: Comment[]): string {
  if (comments.length === 0) {
    return "<p>No comments yet.</p>";
  }
  return comments
    .map(
      (comment) => `<div class="comment"><strong>${escapeHtml(comment.author)}</strong>
        <span>${escapeHtml(comment.createdAt)}</span><p>${escapeHtml(comment.body)}</p></div>`
    )
    .join("");
}

/**
 * Renders the "add a comment" form.
 */
function renderCommentForm(issue: Issue, basePath: string): string {
  return `<form method="post" action="${basePath}/issues/${escapeHtml(issue.id)}/comments">
    <input type="text" name="author" placeholder="Your name" required>
    <br><textarea name="body" placeholder="Add a comment…" required></textarea>
    <br><button type="submit">Comment</button>
  </form>`;
}

/**
 * Renders a single event within an issue's detail page.
 */
function renderEvent(event: CapturedEvent): string {
  const stack = event.stackTrace ? `<pre>${escapeHtml(event.stackTrace)}</pre>` : "";
  const context = `<pre>${escapeHtml(JSON.stringify(event.context, null, 2))}</pre>`;
  const breadcrumbs =
    event.breadcrumbs.length > 0
      ? `<pre>${escapeHtml(JSON.stringify(event.breadcrumbs, null, 2))}</pre>`
      : "";
  return `<div><p><strong>${escapeHtml(event.capturedAt)}</strong> ${escapeHtml(
    event.message
  )}</p>${stack}${context}${breadcrumbs}</div>`;
}
