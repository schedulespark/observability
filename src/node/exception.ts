import { redactSecrets } from "./redact.js";

import type { CaptureInput, EventContext, EventLevel } from "../core/index.js";

const DEFAULT_ERROR_MESSAGE = "Unknown error";

/**
 * Normalizes any thrown value into an `Error` instance so callers can always read a
 * `message`/`stack`, even for thrown strings or non-Error objects.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Builds a capture payload from a thrown value and optional context, redacting
 * likely-secret fields from the context before it's queued.
 */
export function exceptionToInput(error: unknown, context?: EventContext): CaptureInput {
  const normalized = toError(error);
  return {
    level: "error",
    message: normalized.message || DEFAULT_ERROR_MESSAGE,
    errorType: normalized.name,
    stackTrace: normalized.stack,
    context: context ? redactSecrets(context) : undefined
  };
}

/**
 * Builds a capture payload for a plain message (no exception involved).
 */
export function messageToInput(
  message: string,
  level: EventLevel,
  context?: EventContext
): CaptureInput {
  return {
    level,
    message,
    context: context ? redactSecrets(context) : undefined
  };
}
