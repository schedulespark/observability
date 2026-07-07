# Security review

Dated 2026-07-05. A point-in-time review of `@schedulespark/observability`'s
attack surface, verified against the code in this repo rather than assumed. Anyone
adding a new table, ingestion surface, or auth-adjacent code path should re-check it
against the applicable finding below before merging.

## 1. SQL injection surface

Every `${...}`-interpolated *identifier* in `src/storage/*.ts` traces back to
`handle.quotedSchema`, produced only by `schema-ident.ts`'s `quoteSchemaIdentifier()`,
which validates the schema name against `^[a-z_][a-z0-9_]*$` and throws otherwise.
Table/column/index names elsewhere are hardcoded string literals, never derived from
request input.

Every *value* — including `WHERE`/`ORDER BY` filter values built dynamically (e.g.
`queries.ts`'s `listIssues`, `logs.ts`'s `listLogs`, `metrics-rollup.ts`'s
`listMetricRollups`) — goes through parameterized `$1`/`$2`/... placeholders. The
dynamically-built pieces of SQL in those functions are only ever `column = $N` clauses
and `$N` positions themselves (both derived from `params.length`, an integer, not
request data), never a value.

**Review gate**: any new table/query added in a future pass must keep this shape —
only `handle.quotedSchema` (or a hardcoded literal) may be interpolated into a query
string; every value-shaped piece of data goes through a parameter placeholder.

## 2. Ingestion validation

`captureInputSchema` (zod) gates the event ingestion path in
`dashboard/core.ts`'s `ingest()` via `safeParse` before anything touches storage;
malformed payloads are rejected with a 400, never written to the database.

**Review gate**: the structured-log and metrics ingestion paths added in this slice
write directly from the Node SDK's typed API (`client.log`, `client.metrics.*`) rather
than through a public HTTP endpoint, so there's currently no unvalidated external input
to those tables. If a public HTTP ingestion route for logs/metrics is added later, it
needs an equivalent zod `safeParse` gate before touching storage, matching the pattern
`captureInputSchema` already establishes.

## 3. Secret redaction gap (top finding)

`node/redact.ts`'s `SECRET_KEY_PATTERN`
(`authorization|cookie|password|secret|token|api[-_]?key`) is applied only to
`context`, via `exception.ts`'s `exceptionToInput`/`messageToInput`. It is **not**
applied to `message` or `stackTrace`.

**Concrete failure scenario**: `throw new Error(\`Stripe request failed:
sk_live_${apiKey}\`)` — or any thrown error whose message or stack frame embeds a
token, or a URL with an API key in its query string — persists that secret verbatim
into the `events` table and renders it unescaped-but-unredacted on the issue detail
page (`dashboard/html.ts`'s `renderEvent`, inside a `<pre>` block).

**Recommendation**: add a configurable regex list (defaulting to a pattern like
`sk_live_[\w]+`, bearer-token-shaped substrings, etc.) applied to `message` and
`stackTrace` the same way `redactSecrets` already walks `context`/`extra`, exposed via
the existing `beforeCapture`-style hook point. Not fixed as a drive-by in this review —
scoping the right default pattern list (avoiding both under- and over-redaction of
legitimate error text) deserves its own pass with dedicated tests, called out here as
the review's top actionable recommendation.

## 4. Dependency audit

Confirmed no Dependabot/CodeQL/Snyk/`pnpm audit` existed anywhere in this repo prior to
this package's CI work. Now in place:

- Root `.github/dependabot.yml` — weekly `npm` (pnpm-workspace-aware from the root) and
  `github-actions` update checks.
- `.github/workflows/observability-package.yml` runs `pnpm audit --audit-level=high` as
  a CI step on every push/PR touching this package.

No CodeQL/Snyk integration exists yet — out of scope for this review pass; flagged here
as a known gap rather than silently omitted.

## 5. Dashboard auth defaults (verified intentional)

`guard()`/`guardIngest()` in `dashboard/fastify.ts` allow every request through when no
`authorize`/`ingestKey` option is configured. This is **deliberate**, not an oversight:
a zero-config self-hosted install should work out of the box, and the package's own
docs (README Quickstart) instruct every deployer to supply `authorize` before exposing
the dashboard beyond localhost. Restated here so a future reviewer doesn't flag it as a
false positive: the "unconfigured = allow everything" default is a documented,
intentional trust-the-deployer posture consistent with the rest of this package (e.g.
unbounded metric tag cardinality, no built-in identity system).

## Out of scope for this pass

- Non-Node-language SDKs / a cross-language ingestion protocol doc (explicitly
  out of scope for the whole "next slice," not just this review).
- CodeQL or a third-party SAST/dependency-scanning service beyond `pnpm audit`.
- A penetration test or fuzzing pass against the ingestion endpoint.
