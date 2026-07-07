import { renderLogsPage, renderMetricsPage, renderTransactionsPage } from "./html-secondary.js";
import { renderIssuePage, renderIssuesPage } from "./html.js";

import type { Dashboard } from "./core.js";
import type { IssueStatus, LogLevel, MetricBucketSize } from "../core/index.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const ISSUE_STATUSES: IssueStatus[] = ["unresolved", "resolved", "ignored"];
const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const METRIC_BUCKET_SIZES: MetricBucketSize[] = ["hour", "day"];
const BEARER_PREFIX = "Bearer ";

/**
 * Options for mounting the dashboard into a Fastify instance.
 */
export interface FastifyDashboardOptions {
  prefix?: string;
  authorize?: (request: FastifyRequest) => boolean | Promise<boolean>;
  ingestKey?: string;
}

interface RouteContext {
  dashboard: Dashboard;
  options: FastifyDashboardOptions;
  basePath: string;
}

/**
 * Registers the ingestion endpoint and the HTML dashboard (issue list, issue detail,
 * status/assignee updates, comments) on a Fastify instance. Can be mounted at any
 * prefix inside a host app's own server, or on a bare Fastify instance for standalone
 * mode.
 */
export function registerDashboard(
  app: FastifyInstance,
  dashboard: Dashboard,
  options: FastifyDashboardOptions = {}
): void {
  const ctx: RouteContext = { dashboard, options, basePath: options.prefix ?? "" };

  app.post(`${ctx.basePath}/ingest`, async (request, reply) => {
    if (!guardIngest(ctx, request, reply)) {
      return;
    }
    const projectId = await dashboard.resolveProjectId(extractBearerToken(request));
    const result = await dashboard.ingest(request.body, projectId);
    await reply.status(result.ok ? 202 : 400).send(result);
  });

  app.get(ctx.basePath === "" ? "/" : ctx.basePath, (request, reply) => handleIssuesPage(ctx, request, reply));
  app.get(`${ctx.basePath}/transactions`, (request, reply) => handleTransactionsPage(ctx, request, reply));
  app.get(`${ctx.basePath}/logs`, (request, reply) => handleLogsPage(ctx, request, reply));
  app.get(`${ctx.basePath}/metrics`, (request, reply) => handleMetricsPage(ctx, request, reply));
  app.get(`${ctx.basePath}/issues/:id`, (request, reply) => handleIssuePage(ctx, request, reply));
  app.post(`${ctx.basePath}/issues/:id/status`, (request, reply) => handleStatusUpdate(ctx, request, reply));
  app.post(`${ctx.basePath}/issues/:id/assign`, (request, reply) => handleAssign(ctx, request, reply));
  app.post(`${ctx.basePath}/issues/:id/comments`, (request, reply) => handleAddComment(ctx, request, reply));
  app.post(`${ctx.basePath}/views`, (request, reply) => handleCreateSavedView(ctx, request, reply));
  app.post(`${ctx.basePath}/views/:id/delete`, (request, reply) => handleDeleteSavedView(ctx, request, reply));
  app.get(`${ctx.basePath}/api/issues`, async (request, reply) => {
    if (!(await guard(ctx, request, reply))) return;
    const { project } = request.query as { project?: string };
    await reply.send(await dashboard.listIssues({ projectId: project }));
  });
}

/**
 * Handles `GET /` (or the configured prefix): renders the searchable issues list.
 */
async function handleIssuesPage(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { q, project, status } = request.query as { q?: string; project?: string; status?: string };
  const statusFilter = isIssueStatus(status) ? status : undefined;
  const [issues, projects, savedViews] = await Promise.all([
    ctx.dashboard.listIssues({ q, projectId: project, status: statusFilter }),
    ctx.dashboard.listProjects(),
    ctx.dashboard.listSavedViews()
  ]);
  await reply.type("text/html").send(
    renderIssuesPage(issues, ctx.basePath, {
      q,
      projects,
      selectedProjectId: project,
      savedViews,
      currentFilters: { q, projectId: project, status: statusFilter }
    })
  );
}

/**
 * Handles `GET /transactions`: renders the recorded root-span (transaction) list.
 */
async function handleTransactionsPage(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const transactions = await ctx.dashboard.listTransactions();
  await reply.type("text/html").send(renderTransactionsPage(transactions, ctx.basePath));
}

/**
 * Handles `GET /logs`: renders the structured log list, optionally filtered by
 * `?level=`.
 */
async function handleLogsPage(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { level } = request.query as { level?: string };
  const levelFilter = isLogLevel(level) ? level : undefined;
  const logs = await ctx.dashboard.listLogs({ level: levelFilter });
  await reply.type("text/html").send(renderLogsPage(logs, ctx.basePath, levelFilter));
}

/**
 * Type guard for a valid `LogLevel` string.
 */
function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && LOG_LEVELS.includes(value as LogLevel);
}

/**
 * Handles `GET /metrics`: renders the metric rollups table, optionally filtered by
 * `?bucket=`.
 */
