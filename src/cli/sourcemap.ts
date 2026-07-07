import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

import { closeStorage, getIssueWithEvents, initStorage } from "../storage/index.js";

import { valueAsString } from "./options.js";

// The trailing `)`/whitespace is a lookahead, not part of the match itself, so
// replacing `match[0]` below doesn't eat the frame's closing paren.
const FRAME_LOCATION_PATTERN = /([^\s()]+\.js):(\d+):(\d+)(?=\)?\s*$)/;

/**
 * `sourcemap` subcommand: resolves a minified browser stack trace's frames back to
 * original source locations, using `.map` files already produced by a build with
 * `sourcemap: true` (e.g. `apps/web`'s Vite config). CLI-only for this pass — there's
 * no dashboard-side automatic resolution, since that would need a release-to-map
 * mapping this package doesn't have yet.
 */
export async function runSourcemap(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      maps: { type: "string" },
      "stack-file": { type: "string" },
      issue: { type: "string" },
      db: { type: "string" },
      schema: { type: "string" }
    },
    allowPositionals: true,
    strict: false
  });

  const mapsDir = valueAsString(values.maps);
  if (!mapsDir) {
    throw new Error("A source maps directory is required: pass --maps <dir>.");
  }

  const stackTrace = await readStackTrace(values);
  console.error(resolveStackTrace(stackTrace, mapsDir));
}

/**
 * Reads the stack trace to resolve, either from a local file (`--stack-file`) or by
 * fetching an issue's most recent event from storage (`--issue` plus `--db`).
 */
async function readStackTrace(values: Record<string, unknown>): Promise<string> {
  const stackFile = valueAsString(values["stack-file"]);
  if (stackFile) {
    return readFileSync(stackFile, "utf8");
  }

  const issueId = valueAsString(values.issue);
  const connectionString = valueAsString(values.db) ?? process.env.OBSERVABILITY_DATABASE_URL;
  if (!issueId || !connectionString) {
    throw new Error("Provide either --stack-file <path>, or --issue <id> and --db <connectionString>.");
  }

  const handle = await initStorage({ connectionString, schema: valueAsString(values.schema) });
  const detail = await getIssueWithEvents(handle, issueId);
  await closeStorage(handle);

  const stackTrace = detail?.events[0]?.stackTrace;
  if (!stackTrace) {
    throw new Error(`No stack trace found for issue "${issueId}".`);
  }
  return stackTrace;
}

/**
 * Resolves every frame in a stack trace, leaving lines with no recognizable
 * `file.js:line:col` frame (or no matching `.map` file) unchanged.
 */
function resolveStackTrace(stackTrace: string, mapsDir: string): string {
  const cache = new Map<string, TraceMap | undefined>();
  return stackTrace
    .split("\n")
    .map((line) => resolveStackLine(line, mapsDir, cache))
    .join("\n");
}

/**
 * Resolves a single stack trace line's `file.js:line:col` frame, if present, to its
 * original source location.
 */
function resolveStackLine(line: string, mapsDir: string, cache: Map<string, TraceMap | undefined>): string {
  const match = FRAME_LOCATION_PATTERN.exec(line);
  if (!match) {
    return line;
  }
  const [frame, filePath, lineNumber, columnNumber] = match;
  const traceMap = loadTraceMap(filePath, mapsDir, cache);
  if (!traceMap) {
    return line;
  }
  const original = originalPositionFor(traceMap, {
    line: Number(lineNumber),
    column: Number(columnNumber)
  });
  if (!original.source) {
    return line;
  }
  return line.replace(frame, `${original.source}:${String(original.line)}:${String(original.column)}`);
}

/**
 * Loads (and caches) the `.map` file matching a minified file's basename from the
 * maps directory, or `undefined` if none exists.
 */
function loadTraceMap(filePath: string, mapsDir: string, cache: Map<string, TraceMap | undefined>): TraceMap | undefined {
  const basename = path.basename(filePath);
  if (cache.has(basename)) {
    return cache.get(basename);
  }
  try {
    const raw = readFileSync(path.join(mapsDir, `${basename}.map`), "utf8");
    const traceMap = new TraceMap(JSON.parse(raw) as ConstructorParameters<typeof TraceMap>[0]);
    cache.set(basename, traceMap);
    return traceMap;
  } catch {
    cache.set(basename, undefined);
    return undefined;
  }
}
