import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { project } from "./proof-tools.mjs";

export function sourceInventory(root) {
  return readdirSync(join(root, "src"), { recursive: true })
    .filter((path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts"))
    .sort()
    .map((path) => inspectSource(root, "src/" + path.replaceAll("\\", "/")));
}
function inspectSource(root, path) {
  const source = readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const functions = [];
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body)
      functions.push({
        name: node.name?.getText(ast) ?? "<callback>",
        line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const verified = ast.statements
    .filter(ts.isFunctionDeclaration)
    .filter((fn) => /\/\/@\s*verify\b/.test(fn.body?.getFullText(ast) ?? ""))
    .map((fn) => fn.name.text);
  return { path, digest: createHash("sha256").update(source).digest("hex"), functions, verified };
}
export function validateCoverage(inventory, reviewed) {
  if (
    inventory
      .map((file) => file.path)
      .sort()
      .join() !== Object.keys(reviewed).sort().join()
  )
    throw new Error("Production files changed: review formal-verification coverage.");
  for (const file of inventory) {
    const record = reviewed[file.path];
    if (record.digest !== file.digest)
      throw new Error("Review changed proof coverage: " + file.path);
    if (record.verified.join() !== file.verified.join())
      throw new Error("Proof contracts changed: " + file.path);
    if (!file.verified.length && !record.boundary?.trim())
      throw new Error("Missing proof boundary: " + file.path);
  }
}
export function checkCoverage() {
  const inventory = sourceInventory(project);
  const reviewed = JSON.parse(readFileSync(join(project, "tooling/proof-scope.json"), "utf8"));
  validateCoverage(inventory, reviewed);
  const count = inventory.reduce((sum, file) => sum + file.verified.length, 0);
  console.log(
    "Reviewed " +
      inventory.length +
      " production files; " +
      count +
      " verified functions; remaining files have explicit boundary assessments.",
  );
  return inventory;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) checkCoverage();
