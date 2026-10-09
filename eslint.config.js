import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import { plugin } from "./tools/eslint/plugin.ts";

const workspaceImports = [
  {
    group: ["@url-shortener/*/**"],
    message: "Import a workspace package by its name only, through its exports map (ADR 0015).",
  },
  {
    regex: "^(?:\\.{1,2}/)+(?:.*/)?(?:packages|workers)/",
    message: "Import a workspace package by its name, not by a relative path into it (ADR 0015).",
  },
];

export default defineConfig(
  globalIgnores(["**/node_modules/", "**/.wrangler/", "workers/*/src/env.d.ts"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "url-shortener": plugin },
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: workspaceImports }],
      "@typescript-eslint/promise-function-async": "error",
      // Off because it fails the `async` that promise-function-async requires
      // of a function with nothing to await.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["packages/core/**"],
    rules: {
      "url-shortener/no-cloudflare-in-core": "error",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            ...workspaceImports,
            {
              group: ["@url-shortener/*", "!@url-shortener/core"],
              message: "The core never depends on another workspace package (ADR 0015).",
            },
          ],
        },
      ],
    },
  },
);
