import config from "../eslint.config.mjs";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

const linter = new ESLint({ overrideConfigFile: true, overrideConfig: config });
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
