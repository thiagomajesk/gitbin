import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { decisionMutations } from "./proof-mutation-cases.mjs";
import { proofSources } from "./proof-sources.mjs";
import {
  checkToolchain,
  lemmaCli,
  project,
  proverEnvironment,
  run,
  toolsDirectory,
} from "./proof-tools.mjs";

const defaults = {
  boolean: "false",
  number: "0",
  string: '""',
  FileContent: '{ type: "text", value: "" }',
  ChangeKind: '"local"',
  MigrationSequence: '"supported"',
  HistoryValue: "{ checkpoint: [], entries: [] }",
  MetadataValue: "{ consolidationHash: null, appliedMigrations: [] }",
  IssueCopy: '{ title: "", message: "", details: "" }',
};
function optionalResult(type) {
  if (type.includes("| null")) return "null";
  if (type.includes("| undefined")) return "undefined";
  return undefined;
}
function replacement(type) {
  if (type in defaults) return defaults[type];
  const optional = optionalResult(type);
  if (optional) return optional;
  if (type.startsWith('"')) return type.split(" | ")[0];
  throw new Error("Define a type-correct mutation for " + type);
}
function mutants(path, source) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const defaults = ast.statements.filter(ts.isFunctionDeclaration).map((fn) => {
    const annotations = fn.body
      .getText(ast)
      .split("\n")
      .filter((line) => /\/\/@\s*(verify|contract|ensures)\b/.test(line))
      .join("\n");
    const body = "{\n" + annotations + "\n  return " + replacement(fn.type.getText(ast)) + ";\n}";
    return {
      name: fn.name.text,
      source: source.slice(0, fn.body.getStart(ast)) + body + source.slice(fn.body.end),
    };
  });
  if (path !== "src/core/decisions.ts") return defaults;
  return [
    ...defaults,
    ...decisionMutations.map(([name, before, after]) => {
      if (source.split(before).length !== 2) throw new Error("Update mutation fixture: " + name);
      return { name, source: source.replace(before, after) };
    }),
  ];
}
function copySources(directory, sources) {
  for (const path of sources) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(project, path)));
    const artifact = "proofs/" + path.replace(/\.tsx?$/, ".dfy");
    mkdirSync(dirname(join(directory, artifact)), { recursive: true });
    for (const suffix of ["", ".gen"])
      writeFileSync(
        join(directory, artifact + suffix),
        readFileSync(join(project, artifact + suffix)),
      );
  }
  writeFileSync(
    join(directory, "lemmascript.json"),
    readFileSync(join(project, "lemmascript.json")),
  );
}
function rejectMutation(directory, path, mutant) {
  writeFileSync(join(directory, path), mutant.source);
  // Regen preserves checked induction hints while replacing only the generated implementation.
  const result = run(
    process.execPath,
    [lemmaCli, "regen", "--backend=dafny", "--time-limit=30", path],
    { cwd: directory, env: proverEnvironment() },
  );
  writeFileSync(join(directory, "result.log"), result.stdout + result.stderr);
  if (
    result.status === 0 ||
    !/postcondition.*(?:proved|hold)/i.test(result.stdout + result.stderr) ||
    !/finished with \d+ verified, [1-9]\d* errors?/.test(result.stdout)
  )
    throw new Error(
      "Expected a postcondition rejection for " +
        mutant.name +
        ". See " +
        join(directory, "result.log"),
    );
  console.log("Rejected mutation: " + path + "#" + mutant.name);
}
checkToolchain();
const sources = proofSources();
const root = mkdtempSync(join(toolsDirectory, "proof-mutations-"));
const started = performance.now();
let count = 0;
for (const path of sources) {
  const source = readFileSync(join(project, path), "utf8");
  for (const mutant of mutants(path, source)) {
    const directory = join(root, String(count++));
    copySources(directory, sources);
    rejectMutation(directory, path, mutant);
  }
}
console.log(
  "Rejected " +
    count +
    " implementation mutations in " +
    ((performance.now() - started) / 1000).toFixed(2) +
    "s",
);
