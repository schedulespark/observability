import { createHash } from "node:crypto";

const STACK_FRAMES_FOR_FINGERPRINT = 5;

/**
 * Strips file paths, line numbers, and column numbers from a stack trace line so that
 * fingerprints stay stable across deploys where absolute paths or line numbers shift.
 */
function normalizeStackLine(line: string): string {
  return line
    .trim()
    .replace(/\(.*\)$/, "")
    .replace(/:\d+:\d+$/, "")
    .replace(/\s+/g, " ");
}

/**
 * Extracts the top N normalized frames from a raw stack trace string, skipping the
 * first line (the error message itself, not a stack frame).
 */
function topFrames(stackTrace: string): string[] {
  return stackTrace
    .split("\n")
    .slice(1, STACK_FRAMES_FOR_FINGERPRINT + 1)
    .map(normalizeStackLine)
    .filter((line) => line.length > 0);
}

/**
 * Computes a stable fingerprint used to group events into the same issue. Prefers the
 * error type plus the top stack frames when available, falling back to the raw message
 * for events without a stack trace (e.g. `captureMessage`).
 */
export function computeFingerprint(input: {
  errorType?: string;
  message: string;
  stackTrace?: string;
}): string {
  const parts = input.stackTrace
    ? [input.errorType ?? "Error", ...topFrames(input.stackTrace)]
    : [input.errorType ?? "Message", input.message];

  return createHash("sha1").update(parts.join("|")).digest("hex");
}
