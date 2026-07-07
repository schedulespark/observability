import type { Transaction } from "./tracing.js";
import type { BreadcrumbInput } from "../core/index.js";

const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 100;

/**
 * The minimal shape of a Prisma `query` client extension's `$allOperations` callback
 * — duck-typed rather than imported from `@prisma/client`, since that's an optional
 * peer dependency this package shouldn't need at compile time to build.
 */
interface AllOperationsParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/**
 * The minimal shape of a Prisma client this function needs: something extensible via
 * `$extends`.
 */
interface ExtensibleClient {
  $extends: (extension: {
    query: { $allModels: { $allOperations: (params: AllOperationsParams) => Promise<unknown> } };
  }) => unknown;
}

/**
 * Options for `instrumentPrismaClient`.
 */
export interface InstrumentPrismaClientOptions {
  /**
   * Returns the transaction to attach query spans to, or `undefined` if none is
   * active. There's no `AsyncLocalStorage`-based context propagation in this package
   * (a materially bigger, separately-scoped change touching every request boundary),
   * so the caller is responsible for tracking "the active transaction" itself —
   * spans are only recorded for queries issued while a transaction is supplied here.
   */
  getActiveTransaction?: () => Transaction | undefined;
  /**
   * Called with a `"db"` breadcrumb for every query, regardless of whether a
   * transaction is active — the highest-value part of this feature, since it gives
   * every captured exception "last N queries before this error" for free even
   * without tracing wired up.
   */
  addBreadcrumb?: (breadcrumb: BreadcrumbInput) => void;
  /**
   * Query spans are only recorded when the query fails or takes at least this long
   * (default 100ms) — breadcrumbs are recorded for every query regardless, but
   * flooding the transactions view with thousands of fast `SELECT` spans isn't
   * useful. Set to `0` to record every query as a span.
   */
  slowQueryThresholdMs?: number;
}

/**
 * Wraps a Prisma client with a `$extends` query extension that times every query,
 * recording a `"db"` breadcrumb for each one and (when a transaction is supplied via
 * `getActiveTransaction`) a child span for slow or failed queries. Returns a new
 * client — Prisma extensions can't mutate a client in place — so callers must use the
 * returned value, not the original `prisma`. Never a dependency between `packages/db`
 * and this package in either direction: the consuming app calls this itself.
 */
export function instrumentPrismaClient<T extends ExtensibleClient>(
  prisma: T,
  options: InstrumentPrismaClientOptions = {}
): ReturnType<T["$extends"]> {
  const threshold = options.slowQueryThresholdMs ?? DEFAULT_SLOW_QUERY_THRESHOLD_MS;
  return prisma.$extends({
    query: {
      $allModels: {
        $allOperations: (params) => runInstrumentedQuery(params, options, threshold)
      }
    }
  }) as ReturnType<T["$extends"]>;
}

/**
 * Runs a single Prisma query, timing it and reporting a breadcrumb/span as configured.
 */
async function runInstrumentedQuery(
  params: AllOperationsParams,
  options: InstrumentPrismaClientOptions,
  slowQueryThresholdMs: number
): Promise<unknown> {
  const name = `prisma.${params.model ?? "raw"}.${params.operation}`;
  const start = Date.now();
  try {
    const result = await params.query(params.args);
    reportQuery(options, { name, status: "ok", durationMs: Date.now() - start }, slowQueryThresholdMs);
    return result;
  } catch (error) {
    reportQuery(options, { name, status: "error", durationMs: Date.now() - start }, slowQueryThresholdMs);
    throw error;
  }
}

/**
 * A single query's outcome, bundled into one object so `reportQuery` stays under the
 * linter's max-params limit.
 */
interface QueryOutcome {
  name: string;
  status: "ok" | "error";
  durationMs: number;
}

/**
 * Records the breadcrumb (always) and span (when a transaction is active and either
 * the query failed or was at/above the slow-query threshold) for one finished query.
 */
function reportQuery(
  options: InstrumentPrismaClientOptions,
  outcome: QueryOutcome,
  slowQueryThresholdMs: number
): void {
  const { name, status, durationMs } = outcome;
  options.addBreadcrumb?.({
    category: "db",
    message: name,
    level: status === "error" ? "error" : "info",
    data: { durationMs }
  });

  if (status === "ok" && durationMs < slowQueryThresholdMs) {
    return;
  }
  const transaction = options.getActiveTransaction?.();
  transaction?.startSpan(name).finish(status);
}
