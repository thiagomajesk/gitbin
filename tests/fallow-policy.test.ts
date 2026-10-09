import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

it("the real Fallow policy rejects runtime execution in source but allows the application boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gitbin-policy-"));
  try {
    const config: unknown = JSON.parse(await readFile(".fallowrc.json", "utf8"));
    await writeFile(join(directory, ".fallowrc.json"), JSON.stringify(config));
    await writeFile(join(directory, "package.json"), '{"name":"policy-fixture","type":"module"}');
    await mkdir(join(directory, "src/core"), { recursive: true });
    await writeFile(join(directory, "src/main.ts"), 'import "./core/fixture";');
    const code = "const Effect = { runPromise: () => 1 }; Effect.runPromise();";
    await writeFile(join(directory, "src/core/fixture.ts"), code);
    const binary = createRequire(import.meta.url).resolve("fallow/bin/fallow");
    const run = () =>
      spawnSync(
        process.execPath,
        [binary, "dead-code", "--root", directory, "--format", "json", "--no-cache"],
        { encoding: "utf8", windowsHide: true },
      );
    const rejected = run();
    expect(rejected.status).toBe(1);
    expect(rejected.stdout).toContain("Effect.runPromise");
    await writeFile(join(directory, "src/core/fixture.ts"), "");
    await writeFile(join(directory, "src/main.ts"), 'import "./core/fixture";' + code);
    const accepted = run();
    expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
