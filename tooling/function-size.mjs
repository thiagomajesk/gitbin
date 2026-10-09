/** Count a function's own token-bearing lines, excluding nested function bodies. */
/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    schema: [{ type: "integer", minimum: 1 }],
    messages: {
      size: "Function has {{count}} lines of its own code (maximum {{max}}). Extract a meaningful operation or component.",
    },
  },
  create(context) {
    const stack = [];
    const source = context.sourceCode;
    const max = context.options[0] ?? 60;
    const enter = (node) => {
      stack.at(-1)?.children.push(node);
      stack.push({ node, children: [] });
    };
    const leave = () => {
      const { node, children } = stack.pop();
      if (
        node.parent.type === "CallExpression" &&
        /^describe(?:\.|\(|$)/.test(source.getText(node.parent.callee))
      )
        return;
      const lines = new Set();
      for (const token of source.getTokens(node)) {
        for (let line = token.loc.start.line; line <= token.loc.end.line; line++) {
          if (!children.some((child) => line > child.loc.start.line && line < child.loc.end.line))
            lines.add(line);
        }
      }
      if (lines.size > max)
        context.report({ node, messageId: "size", data: { count: lines.size, max } });
    };
    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": leave,
      FunctionExpression: enter,
      "FunctionExpression:exit": leave,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": leave,
    };
  },
};

export default rule;
