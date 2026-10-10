import type { GitRepo } from "just-git";
import { readCommit, readTree } from "just-git/repo";
import type { RemoteSnapshot } from "../core/ports";
import type { Registration } from "../core/protocol";
export interface VaultStatus {
  readonly vault: Registration;
  readonly latest: string | null;
  readonly applied: string | null;
  readonly changed: boolean | null;
  readonly connected: boolean;
}
async function subtree(repo: GitRepo, tree: string, path: string): Promise<string | null> {
  let hash = tree;
  for (const segment of path.split("/")) {
    const entry = (await readTree(repo, hash)).find((item) => item.name === segment);
    if (!entry) return null;
    if (entry.mode !== "040000" && entry.mode !== "40000")
      throw new Error("Invalid vault directory.");
    hash = entry.hash;
  }
  return hash;
}
async function vaultTrees(repo: GitRepo, revision: string, root: string): Promise<string> {
  const tree = (await readCommit(repo, revision)).tree;
  const hashes = await Promise.all([
    subtree(repo, tree, root),
    subtree(repo, tree, ".gitbin/vaults/" + root),
  ]);
  return JSON.stringify(hashes);
}
export async function inspectVaults(
  repo: GitRepo,
  snapshot: RemoteSnapshot,
  root: string,
  checkpoint: string | null,
): Promise<ReadonlyArray<VaultStatus>> {
  if (!snapshot.revision) return [];
  const revision = snapshot.revision;
  let changed: boolean | null = null;
  if (checkpoint === revision) changed = false;
  else if (checkpoint && (await repo.objectStore.exists(checkpoint))) {
    const [before, after] = await Promise.all([
      vaultTrees(repo, checkpoint, root),
      vaultTrees(repo, revision, root),
    ]);
    changed = before !== after;
  }
  return snapshot.vaults.map((vault) => ({
    vault,
    latest: revision,
    applied: vault.root === root ? checkpoint : null,
    changed: vault.root === root ? changed : null,
    connected: vault.root === root,
  }));
}
