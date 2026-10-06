# Contributing

Thanks for helping. This file covers getting set up, the rules CI holds every change to, and how a contribution is licensed.

## Before you start

- Read [`CONTEXT.md`](./CONTEXT.md), the glossary. Code, tests, issues and docs use its terms: a **Link** has a **Short code** and a **Target URL**, a **Visitor** follows a **Short URL**, and so on.
- Read the ADRs in [`docs/adr/`](./docs/adr/) that touch the area you're changing. A change that contradicts one needs a new ADR, or an amendment, in the same pull request.
- For anything bigger than a small fix, open an issue first, so we can agree on the approach before you write it.
- To report a vulnerability, follow [`SECURITY.md`](./SECURITY.md), not an issue.

## Setting up

You need Node.js 24 (see [`.nvmrc`](./.nvmrc)) and npm. To validate the OpenTofu roots, you also need [OpenTofu](https://opentofu.org/) 1.13.

```sh
npm ci
npm test
```

None of it needs a Cloudflare account or any credential. The Workers' integration tests run in a local `workerd`.

| Command                    | What it runs                                                       |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run lint`             | ESLint, then the workflow lint                                     |
| `npm run typecheck`        | `tsc` for every `tsconfig.json` in the repo                        |
| `npm run test:unit`        | The domain core's and the tooling's tests, under plain Node        |
| `npm run test:integration` | The Workers' tests in local `workerd`, via `@cloudflare/vitest-plugin` |
| `npm test`                 | Every test                                                         |
| `npm run validate:tofu`    | `tofu fmt -check` and `tofu validate` for every root in `infra/`   |

## Layout

- `packages/core`: `@url-shortener/core`, the domain core. Pure TypeScript.
- `workers/*`: the Workers and their adapters. Each is its own workspace.
- `infra/`: the OpenTofu roots.
- `tools/`: this repo's own lint rules and scripts.
- `docs/adr/`: the decisions, and why.

## The rules CI enforces

CI runs on every pull request and on `main`. It needs no secrets, so a fork's pull request runs all of it, and its `CI` job must pass before a pull request merges.

### The domain core stays portable

The core never imports `cloudflare:*`, any `@cloudflare/*` package or Wrangler, and never uses a Workers type such as `KVNamespace`, `DurableObjectState` or `Env` ([ADR 0001](./docs/adr/0001-cloudflare-workers-typescript-durable-objects-kv.md)). The `url-shortener/no-cloudflare-in-core` lint rule fails any that do. Cloudflare belongs in the Workers, as adapters behind the core's ports.

The core also never depends on another workspace package ([ADR 0015](./docs/adr/0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md)).

### Workspace packages are imported by name

Import a workspace package by its name, such as `@url-shortener/core`, so you get only what its `exports` map exposes. A deep import such as `@url-shortener/core/src/redirect.ts`, or a relative path into another workspace, fails the lint.

### Workflows ask for as little as they can

Every workflow declares a top-level `permissions:` block ([ADR 0025](./docs/adr/0025-keep-a-locked-off-account-copy-of-the-change-log-and-state-what-every-operator-must-protect.md)). At the top level it may grant only `read` or `none`. A job that needs to write is granted that on the job itself, and no job is granted `read-all` or `write-all`.

Every action and reusable workflow from another repository is pinned by a full commit SHA, with its version in a comment:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Dependabot opens the pull requests that move these pins. `npm run lint:workflows` checks both rules.

The one exception is an example ops-repo caller under `examples/`: it may call a reusable workflow by release tag, such as `@v0.1.0`, because Operators pin this repo's releases by tag ([ADR 0015](./docs/adr/0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md)). Its actions are still pinned by SHA.

### No deployment values

This repository never holds a deployment's values: no domain, account ID, zone ID, token ID or credential, in code, docs, tests or committed config ([ADR 0013](./docs/adr/0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md), ADR 0015). Each Deployment keeps those in its own ops repo. Tests and examples use reserved names such as `example.com` or `.test`.

## Pull requests

- Keep one change to one pull request, with tests for the behaviour it adds or fixes.
- Explain the change, and link the issue or ADR it implements.
- Make sure `npm run lint`, `npm run typecheck` and `npm test` pass locally.

## Licensing

This project is licensed under the [Apache License 2.0](./LICENSE). There is no CLA and no DCO sign-off. As section 5 of the licence says, a contribution you submit is licensed under the same terms, unless you state otherwise.
