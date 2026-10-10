import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateContracts } from "../tooling/proof-contracts.mjs";

const source = readFileSync("src/core/decisions.ts", "utf8");
const proof = readFileSync("proofs/src/core/decisions.dfy", "utf8");
const generated = readFileSync("proofs/src/core/decisions.dfy.gen", "utf8");
it("requires the reviewed production scope and its automatic proof artifacts", () => {
  expect(() => validateContracts(source, generated, proof)).not.toThrow();
});
it("rejects removing a verification marker", () => {
  expect(() => validateContracts(source.replace("//@ verify", ""), generated, proof)).toThrow(
    "Missing proof contract",
  );
});
it("rejects narrowing a contract to an impossible input domain", () => {
  expect(() =>
    validateContracts(
      source.replace("//@ verify", "//@ verify\n//@ requires false"),
      generated,
      proof,
    ),
  ).toThrow("restricted domain");
});
it("rejects removing the generated proof bodies", () => {
  expect(() => validateContracts(source, "", "")).toThrow("Missing generated function");
});
it("rejects injecting assumed conclusions into a proof", () => {
  const changed = proof + "\nlemma bypass() { assume false; }\n";
  expect(() => validateContracts(source, changed, changed)).toThrow("unchecked assumption");
});
it("rejects unchecked additions even when generated code is preserved", () => {
  expect(() =>
    validateContracts(source, generated, proof + "\nlemma bypass() ensures false\n"),
  ).toThrow("without handwritten additions");
});
