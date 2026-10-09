# Contributing

Thanks for helping. This file covers getting set up, the rules CI holds every change to, and how a contribution is licensed.

## Before you start

- Read [`CONTEXT.md`](./CONTEXT.md), the glossary. Code, tests, issues and docs use its terms: a **Link** has a **Short code** and a **Target URL**, a **Visitor** follows a **Short URL**, and so on.
- Read the ADRs in [`docs/adr/`](./docs/adr/) that touch the area you're changing. A change that contradicts one needs a new ADR, or an amendment, in the same pull request.
- For anything bigger than a small fix, open an issue first, so we can agree on the approach before you write it.
- To report a vulnerability, follow [`SECURITY.md`](./SECURITY.md), not an issue.

## Setting up

You need the Node.js version in [`.tool-versions`](./.tool-versions), and npm. To validate the OpenTofu roots, you also need the [OpenTofu](https://opentofu.org/) version there. mise and asdf read `.tool-versions`, nvm and fnm read the same Node version from `.nvmrc`, and npm warns when the running Node differs from `devEngines` in `package.json`.

```sh
npm ci
npm test
```

None of it needs a Cloudflare account or any credential. The Workers' integration tests run in a local `workerd`.

| Command                    | What it runs                                                       |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run lint`             | ESLint, the workflow lint, then the tool-version check             |
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

Every action and reusable workflow from another repository is pinned by a full commit SHA, with its version in a comment on the same line:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

An action released from a monorepo under a prefixed tag keeps that tag whole in the comment, such as `# comment-guard-v0.3.0`.

Dependabot opens the pull requests that move these pins. `npm run lint:workflows` checks both rules.

The one exception is an example ops-repo caller under `examples/`: it may call a reusable workflow by release tag, such as `@v0.1.0`, because Operators pin this repo's releases by tag ([ADR 0015](./docs/adr/0015-apache-2-and-every-deployment-runs-from-its-own-ops-repo.md)). Its actions are still pinned by SHA.

### Tool versions agree

`.tool-versions` pins the exact Node.js and OpenTofu versions. Every other copy must agree with it:

- Node: `.nvmrc`, `devEngines.runtime` in `package.json`, and every `actions/setup-node` step. A setup-node step reads one of those files with `node-version-file`, or names the same version. `@types/node` stays on the same major version.
- OpenTofu: every `setup-opentofu` step's `tofu_version`, and every `required_version` in `infra/`, which must allow the pinned version.

To move a version, change every copy in one pull request. `npm run lint:versions` names any copy you missed.

### No deployment values

This repository never holds a deployment's values: no domain, account ID, zone ID, token ID or credential, in code, docs, tests or committed config ([ADR 0013](./docs/adr/0013-a-deployment-is-given-its-domain-and-owns-a-dedicated-zone.md), ADR 0015). Each Deployment keeps those in its own ops repo. Tests and examples use reserved names such as `example.com` or `.test`.

### Comments cite no document

Names, types and test names carry the facts about the code. A comment is for a non-obvious why that none of those can hold, and it states the fact without naming where it came from: no comment cites an ADR, issue, pull request, slice or spec section. This holds in every source and config file, including Terraform, workflows and ESLint config. Markdown is exempt, so docs such as this file cite ADRs freely, and a lint rule's message may name the ADR it enforces, because the reader has just broken it. CI checks the lines each pull request adds with the comment-guard action.

The link between a change and its decision lives in the pull request, the commit and the test:

- The pull request description explains the change, says `Closes #N` for the issue it finishes, and names the ADRs it implements.
- Each commit ends with a trailer per decision and per issue it touches, one value per line, using the repo's own spelling of an ADR:

  ```text
  Implements: ADR 0009
  Refs: #94
  ```

  A pull request is squash-merged, and the squash body is the branch's commit messages, so the trailers reach `main` and `git log --grep "ADR 0009"` finds every implementing commit. Whoever merges ends the squash message with the trailers, editing it if GitHub has bulleted them.
- A test that proves a rule an ADR states carries the ADR as a Vitest tag on its `describe`, spelled `adr-0009` because a tag name allows no space:

  ```ts
  describe("keyedCandidate", { tags: ["adr-0009"] }, () => {
    it("gives up after 8 candidates", () => {
  ```

  `describe` names the exported symbol or a `CONTEXT.md` term, `it` states the behaviour in plain words with the number or rule in it, and the ADR appears only in the tag, never in a title. `vitest.config.ts` reads the tag list from the files in `docs/adr/`, so a new ADR is a tag at once, a tag for an ADR that does not exist fails the run, `npx vitest run --tags-filter=adr-0009` runs one decision's tests, and `npx vitest --list-tags` prints the index. Vitest's file-wide `@module-tag` comment is not used: it is a comment that cites a document.

## Pull requests

- Keep one change to one pull request, with tests for the behaviour it adds or fixes.
- Explain the change, and link its issue and ADRs the way [Comments cite no document](#comments-cite-no-document) says: in the description, the commit trailers and the test tags, never in a comment.
- Make sure `npm run lint`, `npm run typecheck` and `npm test` pass locally.

## Licensing

This project is licensed under the [Apache License 2.0](./LICENSE). There is no CLA and no DCO sign-off. As section 5 of the licence says, a contribution you submit is licensed under the same terms, unless you state otherwise.
