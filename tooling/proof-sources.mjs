import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { project } from "./proof-tools.mjs";
export function proofSources() {
  return readdirSync(join(project, "src"), { recursive: true })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => "src/" + path.replaceAll("\\", "/"))
    .filter((path) => /\/\/@\s*verify\b/.test(readFileSync(join(project, path), "utf8")))
    .sort();
}
