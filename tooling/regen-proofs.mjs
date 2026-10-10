import { proofSources } from "./proof-sources.mjs";
import { checkToolchain, lemmaCli, mustRun, proverEnvironment } from "./proof-tools.mjs";

checkToolchain();
for (const source of proofSources())
  console.log(
    mustRun(process.execPath, [lemmaCli, "regen", "--backend=dafny", "--time-limit=30", source], {
      env: proverEnvironment(),
    }),
  );
