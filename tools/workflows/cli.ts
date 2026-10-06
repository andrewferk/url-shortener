// Lints every workflow in this repo, including the ops-repo examples' callers.
import { globSync, readFileSync } from "node:fs";
import { lintWorkflow } from "./lint.ts";

const files = [
  ...globSync(".github/workflows/*.{yml,yaml}").map((file) => ({ file, exampleCaller: false })),
  ...globSync("examples/**/.github/workflows/*.{yml,yaml}").map((file) => ({ file, exampleCaller: true })),
];

const problems = files.flatMap(({ file, exampleCaller }) =>
  lintWorkflow(readFileSync(file, "utf8"), { exampleCaller }).map(
    (problem) => `${file}:${String(problem.line)}: ${problem.message}`,
  ),
);
for (const problem of problems) console.error(problem);
console.log(`Linted ${String(files.length)} workflow(s).`);

process.exitCode = problems.length > 0 ? 1 : 0;
