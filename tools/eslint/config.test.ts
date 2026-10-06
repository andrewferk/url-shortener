// Lints fixtures through the repo's own eslint.config.js, so these tests prove
// the rules are wired to the right files, not only that the rules work. The
// fixtures aren't on disk, so type-aware linting is switched off for them.
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  cwd: new URL("../..", import.meta.url).pathname,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

// The rule ID of each problem, or the message of one with no rule, such as a
// parsing error, so a test that expects a rule shows why it didn't fire.
async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message);
}

const cloudflareInCore = 'import { DurableObject } from "cloudflare:workers";\nexport class Shard extends DurableObject {}\n';
const workersTypeInCore = "export function read(kv: KVNamespace): KVNamespace {\n  return kv;\n}\n";

describe("the core boundary", () => {
  it("fails a cloudflare:* import in the core", async () => {
    expect(await ruleIds("packages/core/src/fixture.ts", cloudflareInCore)).toContain(
      "url-shortener/no-cloudflare-in-core",
    );
  });

  it("fails a Workers type in the core", async () => {
    expect(await ruleIds("packages/core/src/fixture.ts", workersTypeInCore)).toContain(
      "url-shortener/no-cloudflare-in-core",
    );
  });

  it("fails a Workers type in the core's tests too", async () => {
    expect(await ruleIds("packages/core/test/fixture.test.ts", workersTypeInCore)).toContain(
      "url-shortener/no-cloudflare-in-core",
    );
  });

  it("fails Workers types referenced from a declaration file in the core", async () => {
    const code = '/// <reference types="@cloudflare/workers-types" />\nexport {};\n';
    expect(await ruleIds("packages/core/src/env.d.ts", code)).toContain(
      "url-shortener/no-cloudflare-in-core",
    );
  });

  it("lets a Worker import cloudflare:*", async () => {
    expect(await ruleIds("workers/redirect/src/fixture.ts", cloudflareInCore)).not.toContain(
      "url-shortener/no-cloudflare-in-core",
    );
  });

  it("fails the core depending on another workspace package", async () => {
    const code = 'import worker from "@url-shortener/redirect";\nexport default worker;\n';
    expect(await ruleIds("packages/core/src/fixture.ts", code)).toContain(
      "@typescript-eslint/no-restricted-imports",
    );
  });
});

describe("imports of a workspace package", () => {
  it("allow the package's exports map", async () => {
    const code = 'import { decideRedirect } from "@url-shortener/core";\nexport const decide = decideRedirect;\n';
    expect(await ruleIds("workers/redirect/src/fixture.ts", code)).toEqual([]);
  });

  it("fail a deep import past the exports map", async () => {
    const code = 'import { decideRedirect } from "@url-shortener/core/src/redirect.ts";\nexport const decide = decideRedirect;\n';
    expect(await ruleIds("workers/redirect/src/fixture.ts", code)).toContain(
      "@typescript-eslint/no-restricted-imports",
    );
  });

  it("fail a relative path into another workspace", async () => {
    const code = 'import { decideRedirect } from "../../../packages/core/src/redirect.ts";\nexport const decide = decideRedirect;\n';
    expect(await ruleIds("workers/redirect/src/fixture.ts", code)).toContain(
      "@typescript-eslint/no-restricted-imports",
    );
  });
});
