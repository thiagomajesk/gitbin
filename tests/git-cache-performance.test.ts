import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommit, flattenTree, readBlobText, readCommit } from "just-git/repo";
import { expect, it } from "vitest";
import { gitSession } from "../src/git/session";
import { gitCache } from "../src/platform/git-cache";
import { diskAdapter } from "./disk-adapter";

it("reuses immutable Git objects without repeated disk reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gitbin-cache-profile-"));
  let reads = 0;
  const adapter = diskAdapter(directory, () => {
    reads++;
  });

  const fs = gitCache(adapter, ".obsidian/plugins/gitbin/local/profile/git");
  const connection = {
    fs,
    url: "https://git.example.com/repository.git",
    credentials: () => null,
    identity: { author: { name: "test", email: "test@desktop" }, device: "desktop" },
    network: false,
  };
  const session = gitSession({
    ...connection,
    network: {
      fetch: async () => {
        throw new Error("Unexpected network request");
      },
    },
  });
  const repo = await session.repo();
  const files = Object.fromEntries(
    Array.from({ length: 190 }, (_, index) => [
      `Guide-${index}.md`,
      `# Guide ${index}\n\n${"Explanation of the example.\n".repeat(100)}`,
    ]),
  );
  files["Large.md"] = "# Large document\n" + "A larger example with details.\n".repeat(50000);
  const commit = await buildCommit(repo, {
    files,
    branch: "main",
    message: "profile fixture",
    author: connection.identity.author,
  });
  const entries = await flattenTree(repo, (await readCommit(repo, commit.hash)).tree);
  reads = 0;
  const started = performance.now();
  for (let pass = 0; pass < 3; pass++)
    for (const entry of entries.values())
      expect((await readBlobText(repo, entry.hash)).length).toBeGreaterThan(0);
  const measurement = {
    elapsedMs: performance.now() - started,
    objectReads: reads,
    files: entries.length,
    passes: 3,
  };
  await writeFile(join(directory, "profile.json"), JSON.stringify(measurement));
  expect(measurement.objectReads).toBe(0);
  const target = "/repo/.git/objects/aa/" + "b".repeat(38);
  await fs.mkdir("/repo/.git/objects/aa", { recursive: true });
  await fs.writeFile(target, new Uint8Array([1, 2, 3]));
  const returned = await fs.readFileBuffer(target);
  returned[0] = 99;
  expect(await fs.readFileBuffer(target)).toEqual(new Uint8Array([1, 2, 3]));
}, 60000);
