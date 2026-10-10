import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";

export const toolchain = JSON.parse(
  readFileSync(new URL("./proof-toolchain.json", import.meta.url), "utf8"),
);
export const project = resolve(import.meta.dirname, "..");
export const toolsDirectory = resolve(project, ".tools");
export const lemmaDirectory = resolve(toolsDirectory, "LemmaScript-" + toolchain.lemma.revision);
export const lemmaCli = resolve(lemmaDirectory, "tools/dist/lsc.js");
const dafny = resolve(
  toolsDirectory,
  "dafny",
  process.platform === "win32" ? "dafny.exe" : "dafny",
);

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: project,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}
export function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return result.stdout;
}
export function proverEnvironment() {
  const env = { ...process.env };
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  env[key] = resolve(toolsDirectory, "dafny") + delimiter + (env[key] ?? "");
  return env;
}
export function checkToolchain() {
  const stamp = JSON.parse(readFileSync(resolve(toolsDirectory, "proof-toolchain.json"), "utf8"));
  if (JSON.stringify(stamp) !== JSON.stringify(toolchain))
    throw new Error("Run pnpm proof:setup to install the pinned toolchain.");
  if (!mustRun(dafny, ["--version"]).startsWith(toolchain.dafny.version + "+"))
    throw new Error("Unexpected Dafny version.");
}
