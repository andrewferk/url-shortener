import { describe, expect, it } from "vitest";
import { checkVersions } from "./check.ts";

const sha = "820762786026740c76f36085b0efc47a31fe5020";
const tofuSha = "a1320f892987e89d278cc92dc5adc984fb93aca4";

function packageJson(runtimeVersion: string, typesNode = "24.19.1"): string {
  return JSON.stringify({
    devEngines: { runtime: { name: "node", version: runtimeVersion, onFail: "warn" } },
    devDependencies: { "@types/node": typesNode },
  });
}

function workflow(steps: string): string {
  return `name: Test
on: push
permissions: {}
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
${steps}`;
}

const setupNode = `      - uses: actions/setup-node@${sha} # v7.0.0
        with:
          node-version-file: package.json
`;
const setupTofu = (version: string) => `      - uses: opentofu/setup-opentofu@${tofuSha} # v2.0.2
        with:
          tofu_version: ${version}
`;
const versionsTf = (constraint: string) => `terraform {\n  required_version = "${constraint}"\n}\n`;

// A repo whose every version agrees.
function repo(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ".tool-versions": "nodejs 24.21.0\nopentofu 1.13.1\n",
    ".nvmrc": "24.21.0\n",
    "package.json": packageJson("24.21.0"),
    ".github/workflows/ci.yml": workflow(setupNode + setupTofu("1.13.1")),
    "infra/zone/versions.tf": versionsTf("~> 1.13.0"),
    ...overrides,
  };
}

const messages = (files: Record<string, string>) => checkVersions(files).map((problem) => `${problem.file}: ${problem.message}`);

