import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts", "src/index.ts", "src/locales/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 78,
      },
    },
  },
});
