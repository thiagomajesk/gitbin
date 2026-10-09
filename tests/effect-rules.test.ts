import { ESLint } from "eslint";
import { expect, it } from "vitest";
import effectRules from "../tooling/effect-rules.mjs";

const linter = new ESLint();
async function contractErrors(code: string) {
  const [result] = await linter.lintText(code, { filePath: "src/git/consolidation.ts" });
  return result?.messages.filter((message) => message.ruleId === "gitbin/effect-exports") ?? [];
}
it("accepts inferred and aliased Effects and service factories", async () => {
  expect(
    await contractErrors(`
    import { Effect as E } from "effect";
    export const read = () => E.succeed(1);
    export const service = () => ({ read });
    export class Repository { private calculate() { return 1; } read() { return E.succeed(this.calculate()); } }
  `),
  ).toEqual([]);
});
it.each([
  "export async function save() { return 1; }",
  "export const service = () => ({ save: async () => 1 });",
  "export const service = () => ({ save: () => 1 });",
  "export const service = () => ({ read: () => Effect.void, nested: { save: async () => 1 } });",
  "export const read = (flag: boolean) => flag ? Effect.void : Promise.resolve();",
  "export const read = (): any => Effect.void;",
  "export class Repository { save() { return Promise.resolve(); } }",
  "const hidden = async () => 1; export { hidden as save };",
  "export const migrations = [{ inspect: () => true }];",
])("rejects operations that escape the Effect contract: %s", async (code) => {
  const errors = await contractErrors('import { Effect } from "effect";\n' + code);
  expect(errors.length).toBeGreaterThan(0);
});

it("rejects long function bodies without counting comments or nested callbacks twice", async () => {
  const sizeLinter = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      plugins: { gitbin: effectRules },
      rules: { "gitbin/function-size": ["error", 6] },
    },
  });
  const errors = async (code: string) => {
    const [result] = await sizeLinter.lintText(code, { filePath: "fixture.mjs" });
    return result?.messages ?? [];
  };
  expect(
    await errors(`function work() {\nlet a = 1;\na++;\na++;\na++;\na++;\nreturn a;\n}`),
  ).toHaveLength(1);
  expect(
    await errors(
      `function suite() {\nfunction first() {\nreturn 1;\n}\nfunction second() {\nreturn 2;\n}\n}`,
    ),
  ).toEqual([]);
  expect(await errors(`function work() {\n// comment\n\nreturn 1;\n}`)).toEqual([]);
});
