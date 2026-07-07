import { addMapping, GenMapping, toEncodedMap } from "@jridgewell/gen-mapping";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runSourcemap } from "../src/cli/sourcemap.js";

describe("runSourcemap", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("resolves a minified stack frame back to its original source location", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "observability-sourcemap-test-"));
    const map = new GenMapping({ file: "bundle.abc123.js" });
    addMapping(map, {
      generated: { line: 1, column: 30 },
      source: "src/handler.ts",
      original: { line: 42, column: 8 }
    });
    writeFileSync(path.join(dir, "bundle.abc123.js.map"), JSON.stringify(toEncodedMap(map)));

    const stackFile = path.join(dir, "stack.txt");
    writeFileSync(
      stackFile,
      "TypeError: boom\n    at handleClick (https://example.com/assets/bundle.abc123.js:1:30)"
    );

    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runSourcemap(["--maps", dir, "--stack-file", stackFile]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("src/handler.ts:42:8"));
    // The frame's closing paren must survive the replacement, not just the location text.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("(src/handler.ts:42:8)"));
  });

  it("leaves a frame unchanged when no matching .map file exists", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "observability-sourcemap-test-"));
    const stackFile = path.join(dir, "stack.txt");
    writeFileSync(stackFile, "Error: boom\n    at foo (https://example.com/assets/unknown.js:1:1)");

    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runSourcemap(["--maps", dir, "--stack-file", stackFile]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unknown.js:1:1"));
  });

  it("leaves non-frame lines (like the error message) untouched", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "observability-sourcemap-test-"));
    const stackFile = path.join(dir, "stack.txt");
    writeFileSync(stackFile, "TypeError: something broke\n    at foo (https://example.com/assets/unknown.js:1:1)");

    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runSourcemap(["--maps", dir, "--stack-file", stackFile]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("TypeError: something broke"));
  });

  it("throws when neither --stack-file nor --issue is provided", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runSourcemap(["--maps", "/tmp"])).rejects.toThrow();
  });

  it("throws when --maps is missing", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runSourcemap(["--stack-file", "/tmp/does-not-matter.txt"])).rejects.toThrow(
      "A source maps directory is required"
    );
  });
});
