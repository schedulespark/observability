import { describe, expect, it } from "vitest";

import { createBreadcrumbBuffer } from "../src/core/breadcrumbs.js";

describe("createBreadcrumbBuffer", () => {
  it("returns an empty snapshot with no breadcrumbs added", () => {
    const buffer = createBreadcrumbBuffer();
    expect(buffer.snapshot()).toEqual([]);
  });

  it("stamps a timestamp and returns breadcrumbs in insertion order", () => {
    const buffer = createBreadcrumbBuffer();
    buffer.add({ category: "nav", message: "loaded /dashboard" });
    buffer.add({ category: "click", message: "clicked #save" });

    const snapshot = buffer.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatchObject({ category: "nav", message: "loaded /dashboard" });
    expect(snapshot[1]).toMatchObject({ category: "click", message: "clicked #save" });
    expect(typeof snapshot[0].timestamp).toBe("string");
  });

  it("drops the oldest breadcrumb once the buffer exceeds maxSize", () => {
    const buffer = createBreadcrumbBuffer(2);
    buffer.add({ category: "a", message: "first" });
    buffer.add({ category: "b", message: "second" });
    buffer.add({ category: "c", message: "third" });

    const snapshot = buffer.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((crumb) => crumb.message)).toEqual(["second", "third"]);
  });

  it("does not clear the buffer on snapshot, so repeated captures see overlapping context", () => {
    const buffer = createBreadcrumbBuffer();
    buffer.add({ category: "a", message: "one" });

    expect(buffer.snapshot()).toHaveLength(1);
    expect(buffer.snapshot()).toHaveLength(1);
  });

  it("preserves optional level and data fields", () => {
    const buffer = createBreadcrumbBuffer();
    buffer.add({ category: "fetch", message: "GET /api/foo", level: "error", data: { status: 500 } });

    expect(buffer.snapshot()[0]).toMatchObject({
      category: "fetch",
      message: "GET /api/foo",
      level: "error",
      data: { status: 500 }
    });
  });
});
