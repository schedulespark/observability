// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { init } from "../src/browser/client.js";

const INGEST_URL = "https://example.com/observability/ingest";

describe("browser client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a capture payload with the current breadcrumb snapshot attached", async () => {
    const client = init({ ingestUrl: INGEST_URL, captureGlobalErrors: false, autoBreadcrumbs: false });

    client.addBreadcrumb({ category: "nav", message: "loaded /dashboard" });
    client.captureException(new Error("boom"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INGEST_URL);
    const body = JSON.parse(requestInit.body as string) as { breadcrumbs: { category: string }[] };
    expect(body.breadcrumbs).toHaveLength(1);
    expect(body.breadcrumbs[0]).toMatchObject({ category: "nav", message: "loaded /dashboard" });
  });

  it("redacts secret-looking keys in breadcrumb data", () => {
    const client = init({ ingestUrl: INGEST_URL, captureGlobalErrors: false, autoBreadcrumbs: false });

    client.addBreadcrumb({ category: "http", message: "POST /login", data: { password: "super-secret", ok: true } });
    client.captureMessage("check breadcrumbs");

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as { breadcrumbs: { data: Record<string, unknown> }[] };
    expect(body.breadcrumbs[0].data).toEqual({ password: "[redacted]", ok: true });
  });

  it("auto-records a fetch breadcrumb for requests other than the ingest endpoint", async () => {
    const client = init({ ingestUrl: INGEST_URL, captureGlobalErrors: false, autoBreadcrumbs: true });

    await fetch("https://example.com/api/widgets");
    client.captureMessage("after fetch");

    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    const ingestCall = calls.find(([url]) => url === INGEST_URL);
    expect(ingestCall).toBeDefined();
    const body = JSON.parse((ingestCall?.[1]?.body as string) ?? "{}") as {
      breadcrumbs: { category: string; message: string }[];
    };
    expect(body.breadcrumbs.some((crumb) => crumb.category === "fetch" && crumb.message.includes("/api/widgets"))).toBe(
      true
    );
  });

  it("does not record a breadcrumb for the SDK's own ingestion request", async () => {
    const client = init({ ingestUrl: INGEST_URL, captureGlobalErrors: false, autoBreadcrumbs: true });

    client.captureMessage("first");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    client.captureMessage("second");
    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as { breadcrumbs: unknown[] };
    expect(body.breadcrumbs).toHaveLength(0);
  });
});
