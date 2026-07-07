import type { Breadcrumb } from "./types.js";

const DEFAULT_MAX_BREADCRUMBS = 25;

/**
 * The fields a caller supplies to `addBreadcrumb()` — `timestamp` is stamped
 * automatically by the buffer, never provided by the caller.
 */
export type BreadcrumbInput = Omit<Breadcrumb, "timestamp">;

/**
 * A bounded, drop-oldest ring buffer of recent breadcrumbs, snapshotted onto the next
 * captured error/message rather than cleared afterward (a burst of related errors
 * benefits from overlapping context, matching Sentry's own default).
 */
export interface BreadcrumbBuffer {
  add: (breadcrumb: BreadcrumbInput) => void;
  snapshot: () => Breadcrumb[];
}

/**
 * Creates a breadcrumb ring buffer. Pure array operations only, no Node- or
 * browser-only APIs, so unlike `fingerprint.ts` this is safe to use from — and export
 * directly out of — the shared `core` barrel.
 */
export function createBreadcrumbBuffer(maxSize: number = DEFAULT_MAX_BREADCRUMBS): BreadcrumbBuffer {
  const buffer: Breadcrumb[] = [];
  return {
    add(breadcrumb) {
      buffer.push({ ...breadcrumb, timestamp: new Date().toISOString() });
      if (buffer.length > maxSize) {
        buffer.shift();
      }
    },
    snapshot() {
      return [...buffer];
    }
  };
}
