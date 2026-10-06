import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "tools",
    environment: "node",
    // The config-level ESLint tests type-check files on first lint.
    testTimeout: 30_000,
  },
});
