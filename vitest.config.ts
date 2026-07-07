import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/dist/**", "**/node_modules/**"],
    hookTimeout: 20000,
    testTimeout: 20000
  }
});
