// Type-checks every tsconfig.json in the repo, so a new workspace or test
// directory is checked without editing a list.
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const projects = globSync("**/tsconfig.json", {
  exclude: (path) => path.includes("node_modules"),
}).sort();

let failed = false;
for (const project of projects) {
  console.log(`tsc -p ${project}`);
  const result = spawnSync("tsc", ["-p", project], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

process.exitCode = failed ? 1 : 0;
