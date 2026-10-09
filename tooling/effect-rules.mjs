import ts from "typescript";

function isEffect(type) {
  if (type.isUnion()) return type.types.every(isEffect);
  return !!type.getProperty("~effect/Effect");
}
function isLayer(type) {
  return !!type.getProperty("~effect/Layer");
}
function signatureProblems(checker, type, path, allowed, seen = new Set()) {
  if (accepted(type, path, allowed, seen)) return [];
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    return element
      ? signatureProblems(checker, element, path + "[]", allowed, new Set([...seen, type]))
      : [];
  }
  if (seen.size > 8) return [path];
  seen.add(type);
  const constructors = type.getConstructSignatures();
  if (constructors.length)
    return constructors.flatMap((signature) =>
      signatureProblems(
        checker,
        checker.getReturnTypeOfSignature(signature),
        path,
        allowed,
        new Set(seen),
      ),
    );
  const signatures = type.getCallSignatures();
  if (signatures.length) {
    return signatures.flatMap((signature) => {
      const result = checker.getReturnTypeOfSignature(signature);
      if (isEffect(result) || isLayer(result)) return [];
      const members = result.getProperties().filter((member) => {
        const declaration = member.valueDeclaration ?? member.declarations?.[0];
        return (
          declaration &&
          checker.getTypeOfSymbolAtLocation(member, declaration).getCallSignatures().length
        );
      });
      // Factories may return services, but every operation must obey the contract.
      if (
        result.flags & ts.TypeFlags.Object &&
        members.length &&
        !result.getProperty("then") &&
        !checker.isArrayType(result)
      )
        return signatureProblems(checker, result, path, allowed, new Set(seen));
      return [path];
    });
  }
  return type.getProperties().flatMap((member) => {
    const declaration = member.valueDeclaration ?? member.declarations?.[0];
    if (
      !declaration ||
      ts.getCombinedModifierFlags(declaration) &
        (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
    )
      return [];
    const value = checker.getTypeOfSymbolAtLocation(member, declaration);
    if (!(value.flags & ts.TypeFlags.Object)) return [];
    if (declaration.getSourceFile().isDeclarationFile) return [];
    return signatureProblems(checker, value, `${path}.${member.name}`, allowed, new Set(seen));
  });
}
/** @type {import("eslint").Rule.RuleModule} */
const effectExports = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { allow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      operation:
        "{{name}} must return an Effect. Keep pure helpers outside service contracts and execute Effects only at the application boundary.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program) throw new Error("effect-exports requires TypeScript parser services.");
    const checker = services.program.getTypeChecker();
    const allowed = new Set(context.options[0]?.allow ?? []);
    return {
      "Program:exit"(node) {
        const source = services.esTreeNodeToTSNodeMap.get(node);
        const module = checker.getSymbolAtLocation(source);
        if (!module) return;
        for (const exported of checker.getExportsOfModule(module)) {
          const value = exportedValue(checker, exported);
          if (!value) continue;
          const { type, declaration } = value;
          for (const name of signatureProblems(checker, type, exported.name, allowed)) {
            context.report({
              node: services.tsNodeToESTreeNodeMap.get(declaration) ?? node,
              messageId: "operation",
              data: { name },
            });
          }
        }
      },
    };
  },
};
export default { rules: { "effect-exports": effectExports } };

function accepted(type, path, allowed, seen) {
  return allowed.has(path) || isEffect(type) || isLayer(type) || seen.has(type);
}
function exportedValue(checker, exported) {
  const symbol =
    exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  if (!(symbol.flags & ts.SymbolFlags.Value)) return null;
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return declaration
    ? { declaration, type: checker.getTypeOfSymbolAtLocation(symbol, declaration) }
    : null;
}
