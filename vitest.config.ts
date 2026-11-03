import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts", "src/index.ts", "src/locales/**/*.ts"],
      thresholds: {
        lines: 91,
        statements: 91,
        functions: 100,
        branches: 80,
      },
    },
  },
});
