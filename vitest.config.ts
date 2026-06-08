import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ccagent/core": fromRoot("./packages/core/src/index.ts"),
      "@ccagent/daemon": fromRoot("./apps/daemon/src/index.ts"),
      "@ccagent/daemon-client": fromRoot("./packages/daemon-client/src/index.ts"),
      "@ccagent/provider": fromRoot("./packages/provider/src/index.ts"),
      "@ccagent/proxy": fromRoot("./packages/proxy/src/index.ts"),
      "@ccagent/runner": fromRoot("./packages/runner/src/index.ts"),
      "@ccagent/secrets": fromRoot("./packages/secrets/src/index.ts"),
      "@ccagent/storage": fromRoot("./packages/storage/src/index.ts")
    }
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "apps/**/*.spec.ts",
      "apps/**/*.spec.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "tests/**/*.spec.ts",
      "tests/**/*.spec.tsx"
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/gui/tests/electron-smoke.spec.ts",
      "apps/gui/tests/electron-dashboard.spec.ts"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["apps/**/src/**/*.{ts,tsx}", "packages/**/src/**/*.ts"],
      exclude: [
        "**/dist/**",
        "**/node_modules/**",
        "**/*.d.ts",
        "**/types.ts",
        "**/protocolTypes.ts",
        "apps/gui/src/main/index.ts",
        "apps/gui/src/main/preload.cts",
        "apps/gui/src/renderer/main.tsx"
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      }
    }
  }
});
