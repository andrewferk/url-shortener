// Lints every workflow in this repo, including the ops-repo examples' callers.
import { globSync, readFileSync } from "node:fs";
import { lintWorkflow } from "./lint.ts";

const files = globSync([
  ".github/workflows/*.{yml,yaml}",
  "examples/**/.github/workflows/*.{yml,yaml}",
]).sort();

let failed = false;
for (const file of files) {
  for (const problem of lintWorkflow(readFileSync(file, "utf8"))) {
    console.error(`${file}:${String(problem.line)}: ${problem.message}`);
    failed = true;
  }
}
console.log(`Linted ${String(files.length)} workflow(s).`);

process.exitCode = failed ? 1 : 0;
