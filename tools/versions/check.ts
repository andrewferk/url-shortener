// Checks that every copy of the Node and OpenTofu versions agrees with
// `.tool-versions`, the one file that pins both:
// - Node: `.nvmrc`, `devEngines.runtime` in package.json, every
//   `actions/setup-node` step, and the major version of `@types/node`.
// - OpenTofu: every `opentofu/setup-opentofu` step, and every
//   `required_version` constraint, which the pinned version must satisfy.
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

export interface Problem {
  readonly file: string;
  readonly message: string;
}

/** The repo's files, by path relative to its root. */
export type Files = Readonly<Record<string, string>>;

const toolVersions = ".tool-versions";
// The files a setup-node step may read its version from: the ones checked here.
const nodeVersionFiles = new Set([".nvmrc", toolVersions, "package.json"]);
const exactVersion = /^\d+\.\d+\.\d+$/;

export function checkVersions(files: Files): Problem[] {
  const problems: Problem[] = [];
  const report = (file: string, message: string) => {
    problems.push({ file, message });
  };

  const pinned = readToolVersions(files[toolVersions] ?? "");
  const node = exactPin(pinned, "nodejs", report);
  const tofu = exactPin(pinned, "opentofu", report);

  const workflows = Object.keys(files).filter((file) => /\.ya?ml$/.test(file));
  const steps = workflows.flatMap((file) => setupSteps(file, files[file] ?? ""));

  if (node) {
    const nvmrc = files[".nvmrc"]?.trim();
    if (nvmrc !== node) {
      report(".nvmrc", `Pins Node ${nvmrc ?? "nothing"}, but ${toolVersions} pins ${node}.`);
    }
    checkPackageJson(files["package.json"] ?? "{}", node, report);
    for (const step of steps.filter((s) => s.action === "actions/setup-node")) {
      const version = step.with["node-version"];
      const file = step.with["node-version-file"];
      if (version !== undefined) {
        if (version !== node) report(step.file, `A setup-node step pins Node ${version}, but ${toolVersions} pins ${node}.`);
      } else if (file === undefined) {
        report(step.file, `A setup-node step names no Node version; give it \`node-version-file: ${toolVersions}\`.`);
      } else if (!nodeVersionFiles.has(file)) {
        report(step.file, `A setup-node step reads \`${file}\`, which isn't checked; read one of ${[...nodeVersionFiles].join(", ")}.`);
      }
    }
  }

  if (tofu) {
    for (const step of steps.filter((s) => s.action === "opentofu/setup-opentofu")) {
      const version = step.with["tofu_version"];
      if (version === undefined) {
        report(step.file, `A setup-opentofu step names no \`tofu_version\`; ${toolVersions} pins ${tofu}.`);
      } else if (version !== tofu) {
        report(step.file, `A setup-opentofu step pins OpenTofu ${version}, but ${toolVersions} pins ${tofu}.`);
      }
    }
    for (const file of Object.keys(files).filter((f) => f.endsWith(".tf"))) {
      for (const [, constraint = ""] of (files[file] ?? "").matchAll(/^\s*required_version\s*=\s*"([^"]*)"/gm)) {
        const satisfied = satisfies(tofu, constraint);
        if (satisfied === undefined) {
          report(file, `Can't parse \`required_version = "${constraint}"\`.`);
        } else if (!satisfied) {
          report(file, `\`required_version = "${constraint}"\` excludes OpenTofu ${tofu}, which ${toolVersions} pins.`);
        }
      }
    }
  }
  return problems;
}

function readToolVersions(source: string): Map<string, string> {
  const pinned = new Map<string, string>();
  for (const line of source.split("\n")) {
    const [tool, version] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (tool && version) pinned.set(tool, version);
  }
  return pinned;
}

