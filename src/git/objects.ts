import type { GitRepo } from "just-git";
import { buildCommit, flattenTree, readBlob, readCommit } from "just-git/repo";
import { binaryObject, blobId } from "../core/blobs";
import { contentBytes, contentFromBytes, type FileContent } from "../core/content";
import { currentMetadata, metadataPath, requireCurrentMetadata } from "../core/metadata";
import type { Publication, RemoteSnapshot } from "../core/ports";
import { validateRemote } from "../core/projection";
import { type Registration, validateVaults, validPath } from "../core/protocol";
import { parseStoredData } from "../core/storage-format";
import { statePath } from "../core/storage-layout";
import type { Connection } from "./session";
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
function validateBlobEntry(id: string, hash: string, hasFormat: boolean): void {
  if (!hasFormat || !/^[a-f0-9]{40}$/.test(id) || id !== hash)
    throw new Error("Invalid binary storage entry.");
}
function partitionEntries(
  entries: ReadonlyMap<string, string>,
  vault: Registration,
  hasFormat: boolean,
) {
  const blobHashes = new Map<string, string>();
  const blobPrefix = ".gitbin/vaults/" + vault.root + "/retained/";
  const stateHashes = new Map<string, string>();
  const fileHashes = new Map<string, string>();
  const prefix = `.gitbin/vaults/${vault.root}/`;
  for (const [path, hash] of entries) {
    if (path.startsWith(blobPrefix)) {
      const id = path.slice(blobPrefix.length);
      validateBlobEntry(id, hash, hasFormat);
      blobHashes.set(id, hash);
    } else if (path.startsWith(prefix)) {
      const name = path.slice(prefix.length).replace(/^(notes|attachments)\//, "");
      if (!/^(notes|attachments)\//.test(path.slice(prefix.length)))
        throw new Error("Unsupported state folder.");
      if (!/^[a-f0-9-]{36}\.bin$/.test(name)) throw new Error("Unsupported CRDT storage entry.");
      stateHashes.set(name.slice(0, -4), hash);
    } else if (path.startsWith(`${vault.root}/`)) {
      const relative = path.slice(vault.root.length + 1);
      if (!relative.split("/").some((part) => part.startsWith("."))) fileHashes.set(relative, hash);
    }
  }
  return { blobHashes, stateHashes, fileHashes };
}
export async function readFiles(
  repo: GitRepo,
  entries: ReadonlyMap<string, string>,
  vault: Registration,
  hydrate: (hashes: readonly string[]) => Promise<unknown>,
) {
  const metadataHash = entries.get(metadataPath);
  let metadata = currentMetadata();
  if (metadataHash) {
    await hydrate([metadataHash]);
    metadata = requireCurrentMetadata(
      parseStoredData(new TextDecoder().decode(await readBlob(repo, metadataHash))),
    );
  } else if (entries.size > 0) {
    requireCurrentMetadata(undefined);
  }
  const blobs = new Map<string, FileContent>();
  const { blobHashes, stateHashes, fileHashes } = partitionEntries(entries, vault, !!metadataHash);
  const states = new Map<string, Uint8Array>();
  const files = new Map<string, FileContent>();
  await hydrate([
    ...new Set([...stateHashes.values(), ...fileHashes.values(), ...blobHashes.values()]),
  ]);
  for (const [id, hash] of blobHashes) blobs.set(id, binaryObject(id, await readBlob(repo, hash)));
  for (const [id, hash] of stateHashes) states.set(id, await readBlob(repo, hash));
  for (const [path, hash] of fileHashes) {
    const bytes = await readBlob(repo, hash);
    files.set(path, contentFromBytes(path, bytes));
    blobs.set(hash, binaryObject(hash, bytes));
  }
  return { states, files, blobs, consolidationHash: metadata.consolidationHash };
}
function binaryChanges(base: RemoteSnapshot, publication: Publication) {
  const files = Object.create(null) as Record<string, Uint8Array | null>;
  const visible = new Set([...publication.files.values()].map(blobId));
  const retained = new Map([...(publication.blobs ?? [])].filter(([id]) => !visible.has(id)));
  for (const [id, content] of retained) {
    if (!/^[a-f0-9]{40}$/.test(id) || blobId(content) !== id)
      throw new Error("Invalid publication blob.");
    files[".gitbin/vaults/" + publication.vault.root + "/retained/" + id] = contentBytes(content);
  }
  for (const id of base.blobs?.keys() ?? [])
    if (!retained.has(id))
      files[".gitbin/vaults/" + publication.vault.root + "/retained/" + id] = null;
  return files;
}
export async function candidate(
  repo: GitRepo,
  base: RemoteSnapshot,
  publication: Publication,
  identity: Connection["identity"],
): Promise<string> {
  validateVaults([publication.vault]);
  validateRemote({ ...publication, revision: base.revision, vaults: [publication.vault] });
  const files = Object.create(null) as Record<string, string | Uint8Array | null>;
  files[metadataPath] = JSON.stringify(currentMetadata(base.consolidationHash ?? null));
  Object.assign(files, binaryChanges(base, publication));
  applyFileChanges(files, base, publication);
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

function applyFileChanges(
  files: Record<string, string | Uint8Array | null>,
  base: RemoteSnapshot,
  publication: Publication,
): void {
  for (const [id, bytes] of base.states) files[statePath(publication.vault.root, id, bytes)] = null;
  for (const [id, bytes] of publication.states) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid file ID.");
    files[statePath(publication.vault.root, id, bytes)] = bytes;
  }
  for (const [path, text] of publication.files) {
    if (!validPath(path)) throw new Error("Unsafe file path.");
    files[`${publication.vault.root}/${path}`] = contentBytes(text);
  }
  for (const path of base.files.keys())
    if (!publication.files.has(path)) files[`${publication.vault.root}/${path}`] = null;
}
