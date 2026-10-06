import { describe, expect, it } from "vitest";
import { lintWorkflow } from "./lint.ts";

const sha = "3d3c42e5aac5ba805825da76410c181273ba90b1";

function workflow(body: string): string {
  return `name: Test\non: push\n${body}`;
}

const job = `jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${sha}
`;

describe("lintWorkflow", () => {
  it("passes a workflow with read-only top-level permissions and pinned actions", () => {
    expect(lintWorkflow(workflow(`permissions:\n  contents: read\n${job}`))).toEqual([]);
  });

  it("passes a workflow that grants no permissions at all", () => {
    expect(lintWorkflow(workflow(`permissions: {}\n${job}`))).toEqual([]);
  });

  describe("permissions", () => {
    it("fails a workflow with no top-level permissions block", () => {
      expect(lintWorkflow(workflow(job))).toEqual([
        { line: 1, message: expect.stringContaining("top-level `permissions:`") as unknown },
      ]);
    });

    it.each(["write-all", "read-all"])("fails top-level permissions of %s", (value) => {
      expect(lintWorkflow(workflow(`permissions: ${value}\n${job}`))).toEqual([
        { line: 3, message: expect.stringContaining(value) as unknown },
      ]);
    });

    it("fails a top-level permissions key with no value", () => {
      expect(lintWorkflow(workflow(`permissions:\n${job}`))).toEqual([
        { line: 3, message: expect.stringContaining("no value") as unknown },
      ]);
    });

    it("fails a write permission granted to the whole workflow", () => {
      expect(lintWorkflow(workflow(`permissions:\n  contents: read\n  id-token: write\n${job}`))).toEqual([
        { line: 5, message: expect.stringContaining("`id-token: write`") as unknown },
      ]);
    });

    it("passes a write permission granted to one job", () => {
      const source = workflow(`permissions: {}
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: echo release
`);
      expect(lintWorkflow(source)).toEqual([]);
    });

    it("fails a job granted write-all", () => {
      const source = workflow(`permissions: {}
jobs:
  release:
    runs-on: ubuntu-latest
    permissions: write-all
    steps:
      - run: echo release
`);
      expect(lintWorkflow(source)).toEqual([
        { line: 7, message: expect.stringContaining("write-all") as unknown },
      ]);
    });
  });

  describe("action pins", () => {
    it.each(["actions/checkout@v7", "actions/checkout@main", "actions/checkout@3d3c42e", "actions/checkout"])(
      "fails a step that uses %s",
      (uses) => {
        const source = workflow(`permissions: {}
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ${uses}
`);
        expect(lintWorkflow(source)).toEqual([
          { line: 8, message: expect.stringContaining(uses) as unknown },
        ]);
      },
    );

    it("fails a reusable workflow called by tag", () => {
      const source = workflow(`permissions: {}
jobs:
  deploy:
    uses: some-org/some-repo/.github/workflows/deploy.yml@v1
`);
      expect(lintWorkflow(source)).toEqual([
        { line: 6, message: expect.stringContaining("some-org/some-repo") as unknown },
      ]);
    });

    it("passes a reusable workflow called by SHA", () => {
      const source = workflow(`permissions: {}
jobs:
  deploy:
    uses: some-org/some-repo/.github/workflows/deploy.yml@${sha}
`);
      expect(lintWorkflow(source)).toEqual([]);
    });

    describe("in an example ops-repo caller", () => {
      const caller = (uses: string) =>
        workflow(`permissions: {}
jobs:
  deploy:
    uses: ${uses}
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
`);

      it("passes a reusable workflow called by release tag, as ADR 0015's refs allow", () => {
        expect(
          lintWorkflow(caller("some-org/some-repo/.github/workflows/deploy.yml@v0.1.0"), {
            exampleCaller: true,
          }),
        ).toEqual([{ line: 10, message: expect.stringContaining("actions/checkout@v7") as unknown }]);
      });

      it("fails a reusable workflow called by a branch", () => {
        expect(
          lintWorkflow(caller("some-org/some-repo/.github/workflows/deploy.yml@main"), {
            exampleCaller: true,
          }).map((problem) => problem.line),
        ).toEqual([6, 10]);
      });
    });

    it("passes a local action or workflow", () => {
      const source = workflow(`permissions: {}
jobs:
  build:
    uses: ./.github/workflows/build.yml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup
`);
      expect(lintWorkflow(source)).toEqual([]);
    });

    it("passes a Docker image pinned by digest and fails one pinned by tag", () => {
      const digest = `sha256:${"a".repeat(64)}`;
      const source = workflow(`permissions: {}
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: docker://alpine@${digest}
      - uses: docker://alpine:3.20
`);
      expect(lintWorkflow(source)).toEqual([
        { line: 9, message: expect.stringContaining("docker://alpine:3.20") as unknown },
      ]);
    });
  });

  it("reports a file that isn't a workflow mapping", () => {
    expect(lintWorkflow("- just\n- a list\n")).toEqual([
      { line: 1, message: expect.stringContaining("mapping") as unknown },
    ]);
  });

  it("reports invalid YAML", () => {
    expect(lintWorkflow("on: [push\n")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("YAML") as unknown }),
    ]);
  });
});
