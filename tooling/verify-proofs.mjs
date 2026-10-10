import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateContracts } from "./proof-contracts.mjs";
import { checkCoverage } from "./proof-coverage.mjs";
import { proofSources } from "./proof-sources.mjs";
import { checkToolchain, lemmaCli, project, proverEnvironment, run } from "./proof-tools.mjs";

checkCoverage();
checkToolchain();
const started = performance.now();
let count = 0;
for (const sourcePath of proofSources()) {
  const artifact = "proofs/" + sourcePath.replace(/\.tsx?$/, ".dfy");
  const functions = validateContracts(
    readFileSync(resolve(project, sourcePath), "utf8"),
    readFileSync(resolve(project, artifact + ".gen"), "utf8"),
    readFileSync(resolve(project, artifact), "utf8"),
    // This file needs a proved induction lemma; lsc still enforces additions-only and verifies it.
    sourcePath === "src/core/order-decisions.ts",
  );
  const result = run(
    process.execPath,
    [lemmaCli, "check", "--backend=dafny", "--time-limit=30", sourcePath],
    { env: proverEnvironment() },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  const summary = /finished with ([1-9]\d*) verified, 0 errors/.exec(result.stdout);
  if (result.status !== 0 || !summary || Number(summary[1]) < functions) process.exit(1);
  count += functions;
}
if (!count) throw new Error("No production proofs found.");
console.log(
  "Verified " +
    count +
    " production contracts in " +
    ((performance.now() - started) / 1000).toFixed(2) +
    "s",
);
