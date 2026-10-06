// This repo's own ESLint rules, as a plugin for eslint.config.js.
import type { ESLint } from "eslint";
import { noCloudflareInCore } from "./no-cloudflare-in-core.ts";

// typescript-eslint's rule type and ESLint's own don't line up, though ESLint
// runs typescript-eslint rules as they are.
export const plugin = {
  rules: { "no-cloudflare-in-core": noCloudflareInCore },
} as unknown as ESLint.Plugin;
