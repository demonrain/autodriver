import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/shared/src/**/*.test.ts",
      "apps/server/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx"
    ]
  }
});
