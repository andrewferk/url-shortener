import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const adrTags = readdirSync(fileURLToPath(new URL("docs/adr", import.meta.url)))
  .map((file) => /^(\d{4})-.*\.md$/.exec(file)?.[1])
  .filter((number): number is string => number !== undefined)
  .map((number) => ({ name: `adr-${number}` }));

export default defineConfig({
  test: {
    tags: adrTags,
    projects: [
      "packages/*/vitest.config.ts",
      "workers/*/vitest.config.ts",
      "tools/vitest.config.ts",
    ],
  },
});