describe("checkVersions", () => {
  it("passes a repo whose versions all agree", () => {
    expect(checkVersions(repo())).toEqual([]);
  });

  describe(".tool-versions", () => {
    it("fails when it doesn't pin Node", () => {
      expect(messages(repo({ ".tool-versions": "opentofu 1.13.1\n" }))).toEqual([
        expect.stringMatching(/^\.tool-versions: .*`nodejs`/) as unknown,
      ]);
    });

    it("fails when it doesn't pin OpenTofu", () => {
      expect(messages(repo({ ".tool-versions": "nodejs 24.21.0\n" }))).toEqual([
        expect.stringMatching(/^\.tool-versions: .*`opentofu`/) as unknown,
      ]);
    });

    it("fails a version that isn't exact", () => {
      expect(messages(repo({ ".tool-versions": "nodejs 24\nopentofu 1.13.1\n" }))).toEqual([
        expect.stringMatching(/^\.tool-versions: .*exact/) as unknown,
      ]);
    });

    it("fails every copy left behind when only .tool-versions moves", () => {
      expect(messages(repo({ ".tool-versions": "nodejs 24.22.0\nopentofu 1.14.0\n" }))).toEqual([
        expect.stringMatching(/^\.nvmrc: .*24\.21\.0.*24\.22\.0/) as unknown,
        expect.stringMatching(/^package\.json: .*devEngines\.runtime.*24\.21\.0.*24\.22\.0/) as unknown,
        expect.stringMatching(/^\.github\/workflows\/ci\.yml: .*1\.13\.1.*1\.14\.0/) as unknown,
        expect.stringMatching(/^infra\/zone\/versions\.tf: .*~> 1\.13\.0.*1\.14\.0/) as unknown,
      ]);
    });

    it("ignores comments and blank lines", () => {
      expect(checkVersions(repo({ ".tool-versions": "# Tools\n\nnodejs 24.21.0 # LTS\nopentofu 1.13.1\n" }))).toEqual([]);
    });
  });

  describe("Node", () => {
    it("fails an .nvmrc that differs from .tool-versions", () => {
      expect(messages(repo({ ".nvmrc": "24.20.0\n" }))).toEqual([
        expect.stringMatching(/^\.nvmrc: .*24\.20\.0.*24\.21\.0/) as unknown,
      ]);
    });

    it("fails a devEngines.runtime version that differs from .tool-versions", () => {
      expect(messages(repo({ "package.json": packageJson("^24.21.0") }))).toEqual([
        expect.stringMatching(/^package\.json: .*devEngines\.runtime.*\^24\.21\.0/) as unknown,
      ]);
    });

    it("fails a package.json with no devEngines.runtime for node", () => {
      expect(messages(repo({ "package.json": JSON.stringify({ devDependencies: { "@types/node": "24.19.1" } }) }))).toEqual([
        expect.stringMatching(/^package\.json: .*devEngines\.runtime/) as unknown,
      ]);
    });

    it("fails @types/node for another Node major", () => {
      expect(messages(repo({ "package.json": packageJson("24.21.0", "22.10.0") }))).toEqual([
        expect.stringMatching(/^package\.json: .*@types\/node.*22\.10\.0/) as unknown,
      ]);
    });

    it("fails a setup-node step pinned to another version", () => {
      const steps = `      - uses: actions/setup-node@${sha} # v7.0.0
        with:
          node-version: 24.20.0
`;
      expect(messages(repo({ ".github/workflows/ci.yml": workflow(steps) }))).toEqual([
        expect.stringMatching(/^\.github\/workflows\/ci\.yml: .*24\.20\.0/) as unknown,
      ]);
    });

    it("passes a setup-node step that reads any of the checked files", () => {
      const steps = [".nvmrc", ".tool-versions", "package.json"]
        .map((file) => `      - uses: actions/setup-node@${sha} # v7.0.0\n        with:\n          node-version-file: ${file}\n`)
        .join("");
      expect(checkVersions(repo({ ".github/workflows/ci.yml": workflow(steps) }))).toEqual([]);
    });

    it("fails a setup-node step that reads an unchecked file", () => {
      const steps = `      - uses: actions/setup-node@${sha} # v7.0.0
        with:
          node-version-file: .node-version
`;
      expect(messages(repo({ ".github/workflows/ci.yml": workflow(steps) }))).toEqual([
        expect.stringMatching(/^\.github\/workflows\/ci\.yml: .*\.node-version/) as unknown,
      ]);
    });

    it("fails a setup-node step that names no version", () => {
      const steps = `      - uses: actions/setup-node@${sha} # v7.0.0\n`;
      expect(messages(repo({ ".github/workflows/ci.yml": workflow(steps) }))).toEqual([
        expect.stringMatching(/^\.github\/workflows\/ci\.yml: .*node-version-file/) as unknown,
      ]);
    });
  });

  describe("OpenTofu", () => {
    it("fails a setup-opentofu step pinned to another version", () => {
      expect(messages(repo({ ".github/workflows/ci.yml": workflow(setupNode + setupTofu("1.13.0")) }))).toEqual([
        expect.stringMatching(/^\.github\/workflows\/ci\.yml: .*1\.13\.0.*1\.13\.1/) as unknown,
      ]);
    });

    it("fails a setup-opentofu step that names no version", () => {
      const steps = `      - uses: opentofu/setup-opentofu@${tofuSha} # v2.0.2\n`;
      expect(messages(repo({ ".github/workflows/ci.yml": workflow(setupNode + steps) }))).toEqual([
        expect.stringMatching(/^\.github\/workflows\/ci\.yml: .*tofu_version/) as unknown,
      ]);
    });

    it.each(["~> 1.13.0", "~> 1.13", ">= 1.13.0, < 1.14.0", "1.13.1", "= 1.13.1", "!= 1.13.0"])(
      "passes required_version %s, which 1.13.1 satisfies",
      (constraint) => {
        expect(checkVersions(repo({ "infra/zone/versions.tf": versionsTf(constraint) }))).toEqual([]);
      },
    );

    it.each(["~> 1.12.0", "~> 1.14", ">= 1.14.0", "< 1.13.1", "> 1.13.1", "<= 1.13.0", "!= 1.13.1"])(
      "fails required_version %s, which 1.13.1 doesn't satisfy",
      (constraint) => {
        expect(messages(repo({ "infra/zone/versions.tf": versionsTf(constraint) }))).toEqual([
          expect.stringMatching(/^infra\/zone\/versions\.tf: .*1\.13\.1/) as unknown,
        ]);
      },
    );

    it("fails a required_version it can't parse", () => {
      expect(messages(repo({ "infra/zone/versions.tf": versionsTf("about 1.13") }))).toEqual([
        expect.stringMatching(/^infra\/zone\/versions\.tf: .*about 1\.13/) as unknown,
      ]);
    });

    it("ignores a .tf file with no required_version", () => {
      expect(checkVersions(repo({ "infra/zone/main.tf": "locals {}\n" }))).toEqual([]);
    });
  });
});
