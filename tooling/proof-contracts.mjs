import ts from "typescript";

export function validateContracts(source, generated, proof, allowAdditions = false) {
  const ast = ts.createSourceFile("decisions.ts", source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(ts.isFunctionDeclaration);
  if (functions.length === 0) throw new Error("Missing verified production functions.");
  for (const fn of functions) checkFunction(fn, ast, generated);
  if (/\/\/@\s*(assume|havoc|extern|skip|requires|backend|option)\b/.test(source))
    throw new Error("Proof escape or restricted domain in verified source.");
  if (proof !== generated && !allowAdditions)
    throw new Error(
      "This proof scope requires automatic proofs without handwritten additions; regenerate after changing the source.",
    );
  const code = proof.replace(/\/\/[^\n]*/g, "");
  if (/\bassume\b|\{:\s*(axiom|extern|verify|only|focus)\b/.test(code))
    throw new Error("Proof contains an unchecked assumption or verification bypass.");
  return functions.length;
}
function checkFunction(fn, ast, generated) {
  const body = fn.body?.getFullText(ast) ?? "";
  if (!body.includes("//@ verify") || !body.includes("//@ ensures"))
    throw new Error("Missing proof contract: " + fn.name?.text);
  const declaration = new RegExp("(?:function|method) " + fn.name?.text + "\\(");
  if (!declaration.test(generated)) throw new Error("Missing generated function: " + fn.name?.text);
}