function exactPin(pinned: Map<string, string>, tool: string, report: (file: string, message: string) => void): string | undefined {
  const version = pinned.get(tool);
  if (version === undefined) {
    report(toolVersions, `Pin \`${tool}\` to an exact version.`);
  } else if (!exactVersion.test(version)) {
    report(toolVersions, `Pin \`${tool}\` to an exact version, not \`${version}\`.`);
  } else {
    return version;
  }
  return undefined;
}

function checkPackageJson(source: string, node: string, report: (file: string, message: string) => void): void {
  const manifest = JSON.parse(source) as {
    devEngines?: { runtime?: { name?: string; version?: string } };
    devDependencies?: Record<string, string>;
  };
  const runtime = manifest.devEngines?.runtime;
  if (runtime?.name !== "node") {
    report("package.json", `Declare \`devEngines.runtime\` as \`{ "name": "node", "version": "${node}" }\`.`);
  } else if (runtime.version !== node) {
    report("package.json", `\`devEngines.runtime\` pins Node ${runtime.version ?? "nothing"}, but ${toolVersions} pins ${node}.`);
  }
  const types = manifest.devDependencies?.["@types/node"];
  if (types !== undefined && major(types) !== major(node)) {
    report("package.json", `\`@types/node\` ${types} describes another Node major than ${node}.`);
  }
}

interface SetupStep {
  readonly file: string;
  /** The action's repository, without its ref. */
  readonly action: string;
  readonly with: Readonly<Record<string, string | undefined>>;
}

function setupSteps(file: string, source: string): SetupStep[] {
  const root = parseDocument(source).contents;
  const jobs = isMap(root) ? root.get("jobs", true) : undefined;
  if (!isMap(jobs)) return [];
  return jobs.items.flatMap(({ value: job }) => {
    const steps = isMap(job) ? job.get("steps", true) : undefined;
    if (!isSeq(steps)) return [];
    return steps.items.flatMap((step) => {
      if (!isMap(step)) return [];
      const uses = step.get("uses", true);
      if (!isScalar(uses)) return [];
      const inputs: unknown = step.get("with");
      return [{
        file,
        action: String(uses.value).replace(/@.*/, ""),
        with: isMap(inputs) ? stringInputs(inputs.toJSON() as Record<string, unknown>) : {},
      }];
    });
  });
}

function stringInputs(inputs: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value)]));
}

function major(version: string): string {
  return /\d+/.exec(version)?.[0] ?? version;
}

/**
 * Whether `version` meets an OpenTofu version constraint: comma-separated
 * conditions, each `=`, `!=`, `>`, `>=`, `<`, `<=` or `~>` and a version, or
 * undefined if it can't be parsed.
 */
function satisfies(version: string, constraint: string): boolean | undefined {
  const target = parts(version);
  const conditions = constraint.split(",").map((condition) => /^\s*(=|!=|>=|<=|>|<|~>)?\s*(\d+(?:\.\d+){0,2})\s*$/.exec(condition));
  if (!target || conditions.some((condition) => !condition)) return undefined;
  return conditions.every((condition) => {
    const [, operator = "=", bound = ""] = condition ?? [];
    const boundParts = parts(bound) ?? [];
    const order = compare(target, boundParts);
    switch (operator) {
      case "=": return order === 0;
      case "!=": return order !== 0;
      case ">": return order > 0;
      case ">=": return order >= 0;
      case "<": return order < 0;
      case "<=": return order <= 0;
      default: {
        // `~>` lets only the rightmost given part grow: `~> 1.13.0` means
        // >= 1.13.0 and < 1.14.0; `~> 1.13` means >= 1.13 and < 2.0.
        const fixed = bound.split(".").length - 1;
        return order >= 0 && target.slice(0, fixed).every((part, index) => part === boundParts[index]);
      }
    }
  });
}

function parts(version: string): number[] | undefined {
  if (!/^\d+(?:\.\d+){0,2}$/.test(version)) return undefined;
  const numbers = version.split(".").map(Number);
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
