import { contentFromBytes, contentBytes, type FileContent } from "../core/content";
import { readBlob, readCommit, flattenTree, buildCommit } from "just-git/repo";
import type { GitRepo } from "just-git";
import type { Connection } from "./session";
import type { Publication, RemoteSnapshot } from "../core/ports";
import { type Registration, validateVaults, validPath } from "../core/protocol";
export async function readEntries(repo: GitRepo, revision: string, vault: Registration) {
  const commit = await readCommit(repo, revision);
  const entries = await flattenTree(repo, commit.tree);
  for (const entry of entries) {
    if (
      entry.path
        .split("/")
        .some((part) => !part || part === "." || part === ".." || part.includes("\\"))
    )
      throw new Error("Unsafe Git tree path.");
    const relevant =
      entry.path.startsWith(".gitbin/") ||
      entry.path === vault.root ||
      entry.path.startsWith(`${vault.root}/`);
    if (relevant && !["100644", "100755"].includes(entry.mode))
      throw new Error("Unsupported symlink or submodule in sync storage.");
  }
  return new Map(entries.map((entry) => [entry.path, entry.hash]));
}
export async function readFiles(
  repo: GitRepo,
  entries: ReadonlyMap<string, string>,
  vault: Registration,
  hydrate: (hashes: readonly string[]) => Promise<unknown>,
) {
  const states = new Map<string, Uint8Array>();
  const files = new Map<string, FileContent>();
  const stateHashes = new Map<string, string>();
  const fileHashes = new Map<string, string>();
  const prefix = `.gitbin/vaults/${vault.root}/`;
  for (const [path, hash] of entries) {
    if (path.startsWith(prefix)) {
      const name = path.slice(prefix.length);
      if (!/^[a-f0-9-]{36}\.bin$/.test(name)) throw new Error("Unsupported CRDT storage entry.");
      stateHashes.set(name.slice(0, -4), hash);
    } else if (path.startsWith(`${vault.root}/`)) {
      const relative = path.slice(vault.root.length + 1);
      if (!relative.split("/").some((part) => part.startsWith("."))) fileHashes.set(relative, hash);
    }
  }
  await hydrate([...stateHashes.values(), ...fileHashes.values()]);
  for (const [id, hash] of stateHashes) states.set(id, await readBlob(repo, hash));
  for (const [path, hash] of fileHashes)
    files.set(path, contentFromBytes(path, await readBlob(repo, hash)));
  return { states, files };
}
export async function candidate(
  repo: GitRepo,
  base: RemoteSnapshot,
  publication: Publication,
  identity: Connection["identity"],
): Promise<string> {
  validateVaults([publication.vault]);
  const files: Record<string, string | Uint8Array | null> = Object.create(null);
  for (const [id, bytes] of publication.states) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid file ID.");
    files[`.gitbin/vaults/${publication.vault.root}/${id}.bin`] = bytes;
  }
  for (const [path, text] of publication.files) {
    if (!validPath(path)) throw new Error("Unsafe file path.");
    files[`${publication.vault.root}/${path}`] = contentBytes(text);
  }
  for (const path of base.files.keys())
    if (!publication.files.has(path)) files[`${publication.vault.root}/${path}`] = null;
  if (base.revision) await repo.refStore.writeRef("refs/heads/main", base.revision);
  else await repo.refStore.deleteRef("refs/heads/main");
  const built = await buildCommit(repo, {
    files,
    branch: "main",
    message: "gitbin: sync `" + publication.vault.name + "` from `" + identity.device + "`\n",
    author: identity.author,
    committer: { name: "Gitbin", email: `gitbin@${identity.device}` },
  });
  if (
    base.revision &&
    (await readCommit(repo, built.hash)).tree === (await readCommit(repo, base.revision)).tree
  )
    return base.revision;
  return built.hash;
}
