// Checks that every copy of the Node and OpenTofu versions in this repo agrees.
import { existsSync, globSync, readFileSync } from "node:fs";
import { checkVersions } from "./check.ts";

const paths = [
  ".tool-versions",
  ".nvmrc",
  "package.json",
  ...globSync("{,examples/**/}.github/workflows/*.{yml,yaml}"),
  ...globSync("infra/**/*.tf", { exclude: ["**/.terraform/**"] }),
];
const files = Object.fromEntries(
  paths.filter((path) => existsSync(path)).map((path) => [path, readFileSync(path, "utf8")]),
);

const problems = checkVersions(files);
for (const problem of problems) console.error(`${problem.file}: ${problem.message}`);
console.log(`Checked the versions in ${String(Object.keys(files).length)} file(s).`);

process.exitCode = problems.length > 0 ? 1 : 0;
