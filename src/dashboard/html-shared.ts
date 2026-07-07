const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

/**
 * Escapes HTML-significant characters. Every captured field (message, stack trace,
 * title) is untrusted, attacker-reachable input, so it must always pass through this
 * before being interpolated into a rendered page.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

const PAGE_STYLE = `
  body { font: 14px/1.5 -apple-system, sans-serif; margin: 2rem; color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e5e5e5; }
  a { color: #4f46e5; text-decoration: none; }
  pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; white-space: pre-wrap; }
  .badge { padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 12px; }
  .badge-error { background: #fee2e2; color: #991b1b; }
  .badge-warning { background: #fef3c7; color: #92400e; }
  .badge-info { background: #e0e7ff; color: #3730a3; }
  .comment { border-top: 1px solid #e5e5e5; padding: 0.75rem 0; }
`;

/**
 * Wraps page content in a minimal shared HTML shell.
 */
export function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`;
}

/**
 * Renders a small colored badge for an event/issue level.
 */
export function levelBadge(level: string): string {
  return `<span class="badge badge-${escapeHtml(level)}">${escapeHtml(level)}</span>`;
}