async function handleMetricsPage(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { bucket } = request.query as { bucket?: string };
  const bucketFilter = isMetricBucketSize(bucket) ? bucket : undefined;
  const rollups = await ctx.dashboard.listMetricRollups({ bucketSize: bucketFilter });
  await reply.type("text/html").send(renderMetricsPage(rollups, ctx.basePath, bucketFilter));
}

/**
 * Type guard for a valid `MetricBucketSize` string.
 */
function isMetricBucketSize(value: unknown): value is MetricBucketSize {
  return typeof value === "string" && METRIC_BUCKET_SIZES.includes(value as MetricBucketSize);
}

/**
 * Handles `GET /issues/:id`: renders a single issue's detail page.
 */
async function handleIssuePage(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { id } = request.params as { id: string };
  const detail = await ctx.dashboard.getIssue(id);
  if (!detail) {
    await reply.status(404).send();
    return;
  }
  await reply
    .type("text/html")
    .send(renderIssuePage(detail.issue, detail.events, detail.comments, ctx.basePath));
}

/**
 * Handles `POST /issues/:id/status`: updates an issue's workflow status.
 */
async function handleStatusUpdate(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { id } = request.params as { id: string };
  const { status } = request.body as { status?: string };
  if (!isIssueStatus(status)) {
    await reply.status(400).send();
    return;
  }
  await ctx.dashboard.updateIssueStatus(id, status);
  await reply.redirect(`${ctx.basePath}/issues/${id}`);
}

/**
 * Handles `POST /issues/:id/assign`: sets (or clears, on an empty value) an issue's
 * assignee.
 */
async function handleAssign(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { id } = request.params as { id: string };
  const { assignee } = request.body as { assignee?: string };
  await ctx.dashboard.assignIssue(id, toAssigneeOrNull(assignee));
  await reply.redirect(`${ctx.basePath}/issues/${id}`);
}

/**
 * Treats an empty assignee field as "unassign" rather than storing an empty string.
 */
function toAssigneeOrNull(assignee: string | undefined): string | null {
  return assignee && assignee.length > 0 ? assignee : null;
}

/**
 * Handles `POST /issues/:id/comments`: adds a comment to an issue.
 */
async function handleAddComment(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { id } = request.params as { id: string };
  const { author, body } = request.body as { author?: string; body?: string };
  if (!author || !body) {
    await reply.status(400).send();
    return;
  }
  await ctx.dashboard.addComment(id, { author, body });
  await reply.redirect(`${ctx.basePath}/issues/${id}`);
}

/**
 * Handles `POST /views`: saves the current issues-list filters under a name.
 */
async function handleCreateSavedView(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { name, q, project, status } = request.body as { name?: string; q?: string; project?: string; status?: string };
  if (!name) {
    await reply.status(400).send();
    return;
  }
  await ctx.dashboard.createSavedView(name, {
    q: toNonEmptyOrUndefined(q),
    projectId: toNonEmptyOrUndefined(project),
    status: isIssueStatus(status) ? status : undefined
  });
  await reply.redirect(ctx.basePath === "" ? "/" : ctx.basePath);
}

/**
 * Treats an empty string the same as "not provided" — used when persisting a saved
 * view's filters, so an unused filter field is omitted rather than stored as `""`.
 */
function toNonEmptyOrUndefined(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

/**
 * Handles `POST /views/:id/delete`: removes a saved view.
 */
async function handleDeleteSavedView(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await guard(ctx, request, reply))) return;
  const { id } = request.params as { id: string };
  await ctx.dashboard.deleteSavedView(id);
  await reply.redirect(ctx.basePath === "" ? "/" : ctx.basePath);
}

/**
 * Runs the caller-supplied `authorize` hook, sending a 401 and returning `false` when
 * it denies the request. Requests are allowed through when no hook is configured.
 */
async function guard(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const allowed = ctx.options.authorize ? await ctx.options.authorize(request) : true;
  if (!allowed) {
    await reply.status(401).send();
  }
  return allowed;
}

/**
 * Checks the ingestion request's `Authorization: Bearer <ingestKey>` header against
 * the configured key — the same scheme the browser SDK's `apiKey` option and the
 * standalone CLI's `--token` already use — sending a 401 and returning `false` on a
 * mismatch. With no `ingestKey` configured, every request is allowed, matching the
 * package's zero-config default; deployers opt into locking it down.
 */
function guardIngest(ctx: RouteContext, request: FastifyRequest, reply: FastifyReply): boolean {
  if (!ctx.options.ingestKey) {
    return true;
  }
  if (extractBearerToken(request) !== ctx.options.ingestKey) {
    reply.status(401).send({ ok: false, error: "missing or invalid ingestion key" });
    return false;
  }
  return true;
}

/**
 * Extracts the `Authorization: Bearer <token>` header value, if present. Used both
 * for the global `ingestKey` check above and, separately, to resolve which project an
 * ingested event belongs to by its own per-project API key.
 */
function extractBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;
}

/**
 * Type guard for a valid `IssueStatus` string.
 */
function isIssueStatus(value: unknown): value is IssueStatus {
  return typeof value === "string" && ISSUE_STATUSES.includes(value as IssueStatus);
}
