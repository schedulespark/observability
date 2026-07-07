const SECRET_KEY_PATTERN = /authorization|cookie|password|secret|token|api[-_]?key/i;

/**
 * Recursively redacts values whose key looks like a secret (authorization headers,
 * cookies, passwords, tokens, API keys). Applied by default to any context object
 * before it's persisted, since events are written straight into the host's own
 * database.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactSecrets(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    return redactObject(value as Record<string, unknown>) as T;
  }
  return value;
}

/**
 * Redacts secret-looking keys on a plain object, recursing into nested values.
 */
function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(val);
  }
  return result;
}
