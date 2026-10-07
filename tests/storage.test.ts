import { expect, it } from "vitest";
import { buildCommit } from "just-git/repo";
import { gitSession } from "../src/git/session";
import { readEntries } from "../src/git/objects";
import { discoverVaults } from "../src/git/vaults";

async function discover(files: Record<string, string>) {
  const session = gitSession({
    url: "https://git.example.com/notes.git",
    credentials: () => null,
    identity: { author: { name: "test", email: "test@desktop" }, device: "desktop" },
    network: {
      fetch: async () => {
        throw new Error("Unexpected network request");
      },
    },
  });
  const repo = await session.repo();
  const commit = await buildCommit(repo, {
    files,
    branch: "main",
    message: "storage fixture",
    author: { name: "test", email: "test@example.com" },
  });
  const entries = await readEntries(repo, commit.hash, { root: "My Vault", name: "My Vault" });
  return discoverVaults(entries);
}
it("discovers vaults from their CRDT files without a registry", async () => {
  expect(
    await discover({
      ".gitbin/vaults/My Vault/00000000-0000-4000-8000-000000000001.bin": "",
      ".gitbin/vaults/Work/00000000-0000-4000-8000-000000000001.bin": "",
    }),
  ).toEqual([
    { root: "My Vault", name: "My Vault" },
    { root: "Work", name: "Work" },
  ]);
});
it("rejects unknown metadata instead of interpreting old formats", async () => {
  await expect(discover({ ".gitbin/old-registry.json": "{}" })).rejects.toThrow(
    "Invalid Gitbin storage path",
  );
});
it("rejects placeholder metadata instead of retaining compatibility", async () => {
  await expect(discover({ ".gitbin/vaults/My Vault/.keep": "" })).rejects.toThrow(
    "Invalid Gitbin storage path",
  );
});
it("rejects case-insensitive vault collisions", async () => {
  await expect(
    discover({
      ".gitbin/vaults/Work/00000000-0000-4000-8000-000000000001.bin": "",
      ".gitbin/vaults/work/00000000-0000-4000-8000-000000000001.bin": "",
    }),
  ).rejects.toThrow("distinct");
});
