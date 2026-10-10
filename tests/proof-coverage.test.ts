import { expect, it } from "vitest";
import { validateCoverage } from "../tooling/proof-coverage.mjs";

const inventory = [{ path: "src/sample.ts", digest: "reviewed", verified: ["decision"] }];
const reviewed = { "src/sample.ts": { digest: "reviewed", verified: ["decision"] } };
it("rejects new production files that have not been assessed", () => {
  expect(() =>
    validateCoverage([...inventory, { path: "src/new.ts", digest: "new", verified: [] }], reviewed),
  ).toThrow("Production files changed");
});
it("rejects an unreviewed implementation change", () => {
  expect(() => validateCoverage([{ ...inventory[0], digest: "changed" }], reviewed)).toThrow(
    "Review changed proof coverage",
  );
});
it("rejects silently dropping a proof contract", () => {
  expect(() => validateCoverage([{ ...inventory[0], verified: [] }], reviewed)).toThrow(
    "Proof contracts changed",
  );
});
it("requires an explicit assessment for code outside formal verification", () => {
  expect(() =>
    validateCoverage([{ path: "src/sample.ts", digest: "reviewed", verified: [] }], {
      "src/sample.ts": { digest: "reviewed", verified: [] },
    }),
  ).toThrow("Missing proof boundary");
});
it("accepts the exact reviewed scope", () => {
  expect(() => validateCoverage(inventory, reviewed)).not.toThrow();
});
