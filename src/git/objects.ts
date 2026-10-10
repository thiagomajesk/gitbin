import type { GitRepo } from "just-git";
import { flattenTree, readCommit } from "just-git/repo";
import { safeStoragePath } from "../core/path-rules";
import type { Registration } from "../core/protocol";
export async function readEntries(repo: GitRepo, revision: string, vault: Registration) {
  const commit = await readCommit(repo, revision);
  const entries = await flattenTree(repo, commit.tree);
  for (const entry of entries) {
    if (!safeStoragePath(entry.path)) throw new Error("Unsafe Git tree path.");
    const relevant =
      entry.path.startsWith(".gitbin/") ||
      entry.path === vault.root ||
      entry.path.startsWith(`${vault.root}/`);
    if (relevant && !["100644", "100755"].includes(entry.mode))
      throw new Error("Unsupported symlink or submodule in sync storage.");
  }
  return new Map(entries.map((entry) => [entry.path, entry.hash]));
}
