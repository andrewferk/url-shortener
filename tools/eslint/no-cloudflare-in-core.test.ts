import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import { noCloudflareInCore } from "./no-cloudflare-in-core.ts";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run("no-cloudflare-in-core", noCloudflareInCore, {
  valid: [
    'import { y } from "./y.ts"; export const x = y;',
    'export const url = new URL("https://example.test/abc1234");',
    "export const bytes = crypto.getRandomValues(new Uint8Array(7));",
    "export function respond(): Response { return new Response(null, { status: 404 }); }",
    // A name the core declares itself is the core's own, whatever it's called.
    "interface KVNamespace { get(key: string): string } export function f(kv: KVNamespace) { return kv; }",
  ],
  invalid: [
    {
      code: 'import { DurableObject } from "cloudflare:workers";',
      errors: [{ messageId: "cloudflareModule", data: { source: "cloudflare:workers" } }],
    },
    {
      code: 'import type { KVNamespace } from "@cloudflare/workers-types";',
      errors: [{ messageId: "cloudflareModule", data: { source: "@cloudflare/workers-types" } }],
    },
    {
      code: 'export * from "cloudflare:sockets";',
      errors: [{ messageId: "cloudflareModule" }],
    },
    {
      code: 'export { connect } from "cloudflare:sockets";',
      errors: [{ messageId: "cloudflareModule" }],
    },
    {
      code: 'export const load = () => import("cloudflare:workers");',
      errors: [{ messageId: "cloudflareModule" }],
    },
    {
      code: 'export type Workers = typeof import("cloudflare:workers");',
      errors: [{ messageId: "cloudflareModule" }],
    },
    {
      code: 'import wrangler = require("wrangler");',
      errors: [{ messageId: "cloudflareModule", data: { source: "wrangler" } }],
    },
    {
      code: '/// <reference types="@cloudflare/workers-types" />\nexport {};',
      errors: [{ messageId: "cloudflareModule" }],
    },
    {
      code: "export function read(kv: KVNamespace) { return kv; }",
      errors: [{ messageId: "workersType", data: { name: "KVNamespace" } }],
    },
    {
      code: "export abstract class Shard implements DurableObject {}",
      errors: [{ messageId: "workersType", data: { name: "DurableObject" } }],
    },
    {
      code: "export function handle(ctx: ExecutionContext, rewriter = new HTMLRewriter()) { return [ctx, rewriter]; }",
      errors: [
        { messageId: "workersType", data: { name: "ExecutionContext" } },
        { messageId: "workersType", data: { name: "HTMLRewriter" } },
      ],
    },
    {
      // Wrangler generates Env and the Cloudflare namespace for each Worker.
      code: "export function f(env: Env, other: Cloudflare.Env) { return [env, other]; }",
      errors: [
        { messageId: "workersType", data: { name: "Env" } },
        { messageId: "workersType", data: { name: "Cloudflare" } },
      ],
    },
  ],
});
