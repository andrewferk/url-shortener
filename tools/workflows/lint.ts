// Checks a GitHub Actions workflow against this repo's rules:
// - it declares a top-level `permissions:` block that grants nothing but read
//   (ADR 0025). An explicit block overrides the repo's default, and anything
//   unlisted becomes none. A job that needs write is granted it on that job.
// - no job is granted `read-all` or `write-all`.
// - every action and reusable workflow from another repo is pinned by a full
//   commit SHA, and every Docker action by digest.
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";

export interface Problem {
  readonly line: number;
  readonly message: string;
}

const pinnedBySha = /^[^@\s]+@[0-9a-f]{40}$/;
const pinnedByDigest = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

export function lintWorkflow(source: string): Problem[] {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });
  const lineOf = (node: Node | null | undefined): number =>
    node?.range ? lineCounter.linePos(node.range[0]).line : 1;

  const [error] = document.errors;
  if (error) {
    return [{ line: error.linePos?.[0].line ?? 1, message: `Invalid YAML: ${error.message}` }];
  }
  const root = document.contents;
  if (!isMap(root)) {
    return [{ line: lineOf(root), message: "A workflow must be a YAML mapping." }];
  }

  const problems: Problem[] = [];
  const report = (node: Node | null | undefined, message: string) => {
    problems.push({ line: lineOf(node), message });
  };

  const permissions: unknown = root.get("permissions", true);
  if (permissions === undefined) {
    report(root, "Declare a top-level `permissions:` block granting only what the workflow needs (ADR 0025).");
  } else if (isScalar(permissions)) {
    report(permissions, `Top-level \`permissions: ${String(permissions.value)}\` grants every scope; list each scope instead (ADR 0025).`);
  } else if (isMap(permissions)) {
    for (const pair of permissions.items) {
      if (isScalar(pair.value) && pair.value.value === "write") {
        const scope = isScalar(pair.key) ? String(pair.key.value) : "?";
        report(pair.key as Node, `Top-level \`${scope}: write\` grants write to every job; grant it on the job that needs it.`);
      }
    }
  }

  const jobs = root.get("jobs", true);
  if (!isMap(jobs)) return problems;
  for (const { value: job } of jobs.items) {
    if (!isMap(job)) continue;

    const jobPermissions = job.get("permissions", true);
    if (isScalar(jobPermissions) && /^(?:read|write)-all$/.test(String(jobPermissions.value))) {
      report(jobPermissions, `\`permissions: ${String(jobPermissions.value)}\` grants every scope; list each scope the job needs.`);
    }

    checkPin(job.get("uses", true), report);
    const steps = job.get("steps", true);
    if (!isSeq(steps)) continue;
    for (const step of steps.items) {
      if (isMap(step)) checkPin(step.get("uses", true), report);
    }
  }
  return problems;
}

function checkPin(uses: unknown, report: (node: Node, message: string) => void): void {
  if (!isScalar(uses)) return;
  const ref = String(uses.value);
  if (ref.startsWith("./")) return;
  if (ref.startsWith("docker://")) {
    if (!pinnedByDigest.test(ref)) report(uses, `Pin \`${ref}\` by its image digest (\`@sha256:...\`).`);
  } else if (!pinnedBySha.test(ref)) {
    report(uses, `Pin \`${ref}\` by a full commit SHA, with its version in a comment.`);
  }
}
