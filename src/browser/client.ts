import { captureInputSchema, createBreadcrumbBuffer } from "../core/index.js";

import type { BreadcrumbInput, CaptureInput, EventContext, EventLevel } from "../core/index.js";

const DEFAULT_CAPTURE_GLOBAL_ERRORS = true;
const DEFAULT_AUTO_BREADCRUMBS = true;

/**
 * Options for initializing the browser observability client.
 */
export interface BrowserClientOptions {
  ingestUrl: string;
  apiKey?: string;
  environment?: string;
  release?: string;
  captureGlobalErrors?: boolean;
  autoBreadcrumbs?: boolean;
}

/**
 * The browser SDK's public capture API.
 */
export interface BrowserClient {
  captureException: (error: unknown, context?: EventContext) => void;
  captureMessage: (message: string, level?: EventLevel, context?: EventContext) => void;
  addBreadcrumb: (breadcrumb: BreadcrumbInput) => void;
}

/**
 * Initializes the browser client. By default also installs `window.onerror` and
 * `unhandledrejection` listeners so uncaught client-side errors are reported without
 * any extra wiring, and wraps `window.fetch` to auto-record a breadcrumb per request.
 */
export function init(options: BrowserClientOptions): BrowserClient {
  const breadcrumbs = createBreadcrumbBuffer();

  const client: BrowserClient = {
    captureException(error, context) {
      send(options, { ...buildExceptionInput(error, mergeContext(context, options)), breadcrumbs: breadcrumbs.snapshot() });
    },
    captureMessage(message, level = "info", context) {
      send(options, { level, message, context: mergeContext(context, options), breadcrumbs: breadcrumbs.snapshot() });
    },
    addBreadcrumb(breadcrumb) {
      breadcrumbs.add({ ...breadcrumb, data: breadcrumb.data ? redactBreadcrumbData(breadcrumb.data) : undefined });
    }
  };

  if (options.captureGlobalErrors ?? DEFAULT_CAPTURE_GLOBAL_ERRORS) {
    registerGlobalHandlers(client);
  }
  if (options.autoBreadcrumbs ?? DEFAULT_AUTO_BREADCRUMBS) {
    registerFetchBreadcrumbs(breadcrumbs, options.ingestUrl);
  }

  return client;
}

const BREADCRUMB_SECRET_KEY_PATTERN = /authorization|cookie|password|secret|token|api[-_]?key/i;

/**
 * Redacts secret-looking keys from breadcrumb `data` before it's buffered — the same
 * risk `context.extra` has, and the same key-pattern the Node SDK's `redact.ts` uses.
 * Duplicated here (rather than shared) since this is the only place the browser SDK
 * needs it.
 */
function redactBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = BREADCRUMB_SECRET_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }
  return result;
}

/**
 * Wraps `window.fetch` once so every request auto-records a `"fetch"` breadcrumb —
 * the single highest-value default breadcrumb source, mirroring Sentry's own. Skips
 * the SDK's own ingestion POSTs, which would otherwise bury every capture's real
 * breadcrumb trail under "POST <ingestUrl> → 202" from reporting itself.
 */
function registerFetchBreadcrumbs(breadcrumbs: ReturnType<typeof createBreadcrumbBuffer>, ingestUrl: string): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = describeFetchUrl(args[0]);
    if (url === ingestUrl) {
      return originalFetch(...args);
    }
    const method = (args[1]?.method ?? "GET").toUpperCase();
    try {
      const response = await originalFetch(...args);
      breadcrumbs.add({ category: "fetch", message: `${method} ${url}`, data: { status: response.status } });
      return response;
    } catch (error) {
      breadcrumbs.add({ category: "fetch", message: `${method} ${url}`, level: "error", data: { failed: true } });
      throw error;
    }
  };
}

/**
 * Renders a `fetch` call's first argument (URL string, `URL`, or `Request`) as a
 * plain string for the breadcrumb message.
 */
function describeFetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

/**
 * Fills in `environment`/`release` on a context object from client defaults.
 */
function mergeContext(
  context: EventContext | undefined,
  options: BrowserClientOptions
): EventContext {
  return {
    ...context,
    environment: context?.environment ?? options.environment,
    release: context?.release ?? options.release
  };
}

/**
 * Builds a capture payload from a thrown value.
 */
function buildExceptionInput(error: unknown, context: EventContext): CaptureInput {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    level: "error",
    message: normalized.message || "Unknown error",
    errorType: normalized.name,
    stackTrace: normalized.stack,
    context
  };
}

/**
 * Validates and fire-and-forget POSTs a capture payload to the ingestion endpoint.
 */
function send(options: BrowserClientOptions, input: CaptureInput): void {
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success) {
    return;
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  fetch(options.ingestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(parsed.data),
    keepalive: true
  }).catch(() => undefined);
}

/**
 * Installs `window.onerror`/`unhandledrejection` listeners that report to the client.
 */
function registerGlobalHandlers(client: BrowserClient): void {
  window.addEventListener("error", (event) => {
    client.captureException(event.error ?? new Error(event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    client.captureException(event.reason);
  });
}
